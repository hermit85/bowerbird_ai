import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../core/config";
import { applyRepairPatch, type PatchCommandResult } from "../core/patchApplier";
import { fail, ok, warn } from "../core/reporter";

function formatCommandLog(command: PatchCommandResult): string {
  return [
    `$ ${command.cmd} ${command.args.join(" ")}`.trim(),
    `exitCode: ${command.result.exitCode}`,
    "stdout:",
    command.result.stdout || "(empty)",
    "stderr:",
    command.result.stderr || "(empty)",
    "",
  ].join("\n");
}

export async function applyPatch(): Promise<number> {
  let projectRoot: string;
  try {
    const config = await getConfig();
    projectRoot = config.projectRoot;
  } catch (error) {
    fail("Config validation failed", error instanceof Error ? error.message : "Unknown error.");
    return 1;
  }

  const metaDir = path.resolve(projectRoot, ".bowerbird");
  const patchPath = path.resolve(metaDir, "repair_patch.diff");
  const sanitizedPatchPath = path.resolve(metaDir, "repair_patch.sanitized.diff");
  const logPath = path.resolve(metaDir, "last_apply_patch_log.txt");

  let hasPatch = true;
  try {
    await access(patchPath);
  } catch {
    hasPatch = false;
  }

  let hasSanitizedPatch = true;
  try {
    await access(sanitizedPatchPath);
  } catch {
    hasSanitizedPatch = false;
  }

  if (!hasPatch && !hasSanitizedPatch) {
    await mkdir(metaDir, { recursive: true });
    await writeFile(logPath, "repair_patch.diff or repair_patch.sanitized.diff not found\n", "utf8");
    warn("No patch file found in .bowerbird/.");
    return 1;
  }

  const result = await applyRepairPatch();
  const logs = result.commands.map((entry) => formatCommandLog(entry)).join("\n");
  await mkdir(metaDir, { recursive: true });
  await writeFile(logPath, logs, "utf8");

  if (!result.ok) {
    if (result.message === "Patch applied but produced no changes.") {
      warn(result.message);
      return 1;
    }
    fail("apply-patch failed", result.message);
    return 1;
  }

  ok("Patch applied and committed (bowerbird repair).");
  ok("Saved apply log to .bowerbird/last_apply_patch_log.txt");
  return 0;
}

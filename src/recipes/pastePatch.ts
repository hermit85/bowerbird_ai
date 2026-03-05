import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { getConfig } from "../core/config";
import { sanitizeRepairPatchFile } from "../core/patchSanitizer";
import { ok, warn } from "../core/reporter";

export async function pastePatch(): Promise<number> {
  let projectRoot = process.cwd();
  try {
    const config = await getConfig();
    projectRoot = config.projectRoot;
  } catch (error) {
    warn("Could not load operator.config.json.", error instanceof Error ? error.message : "Unknown config error.");
    return 1;
  }

  if (process.platform !== "darwin") {
    warn("pbpaste is macOS-only. Paste your patch manually into .bowerbird/repair_patch.diff.");
    return 1;
  }

  const pbpaste = await execa("pbpaste", [], { reject: false });
  if ((pbpaste.exitCode ?? 1) !== 0) {
    warn("pbpaste is not available. Install/use pbpaste or write .bowerbird/repair_patch.diff manually.");
    return 1;
  }

  const content = pbpaste.stdout ?? "";
  const metaDir = path.resolve(projectRoot, ".bowerbird");
  const rawPatchPath = path.resolve(metaDir, "repair_patch.diff");
  await mkdir(metaDir, { recursive: true });
  await writeFile(rawPatchPath, content, "utf8");
  ok("Saved clipboard patch to .bowerbird/repair_patch.diff");

  const sanitizeResult = await sanitizeRepairPatchFile(projectRoot);
  if (!sanitizeResult.ok) {
    warn(sanitizeResult.message || "Could not sanitize patch.");
    return 1;
  }

  ok("Saved sanitized patch to .bowerbird/repair_patch.sanitized.diff");
  ok("Patch saved. Continue with: bowerbird go");
  warn("If repair-loop is already running, continue that flow instead.");
  return 0;
}

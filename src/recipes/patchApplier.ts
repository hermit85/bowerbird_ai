import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { run } from "../core/runner";

function buildPatchContent(attempt: number, categories: string[]): { patch: string; targetFile: string } {
  const targetFile = `AUTONOMOUS_REPAIR_ATTEMPT_${attempt}.md`;
  const lines = [
    "# BowerBird Autonomous Repair",
    "",
    `attempt: ${attempt}`,
    `categories: ${categories.join(", ")}`,
    "status: simulated AI patch applied",
    "",
  ];

  const patchBody = lines.map((line) => `+${line}`).join("\n");
  const patch = [
    `diff --git a/${targetFile} b/${targetFile}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${targetFile}`,
    `@@ -0,0 +1,${lines.length} @@`,
    patchBody,
    "",
  ].join("\n");

  return { patch, targetFile };
}

export async function createAndApplyRepairPatch(
  projectRoot: string,
  attempt: number,
  categories: string[],
): Promise<{ ok: boolean; detail?: string }> {
  const metaDir = path.resolve(projectRoot, ".bowerbird");
  await mkdir(metaDir, { recursive: true });

  const { patch, targetFile } = buildPatchContent(attempt, categories);
  const patchPath = path.resolve(metaDir, "repair_patch.diff");
  await writeFile(patchPath, patch, "utf8");

  const applyResult = await run("git", ["apply", path.relative(projectRoot, patchPath)]);
  if (applyResult.exitCode !== 0) {
    return {
      ok: false,
      detail: applyResult.stderr || applyResult.stdout || "git apply failed",
    };
  }

  const addResult = await run("git", ["add", targetFile]);
  if (addResult.exitCode !== 0) {
    return {
      ok: false,
      detail: addResult.stderr || addResult.stdout || "git add failed",
    };
  }

  const commitResult = await run("git", ["commit", "-m", "bowerbird autonomous repair"]);
  if (commitResult.exitCode !== 0) {
    return {
      ok: false,
      detail: commitResult.stderr || commitResult.stdout || "git commit failed",
    };
  }

  return { ok: true };
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../core/config";
import { ok, warn } from "../core/reporter";
import { autoprompt } from "./autoprompt";
import { createAndApplyRepairPatch } from "./patchApplier";
import { classifyErrors } from "./errorClassifier";
import { fixDeploy } from "./fixDeploy";
import { parseDeployLog } from "./logParser";
import { buildRepairPrompt, writeRepairPrompt } from "./repairPrompt";

export async function fix(rawArgs: string[]): Promise<number> {
  let projectRoot = process.cwd();
  try {
    const config = await getConfig();
    projectRoot = config.projectRoot;
  } catch {
    // fixDeploy/autoprompt handle operator config errors with user-friendly output.
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const code = await fixDeploy(rawArgs);
    if (code === 0) {
      ok("Fix complete");
      return 0;
    }

    if (attempt >= 3) {
      break;
    }

    const logPath = path.resolve(projectRoot, ".bowerbird", "last_deploy_log.txt");
    let logText = "";
    try {
      logText = await readFile(logPath, "utf8");
    } catch {
      warn("Could not read .bowerbird/last_deploy_log.txt for autonomous repair.");
      continue;
    }

    const parsed = parseDeployLog(logText);
    const categories = classifyErrors(parsed);
    const prompt = buildRepairPrompt(parsed, categories, attempt);
    await writeRepairPrompt(projectRoot, prompt);

    const patchResult = await createAndApplyRepairPatch(projectRoot, attempt, categories);
    if (!patchResult.ok) {
      warn("Autonomous patch apply failed", patchResult.detail);
      break;
    }

    ok(`Autonomous repair attempt ${attempt} applied. Retrying deploy.`);
  }

  const p = await autoprompt();
  if (p === 0) {
    ok("Prompt copied. Paste into Codex/Claude and apply patch.");
  }
  return 1;
}

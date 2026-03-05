import { readFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { classifyError } from "../core/errorClassifier";
import { getConfig } from "../core/config";
import { fail, ok, warn } from "../core/reporter";
import { parseDeployLog } from "../core/logParser";
import { buildRepairPrompt, writeRepairPrompt } from "../core/repairPrompt";

type RepairOptions = {
  copy: boolean;
  auto: boolean;
};

function parseArgs(rawArgs: string[]): RepairOptions {
  return {
    copy: rawArgs.includes("--copy"),
    auto: rawArgs.includes("--auto"),
  };
}

async function maybeCopyPrompt(prompt: string): Promise<void> {
  if (process.platform !== "darwin") {
    warn("Clipboard copy skipped (macOS only).");
    return;
  }

  try {
    await execa("pbcopy", [], { input: prompt });
    ok("Copied repair prompt to clipboard (macOS).");
  } catch {
    warn("pbcopy not available. Prompt saved to file.");
  }
}

export async function repair(rawArgs: string[] = []): Promise<number> {
  const options = parseArgs(rawArgs);

  let projectRoot: string;
  try {
    const config = await getConfig();
    projectRoot = config.projectRoot;
  } catch (error) {
    fail("Config validation failed", error instanceof Error ? error.message : "Unknown error.");
    return 1;
  }

  const logPath = path.resolve(projectRoot, ".bowerbird", "last_deploy_log.txt");
  let logText: string;
  try {
    logText = await readFile(logPath, "utf8");
  } catch {
    warn("No deploy log found at .bowerbird/last_deploy_log.txt");
    return 1;
  }

  const parsed = parseDeployLog(logText);
  const classified = classifyError(parsed);
  const prompt = buildRepairPrompt(classified, parsed);

  let promptPath: string;
  try {
    promptPath = await writeRepairPrompt(projectRoot, prompt);
  } catch (error) {
    fail(
      "Failed to write .bowerbird/repair_prompt.md",
      error instanceof Error ? error.message : "Unknown file write error.",
    );
    return 1;
  }

  ok("Deploy failure detected.");
  ok(`Error classified as ${classified.type}`);
  ok(`Repair prompt generated: ${path.relative(projectRoot, promptPath)}`);

  if (options.copy) {
    await maybeCopyPrompt(prompt);
  }

  if (options.auto) {
    console.log("1. Paste prompt into your AI tool, ask for unified diff");
    console.log("2. Save diff into .bowerbird/repair_patch.diff");
    console.log("3. Run: bowerbird apply-patch");
    console.log("4. Then run: bowerbird ship");
  } else {
    warn("Copy prompt into AI coding tool to generate patch.");
  }

  return 0;
}

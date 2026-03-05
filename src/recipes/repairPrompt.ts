import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ErrorCategory } from "./errorClassifier";
import type { ParsedDeployLog } from "./logParser";

export function buildRepairPrompt(
  parsed: ParsedDeployLog,
  categories: ErrorCategory[],
  attempt: number,
): string {
  return [
    "# BowerBird Autonomous Repair Prompt",
    "",
    `Attempt: ${attempt}`,
    `Detected categories: ${categories.join(", ")}`,
    "",
    "You are a senior TypeScript/DevOps engineer. Produce a minimal patch for this repository.",
    "Priorities:",
    "- Fix the deploy failure root cause.",
    "- Keep behavior stable unless correction is required.",
    "- Avoid introducing new dependencies unless strictly required.",
    "- Return precise file diffs and verification commands.",
    "",
    "ERROR BRIEF",
    "```text",
    parsed.raw,
    "```",
    "",
  ].join("\n");
}

export async function writeRepairPrompt(projectRoot: string, prompt: string): Promise<string> {
  const metaDir = path.resolve(projectRoot, ".bowerbird");
  await mkdir(metaDir, { recursive: true });
  const promptPath = path.resolve(metaDir, "repair_prompt.md");
  await writeFile(promptPath, prompt, "utf8");
  return promptPath;
}

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ClassifiedError } from "./errorClassifier";
import type { ParsedDeployError } from "./logParser";

export function buildRepairPrompt(
  classified: ClassifiedError,
  parsed: ParsedDeployError,
): string {
  return [
    `Deployment failed with error type: ${classified.type}`,
    "",
    "Error message:",
    classified.message,
    "",
    parsed.file ? `File: ${parsed.file}` : undefined,
    parsed.line ? `Line: ${parsed.line}` : undefined,
    `Failing step: ${parsed.step}`,
    "",
    "Project uses Node.js and Next.js.",
    "",
    "Provide a minimal code patch to fix the issue.",
    "Keep behavior stable and avoid new dependencies unless required.",
    "Return the patch in unified diff format.",
    "",
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n");
}

export async function writeRepairPrompt(
  projectRoot: string,
  prompt: string,
): Promise<string> {
  const metaDir = path.resolve(projectRoot, ".bowerbird");
  await mkdir(metaDir, { recursive: true });
  const promptPath = path.resolve(metaDir, "repair_prompt.md");
  await writeFile(promptPath, prompt, "utf8");
  return promptPath;
}

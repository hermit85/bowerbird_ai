import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { getConfig } from "../core/config";
import { fail, ok, warn } from "../core/reporter";

function buildPrompt(errorBrief: string): string {
  return [
    "You are a senior TypeScript/DevOps engineer. Fix this repository.",
    "",
    "Instructions:",
    "- Produce a minimal patch focused on root cause.",
    "- Do not introduce new dependencies unless strictly necessary.",
    "- Preserve existing behavior unless the bug requires a change.",
    "- Explain changes briefly.",
    "",
    "Please return:",
    "- Exact file diffs.",
    "- Commands to run locally to validate the fix.",
    "",
    "ERROR BRIEF",
    errorBrief,
    "",
  ].join("\n");
}

async function tryCopyToClipboard(content: string): Promise<boolean> {
  if (process.platform !== "darwin") {
    warn("Clipboard copy skipped (pbcopy is macOS-only).");
    return false;
  }

  try {
    await execa("pbcopy", [], { input: content });
    ok("Copied prompt to clipboard (macOS)");
    return true;
  } catch {
    warn("pbcopy not available. Prompt is still saved to file.");
    return false;
  }
}

export async function autoprompt(): Promise<number> {
  let projectRoot: string;
  try {
    const config = await getConfig();
    projectRoot = config.projectRoot;
  } catch (error) {
    fail("Config validation failed", error instanceof Error ? error.message : "Unknown error.");
    return 1;
  }

  const bowerbirdDir = path.resolve(projectRoot, ".bowerbird");
  const lastErrorPath = path.resolve(bowerbirdDir, "last_error.md");
  const lastPromptPath = path.resolve(bowerbirdDir, "last_prompt.md");

  try {
    await access(lastErrorPath);
  } catch {
    warn("No last_error.md found. Run `bowerbird fix-deploy` or `bowerbird ship` and reproduce the failure.");
    return 1;
  }

  let errorBrief: string;
  try {
    errorBrief = await readFile(lastErrorPath, "utf8");
  } catch (error) {
    fail("Failed to read .bowerbird/last_error.md", error instanceof Error ? error.message : "Unknown file read error.");
    return 1;
  }

  const prompt = buildPrompt(errorBrief);

  try {
    await mkdir(bowerbirdDir, { recursive: true });
    await writeFile(lastPromptPath, prompt, "utf8");
    ok("Saved prompt to .bowerbird/last_prompt.md");
  } catch (error) {
    fail("Failed to save .bowerbird/last_prompt.md", error instanceof Error ? error.message : "Unknown file write error.");
    return 1;
  }

  await tryCopyToClipboard(prompt);
  return 0;
}

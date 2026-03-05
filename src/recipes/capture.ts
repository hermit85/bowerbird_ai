import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../core/config";
import { fail, ok, warn } from "../core/reporter";
import { run } from "../core/runner";

type CaptureResult = {
  label: string;
  ok: boolean;
  stdout: string;
  stderr: string;
};

function extractEnvNames(output: string): string[] {
  const names = new Set<string>();
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    if (
      /^vercel cli/i.test(line) ||
      /^retrieving/i.test(line) ||
      /^name\s+/i.test(line) ||
      /^[\-\u2500\u2501\u2502\s]+$/.test(line)
    ) {
      continue;
    }

    const first = line.split(/\s+/)[0];
    if (first && /^[A-Z0-9_]+$/.test(first)) {
      names.add(first);
    }
  }

  return [...names];
}

async function runCapture(label: string, cmd: string, args: string[]): Promise<CaptureResult> {
  try {
    const result = await run(cmd, args);
    return {
      label,
      ok: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    return {
      label,
      ok: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : "Unknown command error.",
    };
  }
}

export async function capture(): Promise<number> {
  let projectRoot: string;
  try {
    const config = await getConfig();
    projectRoot = config.projectRoot;
  } catch (error) {
    fail("Config validation failed", error instanceof Error ? error.message : "Unknown error.");
    return 1;
  }

  const metaDir = path.resolve(projectRoot, ".bowerbird");
  await mkdir(metaDir, { recursive: true });

  const gitStatus = await runCapture("git status --porcelain", "git", ["status", "--porcelain"]);
  const nodeVersion = await runCapture("node -v", "node", ["-v"]);
  const vercelVersion = await runCapture("vercel --version", "vercel", ["--version"]);
  const vercelWhoami = await runCapture("vercel whoami", "vercel", ["whoami"]);
  const vercelEnvLs = await runCapture("vercel env ls", "vercel", ["env", "ls"]);

  const envNames = extractEnvNames(vercelEnvLs.stdout);
  const lines = [
    "# BowerBird Context Capture",
    "",
    `timestamp: ${new Date().toISOString()}`,
    "",
    "## git status --porcelain",
    "```text",
    gitStatus.stdout || "(clean or unavailable)",
    "```",
    "",
    "## node -v",
    "```text",
    nodeVersion.stdout || nodeVersion.stderr || "(unavailable)",
    "```",
    "",
    "## vercel --version",
    "```text",
    vercelVersion.stdout || vercelVersion.stderr || "(unavailable)",
    "```",
    "",
    "## vercel whoami",
    "```text",
    vercelWhoami.stdout || vercelWhoami.stderr || "(unavailable)",
    "```",
    "",
    "## vercel env ls (names only)",
    "```text",
    envNames.length > 0 ? envNames.join("\n") : "(no env names detected)",
    "```",
    "",
  ];

  const contextPath = path.resolve(metaDir, "context.md");
  await writeFile(contextPath, lines.join("\n"), "utf8");

  ok("Saved context to .bowerbird/context.md");
  if (!vercelEnvLs.ok) {
    warn("Could not fully read Vercel env list.", vercelEnvLs.stderr || "Check Vercel login.");
  }
  return 0;
}

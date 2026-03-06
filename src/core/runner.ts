import path from "node:path";
import { execa } from "execa";
import { getConfig } from "./config";
import { getDryRun } from "./dryRun";
import { ensureSafe } from "./safety";

export type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

type RunOptions = {
  cwd?: string;
  input?: string;
  dryRun?: boolean;
};

function resolveRunCwd(projectRoot: string, cwd?: string): string {
  const resolved = cwd ? path.resolve(projectRoot, cwd) : projectRoot;
  const relative = path.relative(projectRoot, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `Invalid cwd "${cwd}". Command execution must stay inside projectRoot (${projectRoot}).`,
    );
  }

  return resolved;
}

export async function run(
  cmd: string,
  args: string[] = [],
  options: RunOptions = {},
): Promise<RunResult> {
  const config = await getConfig();
  const runCwd = resolveRunCwd(config.projectRoot, options.cwd);

  ensureSafe(cmd, args, config.allowCommands, config.blockedPatterns);
  const dryRun = options.dryRun ?? getDryRun();

  // Regression guard: `npm run dev -- do --dry "deploy preview"` must never execute git/vercel.
  if (dryRun) {
    const commandText = [cmd, ...args].join(" ").trim();
    return {
      exitCode: 0,
      stdout: `[DRY RUN] ${commandText}`,
      stderr: "",
      durationMs: 0,
    };
  }

  const start = Date.now();
  const result = await execa(cmd, args, {
    cwd: runCwd,
    input: options.input,
    reject: false,
  });
  const durationMs = Date.now() - start;

  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    durationMs,
  };
}

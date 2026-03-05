import { access } from "node:fs/promises";
import type { RunResult } from "./runner";
import { run } from "./runner";

export type PatchCommandResult = {
  cmd: string;
  args: string[];
  result: RunResult;
};

export type PatchApplyResult = {
  ok: boolean;
  message: string;
  commands: PatchCommandResult[];
};

async function runGit(args: string[]): Promise<PatchCommandResult> {
  const result = await run("git", args);
  return { cmd: "git", args, result };
}

async function resolvePatchPath(): Promise<string> {
  try {
    await access(".bowerbird/repair_patch.sanitized.diff");
    return ".bowerbird/repair_patch.sanitized.diff";
  } catch {
    return ".bowerbird/repair_patch.diff";
  }
}

export async function applyRepairPatch(): Promise<PatchApplyResult> {
  const commands: PatchCommandResult[] = [];
  const patchPath = await resolvePatchPath();

  const apply = await runGit(["apply", patchPath]);
  commands.push(apply);
  if (apply.result.exitCode !== 0) {
    return {
      ok: false,
      message: "git apply failed",
      commands,
    };
  }

  const status = await runGit(["status", "--porcelain"]);
  commands.push(status);
  if (status.result.exitCode !== 0) {
    return {
      ok: false,
      message: "git status failed",
      commands,
    };
  }
  if (!status.result.stdout.trim()) {
    return {
      ok: false,
      message: "Patch applied but produced no changes.",
      commands,
    };
  }

  const add = await runGit(["add", "-A"]);
  commands.push(add);
  if (add.result.exitCode !== 0) {
    return {
      ok: false,
      message: "git add failed",
      commands,
    };
  }

  const staged = await runGit(["diff", "--cached", "--name-only"]);
  commands.push(staged);
  if (staged.result.exitCode !== 0) {
    return {
      ok: false,
      message: "Failed to verify staged changes",
      commands,
    };
  }
  if (!staged.result.stdout.trim()) {
    return {
      ok: false,
      message: "No staged changes after git add -A.",
      commands,
    };
  }

  const commit = await runGit(["commit", "-m", "bowerbird repair"]);
  commands.push(commit);
  if (commit.result.exitCode !== 0) {
    return {
      ok: false,
      message: "git commit failed",
      commands,
    };
  }

  return {
    ok: true,
    message: "Patch applied and committed.",
    commands,
  };
}

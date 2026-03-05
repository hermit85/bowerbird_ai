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

export async function applyRepairPatch(): Promise<PatchApplyResult> {
  const commands: PatchCommandResult[] = [];

  const apply = await runGit(["apply", ".bowerbird/repair_patch.diff"]);
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

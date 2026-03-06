import { readFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../core/config";
import { getDryRun } from "../core/dryRun";
import { ok, warn } from "../core/reporter";
import { patchState } from "../core/state";
import { repairLoop } from "./repairLoop";

function extractUrl(lastDeployText: string): string | null {
  const line = lastDeployText
    .split(/\r?\n/)
    .find((item) => item.startsWith("url="));
  const url = line?.slice(4).trim();
  return url || null;
}

export async function go(): Promise<number> {
  const dryRun = getDryRun();

  let projectRoot = process.cwd();
  try {
    const config = await getConfig();
    projectRoot = config.projectRoot;
  } catch {
    // repair-loop already reports config issues.
  }

  try {
    await patchState(projectRoot, {
      activity: {
        lastAction: dryRun ? "go_dry_run" : "go_start",
        lastActionAt: new Date().toISOString(),
      },
    });
  } catch {
    // Keep flow working if state write fails.
  }

  const code = await repairLoop(["--max", "3", "--copy"]);

  if (code === 0) {
    try {
      await patchState(projectRoot, {
        activity: {
          lastAction: dryRun ? "go_dry_run_complete" : "go_success",
          lastActionAt: new Date().toISOString(),
        },
      });
    } catch {
      // Non-blocking state update.
    }
    if (dryRun) {
      ok("Live: dry run completed (no deploy executed)");
      return 0;
    }
    try {
      const deployText = await readFile(
        path.resolve(projectRoot, ".bowerbird", "last_deploy.txt"),
        "utf8",
      );
      const url = extractUrl(deployText);
      if (url) {
        ok(`Live: ${url}`);
        return 0;
      }
    } catch {
      // Fallback summary below.
    }

    ok("Live: deployment succeeded");
    return 0;
  }

  warn(".bowerbird/repair_prompt.md");
  warn(".bowerbird/repair_patch.diff");
  warn(".bowerbird/last_apply_patch_log.txt");
  warn(".bowerbird/repair_history.json");
  try {
    await patchState(projectRoot, {
      activity: {
        lastAction: "go_failed",
        lastActionAt: new Date().toISOString(),
      },
    });
  } catch {
    // Non-blocking state update.
  }
  return 1;
}

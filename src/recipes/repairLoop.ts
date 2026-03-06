import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../core/config";
import { getDryRun } from "../core/dryRun";
import { sanitizeRepairPatchFile } from "../core/patchSanitizer";
import { fail, ok, warn } from "../core/reporter";
import { run } from "../core/runner";
import { patchState } from "../core/state";
import { applyPatch } from "./applyPatch";
import { repair } from "./repair";
import { ship } from "./ship";

type RepairLoopOptions = {
  maxAttempts: number;
  copy: boolean;
  watchTimeoutSeconds: number;
  shipArgs: string[];
};

type AttemptHistory = {
  attempt: number;
  startedAt: string;
  finishedAt?: string;
  shipSucceeded: boolean;
  errorType?: string;
  patchDetected?: boolean;
  applyPatchSucceeded?: boolean;
  timedOut?: boolean;
};

type RepairHistory = {
  startedAt: string;
  attempts: AttemptHistory[];
};

type StashState = {
  stashed: boolean;
};

function parseArgs(rawArgs: string[]): RepairLoopOptions {
  let maxAttempts = 3;
  let copy = false;
  let watchTimeoutSeconds = 900;
  const shipArgs: string[] = [];

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === "--copy") {
      copy = true;
      continue;
    }
    if (arg === "--max") {
      const value = rawArgs[i + 1];
      const parsed = Number.parseInt(value ?? "", 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        maxAttempts = parsed;
        i += 1;
      }
      continue;
    }
    if (arg === "--watch-timeout") {
      const value = rawArgs[i + 1];
      const parsed = Number.parseInt(value ?? "", 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        watchTimeoutSeconds = parsed;
        i += 1;
      }
      continue;
    }
    shipArgs.push(arg);
  }

  return { maxAttempts, copy, watchTimeoutSeconds, shipArgs };
}

function parseUrlFromLastDeploy(content: string): string | null {
  const line = content
    .split(/\r?\n/)
    .find((item) => item.startsWith("url="));
  const url = line?.slice(4).trim();
  return url || null;
}

async function readMtimeMs(filePath: string): Promise<number | null> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.mtimeMs;
  } catch {
    return null;
  }
}

async function waitForPatchUpdate(
  patchPath: string,
  baselineMtimeMs: number | null,
  timeoutSeconds: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastAnnouncedBucket = -1;

  while (Date.now() < deadline) {
    const remainingSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const bucket = Math.floor(remainingSeconds / 10);
    if (bucket !== lastAnnouncedBucket) {
      lastAnnouncedBucket = bucket;
      ok(`Remaining wait time: ${remainingSeconds}s`);
    }

    const currentMtime = await readMtimeMs(patchPath);
    if (currentMtime !== null) {
      if (baselineMtimeMs === null || currentMtime > baselineMtimeMs) {
        return true;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

async function ensureCleanOrStash(): Promise<StashState | null> {
  const status = await run("git", ["status", "--porcelain"]);
  if (status.exitCode !== 0) {
    fail("Failed to check git status before apply-patch.");
    return null;
  }

  if (!status.stdout.trim()) {
    return { stashed: false };
  }

  const stash = await run("git", [
    "stash",
    "push",
    "--include-untracked",
    "-m",
    `bowerbird-repair-loop-${Date.now()}`,
  ]);
  if (stash.exitCode !== 0) {
    fail("Failed to stash local changes before apply-patch.");
    return null;
  }

  ok("Stashed local changes before apply-patch.");
  return { stashed: true };
}

async function restoreStashIfNeeded(state: StashState): Promise<boolean> {
  if (!state.stashed) {
    return true;
  }

  const pop = await run("git", ["stash", "pop"]);
  if (pop.exitCode !== 0) {
    warn("Could not restore stashed changes automatically.", pop.stderr || pop.stdout);
    return false;
  }

  ok("Restored stashed local changes.");
  return true;
}

async function readErrorType(projectRoot: string): Promise<string | undefined> {
  try {
    const errorJsonPath = path.resolve(projectRoot, ".bowerbird", "last_error.json");
    const raw = await readFile(errorJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { type?: string };
    return parsed.type;
  } catch {
    return undefined;
  }
}

async function saveHistory(projectRoot: string, history: RepairHistory): Promise<void> {
  const metaDir = path.resolve(projectRoot, ".bowerbird");
  await mkdir(metaDir, { recursive: true });
  const historyPath = path.resolve(metaDir, "repair_history.json");
  await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}

export async function repairLoop(rawArgs: string[]): Promise<number> {
  const options = parseArgs(rawArgs);
  const dryRun = getDryRun();

  let projectRoot: string;
  try {
    const config = await getConfig();
    projectRoot = config.projectRoot;
  } catch (error) {
    fail("Config validation failed", error instanceof Error ? error.message : "Unknown error.");
    return 1;
  }

  const history: RepairHistory = {
    startedAt: new Date().toISOString(),
    attempts: [],
  };

  const patchPath = path.resolve(projectRoot, ".bowerbird", "repair_patch.diff");

  try {
    await patchState(projectRoot, {
      activity: {
        lastAction: dryRun ? "repair_loop_dry_run" : "repair_loop_start",
        lastActionAt: new Date().toISOString(),
      },
    });
  } catch {
    // Non-blocking state update.
  }

  if (dryRun) {
    ok(`Dry run: would execute repair-loop with max attempts ${options.maxAttempts}`);
    for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
      ok(`Attempt ${attempt}: would run ship ${options.shipArgs.join(" ")}`.trim());
      ok(`Attempt ${attempt}: would run repair --auto${options.copy ? " --copy" : ""}`);
      ok(`Attempt ${attempt}: would wait for ${path.relative(projectRoot, patchPath)}`);
      ok(`Attempt ${attempt}: would sanitize patch then run apply-patch`);
    }
    try {
      await patchState(projectRoot, {
        activity: {
          lastAction: "repair_loop_dry_run_complete",
          lastActionAt: new Date().toISOString(),
        },
      });
    } catch {
      // Non-blocking state update.
    }
    return 0;
  }

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const entry: AttemptHistory = {
      attempt,
      startedAt: new Date().toISOString(),
      shipSucceeded: false,
    };
    history.attempts.push(entry);
    await saveHistory(projectRoot, history);

    ok(`Repair loop attempt ${attempt}/${options.maxAttempts}`);

    const shipCode = await ship(options.shipArgs);
    if (shipCode === 0) {
      entry.shipSucceeded = true;
      entry.finishedAt = new Date().toISOString();
      await saveHistory(projectRoot, history);

      try {
        const deployText = await readFile(
          path.resolve(projectRoot, ".bowerbird", "last_deploy.txt"),
          "utf8",
        );
        const url = parseUrlFromLastDeploy(deployText);
        if (url) {
          ok(`Repair loop complete: ${url}`);
          try {
            await patchState(projectRoot, {
              activity: {
                lastAction: "repair_loop_success",
                lastActionAt: new Date().toISOString(),
              },
            });
          } catch {
            // Non-blocking state update.
          }
          return 0;
        }
      } catch {
        // Fallback message below.
      }

      ok("Repair loop complete.");
      try {
        await patchState(projectRoot, {
          activity: {
            lastAction: "repair_loop_success",
            lastActionAt: new Date().toISOString(),
          },
        });
      } catch {
        // Non-blocking state update.
      }
      return 0;
    }

    const repairArgs = ["--auto", ...(options.copy ? ["--copy"] : [])];
    const repairCode = await repair(repairArgs);
    if (repairCode !== 0) {
      entry.finishedAt = new Date().toISOString();
      await saveHistory(projectRoot, history);
      fail("Failed to generate repair prompt.");
      try {
        await patchState(projectRoot, {
          activity: {
            lastAction: "repair_loop_failed",
            lastActionAt: new Date().toISOString(),
          },
        });
      } catch {
        // Non-blocking state update.
      }
      return 1;
    }
    entry.errorType = await readErrorType(projectRoot);

    const baselineMtime = await readMtimeMs(patchPath);
    ok("Waiting for patch file: .bowerbird/repair_patch.diff");
    ok(`Watch timeout: ${options.watchTimeoutSeconds}s`);
    const patchDetected = await waitForPatchUpdate(
      patchPath,
      baselineMtime,
      options.watchTimeoutSeconds,
    );
    entry.patchDetected = patchDetected;

    if (!patchDetected) {
      entry.timedOut = true;
      entry.finishedAt = new Date().toISOString();
      await saveHistory(projectRoot, history);
      fail("Timed out waiting for .bowerbird/repair_patch.diff.");
      warn("Next step: generate a unified diff from your AI tool and save it to .bowerbird/repair_patch.diff.");
      try {
        await patchState(projectRoot, {
          activity: {
            lastAction: "repair_loop_timeout",
            lastActionAt: new Date().toISOString(),
          },
        });
      } catch {
        // Non-blocking state update.
      }
      return 1;
    }

    const sanitizeResult = await sanitizeRepairPatchFile(projectRoot);
    if (!sanitizeResult.ok) {
      entry.finishedAt = new Date().toISOString();
      await saveHistory(projectRoot, history);
      fail(sanitizeResult.message || "Patch file is not a valid unified diff.");
      warn("Ensure .bowerbird/repair_patch.diff contains a valid diff starting with 'diff --git' or '--- '.");
      try {
        await patchState(projectRoot, {
          activity: {
            lastAction: "repair_loop_failed",
            lastActionAt: new Date().toISOString(),
          },
        });
      } catch {
        // Non-blocking state update.
      }
      return 1;
    }
    ok("Sanitized patch saved to .bowerbird/repair_patch.sanitized.diff");

    const stashState = await ensureCleanOrStash();
    if (!stashState) {
      entry.finishedAt = new Date().toISOString();
      await saveHistory(projectRoot, history);
      try {
        await patchState(projectRoot, {
          activity: {
            lastAction: "repair_loop_failed",
            lastActionAt: new Date().toISOString(),
          },
        });
      } catch {
        // Non-blocking state update.
      }
      return 1;
    }

    const applyCode = await applyPatch();
    entry.applyPatchSucceeded = applyCode === 0;
    const restored = await restoreStashIfNeeded(stashState);
    if (!restored) {
      entry.finishedAt = new Date().toISOString();
      await saveHistory(projectRoot, history);
      try {
        await patchState(projectRoot, {
          activity: {
            lastAction: "repair_loop_failed",
            lastActionAt: new Date().toISOString(),
          },
        });
      } catch {
        // Non-blocking state update.
      }
      return 1;
    }

    entry.finishedAt = new Date().toISOString();
    await saveHistory(projectRoot, history);

    if (applyCode !== 0) {
      fail("apply-patch failed. See .bowerbird/last_apply_patch_log.txt.");
      try {
        await patchState(projectRoot, {
          activity: {
            lastAction: "repair_loop_failed",
            lastActionAt: new Date().toISOString(),
          },
        });
      } catch {
        // Non-blocking state update.
      }
      return 1;
    }
  }

  fail(`Repair loop reached max attempts (${options.maxAttempts}) without success.`);
  warn("Review .bowerbird/repair_history.json and last logs, then retry with a better patch.");
  try {
    await patchState(projectRoot, {
      activity: {
        lastAction: "repair_loop_failed",
        lastActionAt: new Date().toISOString(),
      },
    });
  } catch {
    // Non-blocking state update.
  }
  return 1;
}

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../core/config";
import { fail, ok, warn } from "../core/reporter";
import { run } from "../core/runner";
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

async function sanitizePatchFile(projectRoot: string): Promise<boolean> {
  const metaDir = path.resolve(projectRoot, ".bowerbird");
  const rawPatchPath = path.resolve(metaDir, "repair_patch.diff");
  const sanitizedPatchPath = path.resolve(metaDir, "repair_patch.sanitized.diff");

  let raw: string;
  try {
    raw = await readFile(rawPatchPath, "utf8");
  } catch {
    return false;
  }

  const noFences = raw
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("```"))
    .join("\n");
  const lines = noFences.split(/\r?\n/);
  let startIndex = lines.findIndex((line) => line.startsWith("diff --git "));
  if (startIndex === -1) {
    startIndex = lines.findIndex((line) => line.startsWith("--- "));
  }
  if (startIndex === -1) {
    return false;
  }

  const sanitized = `${lines.slice(startIndex).join("\n").trim()}\n`;
  await writeFile(sanitizedPatchPath, sanitized, "utf8");
  ok("Sanitized patch saved to .bowerbird/repair_patch.sanitized.diff");
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
          return 0;
        }
      } catch {
        // Fallback message below.
      }

      ok("Repair loop complete.");
      return 0;
    }

    const repairArgs = ["--auto", ...(options.copy ? ["--copy"] : [])];
    const repairCode = await repair(repairArgs);
    if (repairCode !== 0) {
      entry.finishedAt = new Date().toISOString();
      await saveHistory(projectRoot, history);
      fail("Failed to generate repair prompt.");
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
      return 1;
    }

    const sanitized = await sanitizePatchFile(projectRoot);
    if (!sanitized) {
      entry.finishedAt = new Date().toISOString();
      await saveHistory(projectRoot, history);
      fail("Patch file is not a valid unified diff.");
      warn("Ensure .bowerbird/repair_patch.diff contains a valid diff starting with 'diff --git' or '--- '.");
      return 1;
    }

    const stashState = await ensureCleanOrStash();
    if (!stashState) {
      entry.finishedAt = new Date().toISOString();
      await saveHistory(projectRoot, history);
      return 1;
    }

    const applyCode = await applyPatch();
    entry.applyPatchSucceeded = applyCode === 0;
    const restored = await restoreStashIfNeeded(stashState);
    if (!restored) {
      entry.finishedAt = new Date().toISOString();
      await saveHistory(projectRoot, history);
      return 1;
    }

    entry.finishedAt = new Date().toISOString();
    await saveHistory(projectRoot, history);

    if (applyCode !== 0) {
      fail("apply-patch failed. See .bowerbird/last_apply_patch_log.txt.");
      return 1;
    }
  }

  fail(`Repair loop reached max attempts (${options.maxAttempts}) without success.`);
  warn("Review .bowerbird/repair_history.json and last logs, then retry with a better patch.");
  return 1;
}

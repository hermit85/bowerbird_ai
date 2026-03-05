import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export function repoRoot(): string {
  return path.resolve(process.cwd(), "../..");
}

export function bowerbirdDir(): string {
  return path.resolve(repoRoot(), ".bowerbird");
}

export async function ensureBowerbirdDir(): Promise<string> {
  const dir = bowerbirdDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function readTextSafe(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

export function parseLastDeployUrl(text: string | null): string | null {
  if (!text) {
    return null;
  }
  const urlLine = text.split(/\r?\n/).find((line) => line.startsWith("url="));
  return urlLine ? urlLine.slice(4).trim() : null;
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function sanitizePatchInBowerbird(): Promise<{ ok: boolean; message: string }> {
  const dir = await ensureBowerbirdDir();
  const rawPath = path.resolve(dir, "repair_patch.diff");
  const outPath = path.resolve(dir, "repair_patch.sanitized.diff");

  const raw = await readTextSafe(rawPath);
  if (raw === null) {
    return { ok: false, message: "repair_patch.diff not found" };
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
    return { ok: false, message: "Patch is not valid unified diff" };
  }

  const sanitized = `${lines.slice(startIndex).join("\n").trim()}\n`;
  await writeFile(outPath, sanitized, "utf8");
  return { ok: true, message: "Sanitized patch saved" };
}

function pidPath(): string {
  return path.resolve(bowerbirdDir(), "ui_run.pid");
}

export async function isRunActive(): Promise<boolean> {
  const rawPid = await readTextSafe(pidPath());
  if (!rawPid) {
    return false;
  }
  const pid = Number.parseInt(rawPid.trim(), 10);
  if (Number.isNaN(pid)) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function startRepairLoopProcess(): Promise<{ ok: boolean; message: string }> {
  const dir = await ensureBowerbirdDir();
  if (await isRunActive()) {
    return { ok: true, message: "Repair loop already running" };
  }

  const cliPath = path.resolve(repoRoot(), "dist", "cli.js");
  const hasCli = await fileExists(cliPath);
  if (!hasCli) {
    return { ok: false, message: "dist/cli.js not found. Build CLI first." };
  }

  const logPath = path.resolve(dir, "ui_last_run.log");
  const outFd = await writeFile(logPath, "", "utf8").then(() => undefined);
  void outFd;

  const child = spawn(process.execPath, [cliPath, "repair-loop", "--max", "3", "--copy"], {
    cwd: repoRoot(),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logStreamPath = path.resolve(dir, "ui_last_run.log");
  const append = async (chunk: Buffer): Promise<void> => {
    await writeFile(logStreamPath, chunk.toString(), { encoding: "utf8", flag: "a" });
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    void append(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    void append(chunk);
  });

  const started = await new Promise<{ ok: boolean; message: string }>((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({ ok: true, message: "Repair loop started" });
      }
    }, 250);

    child.once("error", (err) => {
      if (!resolved) {
        clearTimeout(timer);
        resolved = true;
        resolve({ ok: false, message: `Failed to start process: ${err.message}` });
      }
    });
  });

  if (!started.ok) {
    return started;
  }

  await writeFile(pidPath(), String(child.pid), "utf8");
  child.unref();
  return started;
}

export async function readRepairHistory(): Promise<unknown> {
  const text = await readTextSafe(path.resolve(bowerbirdDir(), "repair_history.json"));
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function readLastErrorJson(): Promise<unknown> {
  const text = await readTextSafe(path.resolve(bowerbirdDir(), "last_error.json"));
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function readStatusPayload(): Promise<Record<string, unknown>> {
  const dir = bowerbirdDir();
  const lastDeploy = await readTextSafe(path.resolve(dir, "last_deploy.txt"));
  const lastDeployLog = await readTextSafe(path.resolve(dir, "last_deploy_log.txt"));
  const lastApplyPatchLog = await readTextSafe(path.resolve(dir, "last_apply_patch_log.txt"));
  const uiLastRunLog = await readTextSafe(path.resolve(dir, "ui_last_run.log"));
  const history = await readRepairHistory();
  const lastError = await readLastErrorJson();

  return {
    lastDeployUrl: parseLastDeployUrl(lastDeploy),
    lastError,
    repairHistory: history,
    lastDeployLog: lastDeployLog ?? "",
    lastApplyPatchLog: lastApplyPatchLog ?? "",
    uiLastRunLog: uiLastRunLog ?? "",
    runActive: await isRunActive(),
    timestamp: new Date().toISOString(),
  };
}

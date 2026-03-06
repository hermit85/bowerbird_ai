import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { execa } from "execa";
import { getConfig } from "../core/config";
import { run } from "../core/runner";
import { fail, ok, warn } from "../core/reporter";

type CliRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type StatusPayload = {
  repoPath: string;
  branch: string;
  lastDeployUrl: string | null;
  vercelStatus: string;
  supabaseStatus: string;
  envVars: string[];
  lastErrorJson: string | null;
  repairPrompt: string | null;
  repairHistory: string | null;
  lastDeployLog: string | null;
  lastApplyPatchLog: string | null;
};

const PORT = 4311;
const UI_ROOT = path.resolve(process.cwd(), "src", "console", "ui");

let actionQueue: Promise<unknown> = Promise.resolve();

async function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const runWork = actionQueue.then(work, work);
  actionQueue = runWork.then(() => undefined, () => undefined);
  return runWork;
}

function parseEnvNames(output: string): string[] {
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readMaybe(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function resolveCliCommand(args: string[]): Promise<{ cmd: string; args: string[] }> {
  const distCli = path.resolve(process.cwd(), "dist", "cli.js");
  if (await fileExists(distCli)) {
    return { cmd: process.execPath, args: [distCli, ...args] };
  }

  const srcCli = path.resolve(process.cwd(), "src", "cli.ts");
  return { cmd: "npx", args: ["tsx", srcCli, ...args] };
}

async function runCli(args: string[], input?: string): Promise<CliRunResult> {
  const cli = await resolveCliCommand(args);
  const result = await execa(cli.cmd, cli.args, {
    cwd: process.cwd(),
    reject: false,
    input,
  });

  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function runStatusCommand(cmd: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  try {
    const result = await run(cmd, args);
    if (result.exitCode === 0) {
      return { ok: true, output: result.stdout || "" };
    }
    return { ok: false, output: result.stderr || result.stdout || "" };
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : "Unknown command error.",
    };
  }
}

function parseLastDeployUrl(content: string | null): string | null {
  if (!content) {
    return null;
  }
  const urlLine = content
    .split(/\r?\n/)
    .find((line) => line.startsWith("url="));
  return urlLine?.slice(4).trim() || null;
}

async function getStatus(): Promise<StatusPayload> {
  const { projectRoot } = await getConfig();
  const metaDir = path.resolve(projectRoot, ".bowerbird");

  const branchResult = await runStatusCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  const vercelWhoami = await runStatusCommand("vercel", ["whoami"]);
  const supabaseVersion = await runStatusCommand("supabase", ["--version"]);
  const envList = await runStatusCommand("vercel", ["env", "ls"]);

  const lastDeploy = await readMaybe(path.resolve(metaDir, "last_deploy.txt"));

  return {
    repoPath: projectRoot,
    branch: branchResult.ok ? branchResult.output.trim() || "unknown" : "unknown",
    lastDeployUrl: parseLastDeployUrl(lastDeploy),
    vercelStatus: vercelWhoami.ok
      ? `Logged in as ${vercelWhoami.output.trim() || "unknown"}`
      : "Not logged in or unavailable",
    supabaseStatus: supabaseVersion.ok
      ? `CLI available (${supabaseVersion.output.trim() || "version unknown"})`
      : "CLI unavailable or auth needed",
    envVars: envList.ok ? parseEnvNames(envList.output) : [],
    lastErrorJson: await readMaybe(path.resolve(metaDir, "last_error.json")),
    repairPrompt: await readMaybe(path.resolve(metaDir, "repair_prompt.md")),
    repairHistory: await readMaybe(path.resolve(metaDir, "repair_history.json")),
    lastDeployLog: await readMaybe(path.resolve(metaDir, "last_deploy_log.txt")),
    lastApplyPatchLog: await readMaybe(path.resolve(metaDir, "last_apply_patch_log.txt")),
  };
}

function json(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function sendText(response: http.ServerResponse, statusCode: number, text: string, contentType: string): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", contentType);
  response.end(text);
}

async function readJsonBody<T>(request: http.IncomingMessage): Promise<T | null> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return null;
  }

  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function serveUiFile(response: http.ServerResponse, relativePath: string): Promise<void> {
  const filePath = path.resolve(UI_ROOT, relativePath);
  const content = await readFile(filePath, "utf8");
  let contentType = "text/plain; charset=utf-8";
  if (relativePath.endsWith(".html")) {
    contentType = "text/html; charset=utf-8";
  } else if (relativePath.endsWith(".js")) {
    contentType = "text/javascript; charset=utf-8";
  } else if (relativePath.endsWith(".css")) {
    contentType = "text/css; charset=utf-8";
  } else if (relativePath.endsWith(".json")) {
    contentType = "application/json; charset=utf-8";
  }
  sendText(response, 200, content, contentType);
}

function resolveUiRelativePath(pathname: string): string | null {
  if (pathname === "/") {
    return "index.html";
  }

  const withoutPrefix = pathname.startsWith("/ui/")
    ? pathname.slice("/ui/".length)
    : pathname.startsWith("/")
      ? pathname.slice(1)
      : pathname;
  const normalized = path.normalize(withoutPrefix);
  if (!normalized || normalized === ".") {
    return "index.html";
  }

  const resolved = path.resolve(UI_ROOT, normalized);
  const relative = path.relative(UI_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return relative;
}

async function handleApi(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  const url = new URL(request.url || "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/api/status") {
    try {
      const status = await getStatus();
      json(response, 200, status);
      return;
    } catch (error) {
      json(response, 500, {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to load status.",
      });
      return;
    }
  }

  if (request.method === "POST" && url.pathname === "/api/do/preview") {
    const body = await readJsonBody<{ instruction?: string }>(request);
    const instruction = body?.instruction?.trim();
    if (!instruction) {
      json(response, 400, { ok: false, message: "Instruction is required." });
      return;
    }

    const result = await enqueue(() => runCli(["do", "--dry", instruction]));
    json(response, result.exitCode === 0 ? 200 : 400, { ok: result.exitCode === 0, result });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/do/execute") {
    const body = await readJsonBody<{ instruction?: string }>(request);
    const instruction = body?.instruction?.trim();
    if (!instruction) {
      json(response, 400, { ok: false, message: "Instruction is required." });
      return;
    }

    const result = await enqueue(() => runCli(["do", instruction]));
    json(response, result.exitCode === 0 ? 200 : 400, { ok: result.exitCode === 0, result });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/repair/paste-patch") {
    const result = await enqueue(() => runCli(["paste-patch"]));
    json(response, result.exitCode === 0 ? 200 : 400, { ok: result.exitCode === 0, result });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/repair/apply-redeploy") {
    const applyResult = await enqueue(() => runCli(["apply-patch"]));
    if (applyResult.exitCode !== 0) {
      json(response, 400, { ok: false, step: "apply-patch", applyResult });
      return;
    }

    const shipResult = await enqueue(() => runCli(["ship"]));
    json(response, shipResult.exitCode === 0 ? 200 : 400, {
      ok: shipResult.exitCode === 0,
      step: "ship",
      applyResult,
      shipResult,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/deploy/preview") {
    const result = await enqueue(() => runCli(["deploy"]));
    json(response, result.exitCode === 0 ? 200 : 400, { ok: result.exitCode === 0, result });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/deploy/prod") {
    const result = await enqueue(() => runCli(["deploy", "--prod"], "yes\n"));
    json(response, result.exitCode === 0 ? 200 : 400, { ok: result.exitCode === 0, result });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/env/add") {
    type EnvAddBody = { key?: string; value?: string; target?: string };
    const body = await readJsonBody<EnvAddBody>(request);
    const key = body?.key?.trim().toUpperCase();
    const value = body?.value ?? "";
    const target = body?.target?.trim() || "preview";

    if (!key || !/^[A-Z0-9_]+$/.test(key)) {
      json(response, 400, { ok: false, message: "Invalid env key." });
      return;
    }
    if (!value) {
      json(response, 400, { ok: false, message: "Value is required." });
      return;
    }

    const result = await enqueue(() => run("vercel", ["env", "add", key, target], { input: `${value}\n` }));
    const okResult = result.exitCode === 0;
    json(response, okResult ? 200 : 400, {
      ok: okResult,
      message: okResult ? `Added ${key} to Vercel (${target}).` : "Failed to add env variable.",
      output: okResult ? "Value hidden" : (result.stderr || result.stdout || "No output"),
    });
    return;
  }

  json(response, 404, { ok: false, message: "Not found" });
}

export async function startConsoleServer(): Promise<number> {
  try {
    const config = await getConfig();
    const metaDir = path.resolve(config.projectRoot, ".bowerbird");
    await mkdir(metaDir, { recursive: true });
  } catch (error) {
    fail("Failed to start console", error instanceof Error ? error.message : "Unknown error.");
    return 1;
  }

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://localhost");

      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response);
        return;
      }

      const uiRelativePath = resolveUiRelativePath(url.pathname);
      if (!uiRelativePath) {
        sendText(response, 404, "Not found", "text/plain; charset=utf-8");
        return;
      }

      const assetPath = path.resolve(UI_ROOT, uiRelativePath);
      if (!(await fileExists(assetPath))) {
        sendText(response, 404, "Not found", "text/plain; charset=utf-8");
        return;
      }

      await serveUiFile(response, uiRelativePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal server error";
      sendText(response, 500, message, "text/plain; charset=utf-8");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve());
  });

  ok(`BowerBird console running at http://127.0.0.1:${PORT}`);
  warn("Press Ctrl+C to stop the server.");

  return await new Promise<number>((resolve) => {
    server.on("close", () => resolve(0));
  });
}

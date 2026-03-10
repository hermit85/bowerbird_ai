import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { execa } from "execa";
import { detectAIInstructions, executeAIInstructions } from "../ai/actions";
import type { AIContext } from "../ai/types";
import { detectStack } from "../detection/stackDetector";
import { diagnoseProject, runDoctorAutofix } from "../doctor/projectDoctor";
import { extractActions } from "../core/actionParser";
import { runAutoMode, setAutoExecutor } from "../core/autoMode";
import { detectCapabilities, ensureCapabilities, isActionAllowed, writeCapabilities, type Capabilities } from "../core/capabilities";
import { getConfig } from "../core/config";
import { parseDoInstruction } from "../core/doParser";
import { getSupportedMacros, macros } from "../core/macros";
import { getProviderMappings } from "../providers";
import { generateSuggestions } from "../core/suggestions";
import { run } from "../core/runner";
import { fail, ok, warn } from "../core/reporter";
import { patchState, readState, type ProjectState } from "../core/state";
import { enqueue as enqueueJob, getAllJobs, initEngine } from "../engine/engine";

type CliRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type StatusPayload = {
  project: ProjectState["project"];
  git: ProjectState["git"];
  vercel: ProjectState["vercel"];
  stack: ReturnType<typeof detectStack>;
  inspectionFindings: ReturnType<typeof detectStack>["inspectionFindings"];
  supabase: ProjectState["supabase"] & {
    functionsRequired?: boolean;
  };
  env: ProjectState["env"];
  activity: ProjectState["activity"];
  lastErrorJson: string | null;
  repairPrompt: string | null;
  repairHistory: string | null;
  lastDeployLog: string | null;
  lastApplyPatchLog: string | null;
  providerMappings: ReturnType<typeof getProviderMappings>;
};

const PORT = 4311;
const HOST = "127.0.0.1";
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

async function detectDeployableSupabaseFunctions(projectRoot: string): Promise<string[]> {
  const functionsDir = path.resolve(projectRoot, "supabase", "functions");
  try {
    const entries = await readdir(functionsDir, { withFileTypes: true });
    const entryFiles = ["index.ts", "index.js", "main.ts", "main.js", "mod.ts"];
    const deployable: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const dirPath = path.resolve(functionsDir, entry.name);
      const checks = await Promise.all(
        entryFiles.map(async (file) => {
          try {
            const st = await stat(path.resolve(dirPath, file));
            return st.isFile();
          } catch {
            return false;
          }
        }),
      );
      if (checks.some(Boolean)) {
        deployable.push(entry.name);
      }
    }
    return deployable;
  } catch {
    return [];
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

type QueuedOperation = {
  type: string;
  payload?: any;
};

type CoreFounderAction =
  | "connect_database"
  | "deploy_preview"
  | "deploy_backend"
  | "make_app_live";

type CoreDispatchPayload = {
  value?: string;
  target?: string;
  functionName?: string;
  projectRef?: string;
  confirm?: boolean;
};

async function dispatchCoreAction(
  projectRoot: string,
  action: CoreFounderAction,
  payload?: CoreDispatchPayload,
): Promise<{ ok: boolean; message: string; jobIds?: string[]; type?: string }> {
  if (action === "connect_database") {
    const value = String(payload?.value ?? "");
    const target = typeof payload?.target === "string" ? payload.target : "preview";
    if (!value) {
      return { ok: false, message: "DATABASE_URL is required." };
    }
    const queued = enqueueOperations([{ type: "add_env", payload: { key: "DATABASE_URL", value, target } }]);
    return {
      ok: true,
      message: "Job queued: connect database",
      jobIds: queued.jobIds,
      type: "add_env",
    };
  }

  if (action === "deploy_preview") {
    const queued = enqueueOperations([{ type: "deploy_preview" }]);
    return {
      ok: true,
      message: "Job queued: deploy preview",
      jobIds: queued.jobIds,
      type: "deploy_preview",
    };
  }

  if (action === "deploy_backend") {
    const functionName = String(payload?.functionName ?? "generate").trim() || "generate";
    const projectRef = String(payload?.projectRef ?? "").trim();
    const mapped = await mapInstructionToJobs(
      projectRoot,
      projectRef
        ? `deploy supabase function ${functionName} --project-ref ${projectRef}`
        : `deploy supabase function ${functionName}`,
    );
    const queued = enqueueOperations(mapped);
    return {
      ok: true,
      message: "Job queued: deploy backend",
      jobIds: queued.jobIds,
      type: "deploy_supabase_function",
    };
  }

  if (action === "make_app_live") {
    if (payload?.confirm !== true) {
      return { ok: false, message: "Production deploy requires explicit confirmation." };
    }
    const queued = enqueueOperations([{ type: "deploy_production" }]);
    return {
      ok: true,
      message: "Job queued: make app live",
      jobIds: queued.jobIds,
      type: "deploy_production",
    };
  }

  return { ok: false, message: `Unsupported core action: ${action}` };
}

async function mapInstructionToJobs(projectRoot: string, instruction: string, payload?: any): Promise<QueuedOperation[]> {
  const normalized = instruction.trim();
  const lowered = normalized.toLowerCase();
  if (!normalized) {
    throw new Error("Instruction is required.");
  }

  if (lowered === "deploy preview" || lowered === "redeploy" || lowered === "redeploy preview") {
    return [{ type: "deploy_preview" }];
  }

  if (lowered === "deploy production") {
    return [{ type: "deploy_production" }];
  }

  if (lowered === "view logs" || lowered === "logs") {
    return [{ type: "view_logs" }];
  }

  if (lowered.startsWith("add env")) {
    const keyMatch = normalized.match(/add env\s+([A-Z0-9_]+)/i);
    const key = keyMatch?.[1]?.toUpperCase();
    const value = typeof payload?.value === "string" ? payload.value : "";
    const target = typeof payload?.target === "string" ? payload.target : "preview";
    if (!key || key === "KEY") {
      throw new Error("Missing env key. Use: add env YOUR_KEY to vercel");
    }
    if (!value) {
      throw new Error(`Missing value for env key ${key}. Use Add env action to provide value.`);
    }
    return [{ type: "add_env", payload: { key, value, target } }];
  }

  if (lowered.startsWith("deploy supabase function")) {
    const matchWithRef = normalized.match(/deploy supabase function\s+([a-zA-Z0-9_-]+)\s+--project-ref\s+([a-zA-Z0-9_-]+)/i);
    if (matchWithRef?.[1] && matchWithRef?.[2]) {
      return [{
        type: "deploy_supabase_function",
        payload: {
          functionName: matchWithRef[1],
          projectRef: matchWithRef[2],
        },
      }];
    }

    const shortMatch = normalized.match(/deploy supabase function\s+([a-zA-Z0-9_-]+)/i);
    const functionName = shortMatch?.[1];
    if (!functionName || functionName.toUpperCase() === "NAME") {
      throw new Error("Missing Supabase function name. Use: deploy supabase function your_fn --project-ref <ref>");
    }
    return [{
      type: "deploy_supabase_function",
      payload: {
        functionName,
        projectRef: typeof payload?.projectRef === "string" ? payload.projectRef : "",
      },
    }];
  }

  const parsed = parseDoInstruction(normalized);
  if (!parsed) {
    throw new Error(`Unsupported instruction: ${normalized}`);
  }

  if (parsed.detectedTask === "deploy_preview") {
    return [{ type: "deploy_preview" }];
  }
  if (parsed.detectedTask === "deploy_production") {
    return [{ type: "deploy_production" }];
  }
  if (parsed.detectedTask === "supabase_function_deploy") {
    if (!parsed.metadata?.functionName || !parsed.metadata?.projectRef) {
      throw new Error("Missing Supabase function deployment metadata.");
    }
    return [{
      type: "deploy_supabase_function",
      payload: {
        functionName: parsed.metadata.functionName,
        projectRef: parsed.metadata.projectRef,
      },
    }];
  }
  if (parsed.detectedTask === "vercel_env_add") {
    const key = parsed.metadata?.key?.toUpperCase();
    const value = typeof payload?.value === "string" ? payload.value : "";
    const target = typeof payload?.target === "string" ? payload.target : "preview";
    if (!key) {
      throw new Error("Missing env key.");
    }
    if (!value) {
      throw new Error(`Missing value for env key ${key}. Use Add env action to provide value.`);
    }
    return [{ type: "add_env", payload: { key, value, target } }];
  }

  throw new Error(`Unsupported parsed task: ${parsed.detectedTask}`);
}

function enqueueOperations(ops: QueuedOperation[]): { jobIds: string[]; jobs: ReturnType<typeof enqueueJob>[] } {
  const jobs = ops.map((op) => enqueueJob(op.type, op.payload));
  return {
    jobIds: jobs.map((job) => job.id),
    jobs,
  };
}

async function enqueueInstruction(projectRoot: string, instruction: string, payload?: any): Promise<{ ok: boolean; message: string; jobIds?: string[] }> {
  try {
    const jobs = await mapInstructionToJobs(projectRoot, instruction, payload);
    const queued = enqueueOperations(jobs);
    return {
      ok: true,
      message: `Job queued (${queued.jobIds.length}).`,
      jobIds: queued.jobIds,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Instruction execution failed.",
    };
  }
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

function parseLastDeployTimestamp(content: string | null): string | null {
  if (!content) {
    return null;
  }
  const tsLine = content
    .split(/\r?\n/)
    .find((line) => line.startsWith("timestamp="));
  return tsLine?.slice("timestamp=".length).trim() || null;
}

async function getStatus(): Promise<StatusPayload> {
  const { projectRoot } = await getConfig();
  const metaDir = path.resolve(projectRoot, ".bowerbird");
  const state = await readState(projectRoot);
  const stack = detectStack(projectRoot);

  const branchResult = await runStatusCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  const vercelWhoami = await runStatusCommand("vercel", ["whoami"]);
  const supabaseVersion = await runStatusCommand("supabase", ["--version"]);
  const envList = await runStatusCommand("vercel", ["env", "ls"]);
  const deployableFunctions = await detectDeployableSupabaseFunctions(projectRoot);

  const lastDeploy = await readMaybe(path.resolve(metaDir, "last_deploy.txt"));
  const fallbackLastDeploy = parseLastDeployUrl(lastDeploy);
  const fallbackLastDeployAt = parseLastDeployTimestamp(lastDeploy);
  const effectiveBranch = state.git.branch ?? (branchResult.ok ? branchResult.output.trim() || null : null);
  const effectiveLastDeploy = state.vercel.lastDeployUrl ?? fallbackLastDeploy;
  const effectiveVercelConnected = state.vercel.connected || vercelWhoami.ok;
  const effectiveSupabaseConnected = state.supabase.connected || supabaseVersion.ok;
  const envFromCommand = envList.ok ? parseEnvNames(envList.output) : [];
  const envVars = [...new Set([...(state.env.knownKeys ?? []), ...envFromCommand])];

  const resolvedState: ProjectState = {
    ...state,
    project: {
      name: state.project.name || path.basename(projectRoot),
      root: state.project.root || projectRoot,
    },
    git: {
      branch: effectiveBranch,
    },
    vercel: {
      connected: effectiveVercelConnected,
      lastDeployUrl: effectiveLastDeploy,
      lastDeployAt: state.vercel.lastDeployAt ?? fallbackLastDeployAt,
    },
    supabase: {
      connected: effectiveSupabaseConnected,
      projectRef: state.supabase.projectRef,
      functions: state.supabase.functions ?? [],
    },
    env: {
      knownKeys: envVars,
    },
    activity: {
      lastAction: state.activity.lastAction,
      lastActionAt: state.activity.lastActionAt,
    },
  };

  return {
    project: resolvedState.project,
    git: resolvedState.git,
    vercel: resolvedState.vercel,
    stack,
    inspectionFindings: stack.inspectionFindings,
    supabase: {
      ...resolvedState.supabase,
      functionsRequired: deployableFunctions.length > 0,
    },
    env: resolvedState.env,
    activity: resolvedState.activity,
    lastErrorJson: await readMaybe(path.resolve(metaDir, "last_error.json")),
    repairPrompt: await readMaybe(path.resolve(metaDir, "repair_prompt.md")),
    repairHistory: await readMaybe(path.resolve(metaDir, "repair_history.json")),
    lastDeployLog: await readMaybe(path.resolve(metaDir, "last_deploy_log.txt")),
    lastApplyPatchLog: await readMaybe(path.resolve(metaDir, "last_apply_patch_log.txt")),
    providerMappings: getProviderMappings(),
  };
}

function createAIContextFromState(
  state: ProjectState,
  stack: ReturnType<typeof detectStack>,
): AIContext {
  const knownKeys = Array.isArray(state.env.knownKeys) ? state.env.knownKeys : [];
  const functions = Array.isArray(state.supabase.functions) ? state.supabase.functions : [];
  const lastAction = String(state.activity.lastAction || "").toLowerCase();
  return {
    stack,
    launch: {
      databaseConnected: knownKeys.includes("DATABASE_URL"),
      backendDeployed: functions.length > 0,
      previewReady: Boolean(state.vercel.lastDeployUrl),
      appLive: /production|make_app_live|deploy_production/.test(lastAction),
    },
  };
}

async function getSuggestions(): Promise<ReturnType<typeof generateSuggestions>> {
  const { projectRoot } = await getConfig();
  const state = await readState(projectRoot);
  const capabilities = await ensureCapabilities(projectRoot);
  return generateSuggestions(state, capabilities);
}

async function getCapabilities(): Promise<Capabilities> {
  const { projectRoot } = await getConfig();
  const capabilities = await detectCapabilities(projectRoot);
  await writeCapabilities(projectRoot, capabilities);
  return capabilities;
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

  if (request.method === "GET" && url.pathname === "/api/suggestions") {
    try {
      const suggestions = await getSuggestions();
      json(response, 200, suggestions);
      return;
    } catch (error) {
      json(response, 500, {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to load suggestions.",
      });
      return;
    }
  }

  if (request.method === "GET" && url.pathname === "/api/doctor") {
    try {
      const report = await diagnoseProject();
      json(response, 200, report);
      return;
    } catch (error) {
      json(response, 500, {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to run doctor.",
      });
      return;
    }
  }

  if (request.method === "POST" && url.pathname === "/api/doctor/fix") {
    type DoctorFixBody = { actionId?: string };
    const body = await readJsonBody<DoctorFixBody>(request);
    const actionId = body?.actionId?.trim();
    if (!actionId) {
      json(response, 400, { ok: false, message: "actionId is required." });
      return;
    }
    const result = await runDoctorAutofix(actionId);
    if (!result.ok) {
      json(response, 400, { ok: false, message: result.message });
      return;
    }
    const report = await diagnoseProject();
    json(response, 200, {
      ok: true,
      message: result.message,
      report,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/operations") {
    json(response, 200, getAllJobs());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/queue") {
    json(response, 200, getAllJobs());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/capabilities") {
    try {
      const capabilities = await getCapabilities();
      json(response, 200, capabilities);
      return;
    } catch (error) {
      json(response, 500, {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to load capabilities.",
      });
      return;
    }
  }

  if (request.method === "GET" && url.pathname === "/api/providers") {
    json(response, 200, getProviderMappings());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/do/preview") {
    const body = await readJsonBody<{ instruction?: string }>(request);
    const instruction = body?.instruction?.trim();
    if (!instruction) {
      json(response, 400, { ok: false, message: "Instruction is required." });
      return;
    }

    let projectRoot = process.cwd();
    try {
      const config = await getConfig();
      projectRoot = config.projectRoot;
    } catch {
      // keep cwd fallback
    }
    const mapped = await mapInstructionToJobs(projectRoot, instruction).catch((error: unknown) => {
      return error instanceof Error ? error.message : "Could not parse instruction.";
    });
    if (typeof mapped === "string") {
      json(response, 400, { ok: false, message: mapped });
      return;
    }
    const previewText = mapped.map((job, index) => `${index + 1}. ${job.type}`).join("\n");
    const result = {
      exitCode: 0,
      stdout: `[DRY RUN]\n${previewText}`,
      stderr: "",
    };
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

    let projectRoot = process.cwd();
    try {
      const config = await getConfig();
      projectRoot = config.projectRoot;
    } catch {
      // keep cwd fallback
    }
    const queued = await enqueueInstruction(projectRoot, instruction);
    json(response, queued.ok ? 200 : 400, queued);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/actions/dispatch") {
    type DispatchBody = { action?: CoreFounderAction; payload?: CoreDispatchPayload };
    const body = await readJsonBody<DispatchBody>(request);
    const action = body?.action;
    if (!action) {
      json(response, 400, { ok: false, message: "action is required." });
      return;
    }
    let projectRoot = process.cwd();
    try {
      const config = await getConfig();
      projectRoot = config.projectRoot;
    } catch {
      // keep cwd fallback
    }
    const result = await dispatchCoreAction(projectRoot, action, body?.payload);
    json(response, result.ok ? 200 : 400, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/chat/parse") {
    const body = await readJsonBody<{ text?: string }>(request);
    const text = body?.text ?? "";
    const actions = extractActions(text);
    json(response, 200, actions);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/ai/import") {
    const body = await readJsonBody<{ text?: string }>(request);
    const text = body?.text ?? "";
    let projectRoot = process.cwd();
    try {
      const config = await getConfig();
      projectRoot = config.projectRoot;
    } catch {
      // Keep cwd fallback.
    }
    const stack = detectStack(projectRoot);
    const state = await readState(projectRoot);
    const context = createAIContextFromState(state, stack);
    const summary = executeAIInstructions(text, context);
    json(response, 200, summary);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/ai/detect") {
    const body = await readJsonBody<{ text?: string }>(request);
    const text = body?.text ?? "";
    let projectRoot = process.cwd();
    try {
      const config = await getConfig();
      projectRoot = config.projectRoot;
    } catch {
      // Keep cwd fallback.
    }
    const stack = detectStack(projectRoot);
    const state = await readState(projectRoot);
    const context = createAIContextFromState(state, stack);
    const plan = detectAIInstructions(text, context);
    json(response, 200, {
      actionsDetected: plan.actions.length,
      actions: plan.actions,
      reasoning: plan.reasoning,
      intents: plan.intents,
      stack,
      inspectionFindings: stack.inspectionFindings,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/ai/run") {
    const body = await readJsonBody<{ text?: string }>(request);
    const text = body?.text ?? "";
    let projectRoot = process.cwd();
    try {
      const config = await getConfig();
      projectRoot = config.projectRoot;
    } catch {
      // Keep cwd fallback.
    }
    const stack = detectStack(projectRoot);
    const state = await readState(projectRoot);
    const context = createAIContextFromState(state, stack);
    const summary = executeAIInstructions(text, context);
    json(response, 200, summary);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auto/run") {
    try {
      const { projectRoot } = await getConfig();
      const state = await readState(projectRoot);
      const capabilities = await ensureCapabilities(projectRoot);
      const suggestions = generateSuggestions(state, capabilities);

      setAutoExecutor(async (instruction: string) => {
        if (!isActionAllowed(instruction, capabilities)) {
          throw new Error(`Blocked by capabilities: ${instruction}`);
        }
        const queued = await enqueueInstruction(projectRoot, instruction);
        if (!queued.ok) {
          throw new Error(queued.message || `Failed to queue: ${instruction}`);
        }
      });

      const autoResult = await runAutoMode(state, suggestions);
      json(response, 200, autoResult);
      return;
    } catch (error) {
      json(response, 400, {
        ok: false,
        message: error instanceof Error ? error.message : "Auto mode failed.",
      });
      return;
    }
  }

  if (request.method === "POST" && url.pathname === "/api/macro/run") {
    const body = await readJsonBody<{ macroId?: string }>(request);
    const macroId = body?.macroId?.trim();
    if (!macroId) {
      json(response, 400, { ok: false, message: "macroId is required." });
      return;
    }

    const macro = macros.find((item) => item.id === macroId);
    if (!macro) {
      json(response, 404, { ok: false, message: `Unknown macro: ${macroId}` });
      return;
    }
    const { projectRoot } = await getConfig();
    const capabilities = await ensureCapabilities(projectRoot);
    const supportedMacroIds = new Set(getSupportedMacros(capabilities).map((item) => item.id));
    if (!supportedMacroIds.has(macro.id)) {
      json(response, 400, { ok: false, message: `Macro not supported by current capabilities: ${macroId}` });
      return;
    }

    const operations: QueuedOperation[] = [];
    for (let i = 0; i < macro.steps.length; i += 1) {
      const step = macro.steps[i] ?? "";
      const mapped = await mapInstructionToJobs(projectRoot, step).catch((error: unknown) => {
        return error instanceof Error ? error.message : "Could not parse macro step.";
      });
      if (typeof mapped === "string") {
        json(response, 400, { ok: false, message: `Macro step ${i + 1} failed to parse: ${mapped}` });
        return;
      }
      operations.push(...mapped);
    }

    const queued = enqueueOperations(operations);
    json(response, 200, {
      ok: true,
      message: `Macro queued: ${macro.label}`,
      jobIds: queued.jobIds,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/repair/paste-patch") {
    const result = await enqueue(() => runCli(["paste-patch"]));
    json(response, result.exitCode === 0 ? 200 : 400, { ok: result.exitCode === 0, result });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/repair/apply-redeploy") {
    const job = enqueueJob("repair_deployment");
    json(response, 200, {
      ok: true,
      message: "Job queued",
      jobId: job.id,
      type: "repair_deployment",
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/deploy/preview") {
    let projectRoot = process.cwd();
    try {
      const config = await getConfig();
      projectRoot = config.projectRoot;
    } catch {
      // keep cwd fallback
    }
    const result = await dispatchCoreAction(projectRoot, "deploy_preview");
    if (result.ok && result.jobIds && result.jobIds.length > 0) {
      json(response, 200, { ...result, jobId: result.jobIds[0] });
      return;
    }
    json(response, 400, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/deploy/prod") {
    let projectRoot = process.cwd();
    try {
      const config = await getConfig();
      projectRoot = config.projectRoot;
    } catch {
      // keep cwd fallback
    }
    const result = await dispatchCoreAction(projectRoot, "make_app_live", { confirm: true });
    if (result.ok && result.jobIds && result.jobIds.length > 0) {
      json(response, 200, { ...result, jobId: result.jobIds[0] });
      return;
    }
    json(response, 400, result);
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

    try {
      const { projectRoot } = await getConfig();
      const current = await readState(projectRoot);
      await patchState(projectRoot, {
        env: {
          knownKeys: [...new Set([...(current.env.knownKeys ?? []), key])],
        },
        activity: {
          lastAction: "vercel_env_add",
          lastActionAt: new Date().toISOString(),
        },
      });
    } catch {
      // Keep API success even if state patch fails.
    }
    const job = enqueueJob("add_env", { key, value, target });
    json(response, 200, {
      ok: true,
      message: `Job queued: add env ${key}`,
      jobId: job.id,
      type: "add_env",
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

  initEngine(async (job) => {
    if (job.type === "repair_deployment") {
      const result = await runCli(["repair-loop", "--max", "1"]);
      return {
        ok: result.exitCode === 0,
        output: result.stdout || result.stderr || "repair-loop finished.",
      };
    }
    return {
      ok: false,
      output: `No engine handler for job type: ${job.type}`,
    };
  });

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

  const requestedPortRaw = process.env.BOWERBIRD_CONSOLE_PORT?.trim();
  const requestedPort = requestedPortRaw ? Number.parseInt(requestedPortRaw, 10) : NaN;
  const finalPort = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : PORT;

  if (requestedPortRaw && finalPort === PORT) {
    warn(`Invalid BOWERBIRD_CONSOLE_PORT="${requestedPortRaw}"`, `Using default ${HOST}:${PORT}`);
  }

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(finalPort, HOST, () => resolve());
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "EADDRINUSE") {
      fail(
        `Could not bind ${HOST}:${finalPort}`,
        "That port is already in use by another app. Stop the other app or set BOWERBIRD_CONSOLE_PORT to a different port.",
      );
      return 1;
    }
    if (code === "EPERM") {
      fail(
        `Could not bind ${HOST}:${finalPort}`,
        "Permission denied by local system policy. Try a different port using BOWERBIRD_CONSOLE_PORT.",
      );
      return 1;
    }
    fail(
      `Could not bind ${HOST}:${finalPort}`,
      error instanceof Error ? error.message : "Unknown listen error.",
    );
    return 1;
  }

  ok(`deplo.app console running at http://${HOST}:${finalPort}`);
  warn("Press Ctrl+C to stop the server.");

  return await new Promise<number>((resolve) => {
    server.on("close", () => resolve(0));
  });
}

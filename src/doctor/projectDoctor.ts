import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../core/config";
import { run } from "../core/runner";

export type DoctorCheckStatus = "ok" | "warn" | "blocker";
export type DoctorOverall = "ready" | "warning" | "blocked";
export type DoctorActionType = "autofix" | "manual";

export type DoctorCheck = {
  id: string;
  label: string;
  status: DoctorCheckStatus;
  message: string;
  detail?: string;
};

export type DoctorIssue = {
  severity: Exclude<DoctorCheckStatus, "ok">;
  message: string;
};

export type DoctorAction = {
  id: string;
  label: string;
  type: DoctorActionType;
  command?: string;
  description: string;
};

export type DoctorReport = {
  overall: DoctorOverall;
  checks: DoctorCheck[];
  issues: DoctorIssue[];
  actions: DoctorAction[];
};

const ACTION_CREATE_ENV_TEMPLATE = "create_env_template";

function toOverall(checks: DoctorCheck[]): DoctorOverall {
  if (checks.some((check) => check.status === "blocker")) {
    return "blocked";
  }
  if (checks.some((check) => check.status === "warn")) {
    return "warning";
  }
  return "ready";
}

function toIssues(checks: DoctorCheck[]): DoctorIssue[] {
  return checks
    .filter((check) => check.status !== "ok")
    .map((check) => ({
      severity: check.status === "blocker" ? "blocker" : "warn",
      message: check.message,
    }));
}

function safeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

async function commandCheck(id: string, label: string, cmd: string, args: string[]): Promise<DoctorCheck> {
  try {
    const result = await run(cmd, args);
    if (result.exitCode === 0) {
      return {
        id,
        label,
        status: "ok",
        message: `${label} is ready`,
        detail: safeText(result.stdout) ?? "Available",
      };
    }
    return {
      id,
      label,
      status: "blocker",
      message: `${label} is not available`,
      detail: safeText(result.stderr) ?? safeText(result.stdout) ?? "Command failed.",
    };
  } catch (error) {
    return {
      id,
      label,
      status: "blocker",
      message: `${label} is not available`,
      detail: error instanceof Error ? error.message : "Command failed.",
    };
  }
}

async function checkEnvFiles(projectRoot: string): Promise<DoctorCheck> {
  const envFiles = [".env", ".env.local"];
  const found: string[] = [];
  for (const file of envFiles) {
    try {
      await access(path.resolve(projectRoot, file));
      found.push(file);
    } catch {
      // ignore
    }
  }

  if (found.length > 0) {
    return {
      id: "env_files",
      label: "Environment files",
      status: "ok",
      message: "Environment files are present",
      detail: found.join(", "),
    };
  }

  return {
    id: "env_files",
    label: "Environment files",
    status: "warn",
    message: "No environment file found",
    detail: "Create .env or .env.local to store local configuration.",
  };
}

export async function diagnoseProject(): Promise<DoctorReport> {
  const config = await getConfig();
  const checks: DoctorCheck[] = [];

  const nodeCheck = await commandCheck("node_cli", "Node.js", "node", ["--version"]);
  checks.push(nodeCheck);

  const vercelCliCheck = await commandCheck("vercel_cli", "Vercel CLI", "vercel", ["--version"]);
  checks.push(vercelCliCheck);

  if (vercelCliCheck.status === "ok") {
    try {
      const whoami = await run("vercel", ["whoami"]);
      if (whoami.exitCode === 0) {
        checks.push({
          id: "vercel_auth",
          label: "Vercel login",
          status: "ok",
          message: "You are logged into Vercel",
          detail: safeText(whoami.stdout),
        });
      } else {
        checks.push({
          id: "vercel_auth",
          label: "Vercel login",
          status: "warn",
          message: "You are not logged into Vercel",
          detail: safeText(whoami.stderr) ?? "Run `vercel login`.",
        });
      }
    } catch (error) {
      checks.push({
        id: "vercel_auth",
        label: "Vercel login",
        status: "warn",
        message: "Could not verify Vercel login",
        detail: error instanceof Error ? error.message : "Verification failed.",
      });
    }
  }

  const supabaseCliCheck = await commandCheck("supabase_cli", "Supabase CLI", "supabase", ["--version"]);
  checks.push(supabaseCliCheck);

  if (supabaseCliCheck.status === "ok") {
    try {
      const loginHelp = await run("supabase", ["login", "--help"]);
      if (loginHelp.exitCode === 0) {
        checks.push({
          id: "supabase_auth",
          label: "Supabase login",
          status: "warn",
          message: "Supabase login may still be needed",
          detail: "Run `supabase login` if deploy or db commands fail.",
        });
      } else {
        checks.push({
          id: "supabase_auth",
          label: "Supabase login",
          status: "warn",
          message: "Could not verify Supabase login",
          detail: safeText(loginHelp.stderr) ?? "Run `supabase login`.",
        });
      }
    } catch (error) {
      checks.push({
        id: "supabase_auth",
        label: "Supabase login",
        status: "warn",
        message: "Could not verify Supabase login",
        detail: error instanceof Error ? error.message : "Verification failed.",
      });
    }
  }

  checks.push(await checkEnvFiles(config.projectRoot));

  const actions: DoctorAction[] = [];
  if (checks.some((check) => check.id === "env_files" && check.status !== "ok")) {
    actions.push({
      id: ACTION_CREATE_ENV_TEMPLATE,
      label: "Create env template",
      type: "autofix",
      description: "Create .env.example with starter keys.",
    });
  }
  if (checks.some((check) => check.id === "vercel_auth" && check.status !== "ok")) {
    actions.push({
      id: "manual_vercel_login",
      label: "Log into Vercel",
      type: "manual",
      command: "vercel login",
      description: "Run this once to connect your Vercel account.",
    });
  }
  if (checks.some((check) => check.id === "supabase_auth" && check.status !== "ok")) {
    actions.push({
      id: "manual_supabase_login",
      label: "Log into Supabase",
      type: "manual",
      command: "supabase login",
      description: "Run this once to connect your Supabase account.",
    });
  }

  return {
    overall: toOverall(checks),
    checks,
    issues: toIssues(checks),
    actions,
  };
}

export async function runDoctorAutofix(actionId: string): Promise<{ ok: boolean; message: string }> {
  if (actionId !== ACTION_CREATE_ENV_TEMPLATE) {
    return { ok: false, message: `Unknown or unsupported doctor action: ${actionId}` };
  }

  const config = await getConfig();
  const envExamplePath = path.resolve(config.projectRoot, ".env.example");
  await writeFile(envExamplePath, "API_KEY=\nDATABASE_URL=\n", "utf8");
  return { ok: true, message: "Created .env.example" };
}

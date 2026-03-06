import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readState } from "./state";

export type Capabilities = {
  deploy_preview: boolean;
  deploy_production: boolean;
  env_management: boolean;
  logs: boolean;
  repair_loop: boolean;
  supabase_functions: boolean;
  database_migrations: boolean;
};

const DEFAULT_CAPABILITIES: Capabilities = {
  deploy_preview: true,
  deploy_production: true,
  env_management: true,
  logs: true,
  repair_loop: true,
  supabase_functions: true,
  database_migrations: false,
};

function capabilitiesPath(projectRoot: string): string {
  return path.resolve(projectRoot, ".bowerbird", "capabilities.json");
}

function normalizeCapabilities(value: unknown): Capabilities {
  const raw = (value ?? {}) as Partial<Capabilities>;
  return {
    deploy_preview: raw.deploy_preview ?? DEFAULT_CAPABILITIES.deploy_preview,
    deploy_production: raw.deploy_production ?? DEFAULT_CAPABILITIES.deploy_production,
    env_management: raw.env_management ?? DEFAULT_CAPABILITIES.env_management,
    logs: raw.logs ?? DEFAULT_CAPABILITIES.logs,
    repair_loop: raw.repair_loop ?? DEFAULT_CAPABILITIES.repair_loop,
    supabase_functions: raw.supabase_functions ?? DEFAULT_CAPABILITIES.supabase_functions,
    database_migrations: raw.database_migrations ?? DEFAULT_CAPABILITIES.database_migrations,
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function writeCapabilities(projectRoot: string, capabilities: Capabilities): Promise<void> {
  const filePath = capabilitiesPath(projectRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(normalizeCapabilities(capabilities), null, 2)}\n`, "utf8");
}

export async function ensureCapabilities(projectRoot: string): Promise<Capabilities> {
  const filePath = capabilitiesPath(projectRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  if (!(await exists(filePath))) {
    await writeCapabilities(projectRoot, DEFAULT_CAPABILITIES);
    return DEFAULT_CAPABILITIES;
  }

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = normalizeCapabilities(JSON.parse(raw));
    await writeCapabilities(projectRoot, parsed);
    return parsed;
  } catch {
    await writeCapabilities(projectRoot, DEFAULT_CAPABILITIES);
    return DEFAULT_CAPABILITIES;
  }
}

export async function readCapabilities(projectRoot: string): Promise<Capabilities> {
  return ensureCapabilities(projectRoot);
}

export function isActionAllowed(instruction: string, capabilities: Capabilities): boolean {
  const normalized = instruction.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized.includes("deploy production")) {
    return capabilities.deploy_production;
  }
  if (normalized.includes("deploy preview")) {
    return capabilities.deploy_preview;
  }
  if (normalized.includes("add env")) {
    return capabilities.env_management;
  }
  if (normalized.includes("deploy supabase function")) {
    return capabilities.supabase_functions;
  }
  if (normalized.includes("repair")) {
    return capabilities.repair_loop;
  }
  if (normalized.includes("log")) {
    return capabilities.logs;
  }
  return true;
}

export async function detectCapabilities(projectRoot: string): Promise<Capabilities> {
  const state = await readState(projectRoot);

  const hasVercelConfig =
    (await exists(path.resolve(projectRoot, "vercel.json"))) ||
    (await exists(path.resolve(projectRoot, ".vercel"))) ||
    state.vercel.connected;
  const hasEnv = await exists(path.resolve(projectRoot, ".env"));
  const hasSupabaseEvidence =
    (await exists(path.resolve(projectRoot, "supabase"))) ||
    Boolean(state.supabase.projectRef) ||
    (state.supabase.functions?.length ?? 0) > 0 ||
    state.supabase.connected;
  const hasRepairLoop =
    (await exists(path.resolve(projectRoot, "src", "recipes", "repairLoop.ts"))) ||
    (await exists(path.resolve(projectRoot, "dist", "recipes", "repairLoop.js")));
  const hasDatabaseMigrations =
    (await exists(path.resolve(projectRoot, "prisma", "migrations"))) ||
    (await exists(path.resolve(projectRoot, "supabase", "migrations"))) ||
    (await exists(path.resolve(projectRoot, "drizzle")));

  return {
    deploy_preview: hasVercelConfig,
    deploy_production: hasVercelConfig,
    env_management: hasEnv,
    logs: hasVercelConfig,
    repair_loop: hasRepairLoop,
    supabase_functions: hasSupabaseEvidence,
    database_migrations: hasDatabaseMigrations,
  };
}

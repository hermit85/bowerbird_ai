import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readCapabilities, type Capabilities } from "../core/capabilities";
import { getConfig } from "../core/config";
import { fail, ok, warn } from "../core/reporter";
import { readState } from "../core/state";

type PackageJson = {
  name?: string;
  description?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function capabilityLabel(capability: keyof Capabilities): string {
  if (capability === "deploy_preview") return "Deploy preview";
  if (capability === "deploy_production") return "Deploy production";
  if (capability === "env_management") return "Environment variable management";
  if (capability === "logs") return "Logs";
  if (capability === "repair_loop") return "Repair loop";
  if (capability === "supabase_functions") return "Supabase functions";
  return "Database migrations";
}

function detectFramework(pkg: PackageJson): string {
  const deps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };

  if (deps.next) return "Next.js";
  if (deps.nuxt) return "Nuxt";
  if (deps["@sveltejs/kit"]) return "SvelteKit";
  if (deps.remix) return "Remix";
  if (deps.express) return "Express";
  if (deps.fastify) return "Fastify";
  if (deps.react) return "React";
  if (deps.vue) return "Vue";
  return "Unknown";
}

async function readPackage(projectRoot: string): Promise<PackageJson | null> {
  const packagePath = path.resolve(projectRoot, "package.json");
  try {
    const raw = await readFile(packagePath, "utf8");
    return JSON.parse(raw) as PackageJson;
  } catch {
    return null;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildProfileMarkdown(input: {
  projectRoot: string;
  profileName: string;
  description: string;
  framework: string;
  runtime: string;
  language: string;
  state: Awaited<ReturnType<typeof readState>>;
  capabilities: Capabilities;
}): string {
  const supportedActions = Object.entries(input.capabilities)
    .map(([name, enabled]) => `- ${capabilityLabel(name as keyof Capabilities)}: ${enabled ? "yes" : "no"}`)
    .join("\n");

  const envKeys = input.state.env.knownKeys.length > 0
    ? input.state.env.knownKeys.join(", ")
    : "none detected";

  return `# BowerBird Project Profile

## 1) Project
- name: ${input.profileName}
- root: ${input.projectRoot}
- short description: ${input.description}

## 2) Stack
- language: ${input.language}
- runtime: ${input.runtime}
- framework: ${input.framework}
- provider: ${input.state.vercel.connected ? "Vercel" : "not connected"}${input.state.supabase.connected ? " + Supabase" : ""}

## 3) Infra
- vercel: ${input.state.vercel.connected ? "connected" : "not connected"}
- supabase: ${input.state.supabase.connected ? "connected" : "not connected"}
- known env keys (names only): ${envKeys}

## 4) BowerBird Rules
- use preview deploys by default
- never print env values
- use BowerBird for infra operations
- prefer queue/worker/provider adapter flow
- use repair flow on deploy failure

## 5) Supported Actions
${supportedActions}

## 6) AI Usage Hint
Before suggesting infra steps, read this file and prefer BowerBird commands.
`;
}

export async function initProfile(): Promise<number> {
  let projectRoot: string;
  try {
    const config = await getConfig();
    projectRoot = config.projectRoot;
  } catch (error) {
    fail("Config validation failed", error instanceof Error ? error.message : "Unknown error.");
    return 1;
  }

  try {
    const state = await readState(projectRoot);
    const capabilities = await readCapabilities(projectRoot);
    const pkg = await readPackage(projectRoot);
    const profilePath = path.resolve(projectRoot, "bowerbird.md");

    if (await exists(profilePath)) {
      warn("bowerbird.md already exists. Overwriting.");
    }

    const profileName = state.project.name || pkg?.name || path.basename(projectRoot);
    const description = pkg?.description?.trim() || "Not specified";
    const framework = detectFramework(pkg ?? {});
    const runtime = "Node.js";
    const language = (pkg?.devDependencies?.typescript || pkg?.dependencies?.typescript) ? "TypeScript" : "JavaScript";

    const markdown = buildProfileMarkdown({
      projectRoot,
      profileName,
      description,
      framework,
      runtime,
      language,
      state,
      capabilities,
    });

    await writeFile(profilePath, `${markdown}\n`, "utf8");
    ok(`Created profile: ${profilePath}`);
    return 0;
  } catch (error) {
    fail("Failed to generate bowerbird.md", error instanceof Error ? error.message : "Unknown error.");
    return 1;
  }
}

export async function profileSummary(): Promise<number> {
  let projectRoot: string;
  try {
    const config = await getConfig();
    projectRoot = config.projectRoot;
  } catch (error) {
    fail("Config validation failed", error instanceof Error ? error.message : "Unknown error.");
    return 1;
  }

  const profilePath = path.resolve(projectRoot, "bowerbird.md");
  if (!(await exists(profilePath))) {
    warn("bowerbird.md not found", "Run `bowerbird init-profile` to generate it.");
    return 1;
  }

  try {
    const state = await readState(projectRoot);
    console.log(`Profile: ${profilePath}`);
    console.log(`Project: ${state.project.name}`);
    console.log(`App: ${state.vercel.lastDeployUrl ? "Live" : "Not live"}`);
    console.log(`Database: ${state.supabase.connected ? "Connected" : "Not connected"}`);
    console.log(`Env keys: ${state.env.knownKeys.length > 0 ? state.env.knownKeys.join(", ") : "none"}`);
    return 0;
  } catch (error) {
    fail("Failed to read profile context", error instanceof Error ? error.message : "Unknown error.");
    return 1;
  }
}

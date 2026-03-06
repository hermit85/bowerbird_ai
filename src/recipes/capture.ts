import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectCapabilities, writeCapabilities } from "../core/capabilities";
import { getConfig } from "../core/config";
import { fail, ok, warn } from "../core/reporter";
import { run } from "../core/runner";
import { patchState, readState } from "../core/state";

type CaptureResult = {
  label: string;
  ok: boolean;
  stdout: string;
  stderr: string;
};

function extractEnvNames(output: string): string[] {
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

function extractLocalEnvKeys(content: string): string[] {
  const keys = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = trimmed.match(/^([A-Z][A-Z0-9_]*)\s*=/);
    if (match?.[1]) {
      keys.add(match[1]);
    }
  }
  return [...keys];
}

async function readEnvFileKeys(projectRoot: string): Promise<string[]> {
  const files = [".env", ".env.local", ".env.example"];
  const keys = new Set<string>();
  for (const fileName of files) {
    try {
      const content = await readFile(path.resolve(projectRoot, fileName), "utf8");
      for (const key of extractLocalEnvKeys(content)) {
        keys.add(key);
      }
    } catch {
      // Missing env files are normal.
    }
  }
  return [...keys];
}

async function detectSupabaseProjectRef(projectRoot: string): Promise<string | null> {
  try {
    const configToml = await readFile(path.resolve(projectRoot, "supabase", "config.toml"), "utf8");
    const projectRefMatch = configToml.match(/project_id\s*=\s*"([^"]+)"/);
    return projectRefMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

async function runCapture(label: string, cmd: string, args: string[]): Promise<CaptureResult> {
  try {
    const result = await run(cmd, args);
    return {
      label,
      ok: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    return {
      label,
      ok: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : "Unknown command error.",
    };
  }
}

export async function capture(): Promise<number> {
  let projectRoot: string;
  try {
    const config = await getConfig();
    projectRoot = config.projectRoot;
  } catch (error) {
    fail("Config validation failed", error instanceof Error ? error.message : "Unknown error.");
    return 1;
  }

  const metaDir = path.resolve(projectRoot, ".bowerbird");
  await mkdir(metaDir, { recursive: true });

  const gitStatus = await runCapture("git status --porcelain", "git", ["status", "--porcelain"]);
  const gitBranch = await runCapture("git branch", "git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  const nodeVersion = await runCapture("node -v", "node", ["-v"]);
  const vercelVersion = await runCapture("vercel --version", "vercel", ["--version"]);
  const vercelWhoami = await runCapture("vercel whoami", "vercel", ["whoami"]);
  const vercelEnvLs = await runCapture("vercel env ls", "vercel", ["env", "ls"]);
  const supabaseVersion = await runCapture("supabase --version", "supabase", ["--version"]);

  const envNames = extractEnvNames(vercelEnvLs.stdout);
  const localEnvKeys = await readEnvFileKeys(projectRoot);
  const combinedEnvKeys = [...new Set([...envNames, ...localEnvKeys])];
  const supabaseProjectRef = await detectSupabaseProjectRef(projectRoot);
  const lines = [
    "# BowerBird Context Capture",
    "",
    `timestamp: ${new Date().toISOString()}`,
    "",
    "## git status --porcelain",
    "```text",
    gitStatus.stdout || "(clean or unavailable)",
    "```",
    "",
    "## node -v",
    "```text",
    nodeVersion.stdout || nodeVersion.stderr || "(unavailable)",
    "```",
    "",
    "## vercel --version",
    "```text",
    vercelVersion.stdout || vercelVersion.stderr || "(unavailable)",
    "```",
    "",
    "## vercel whoami",
    "```text",
    vercelWhoami.stdout || vercelWhoami.stderr || "(unavailable)",
    "```",
    "",
    "## vercel env ls (names only)",
    "```text",
    envNames.length > 0 ? envNames.join("\n") : "(no env names detected)",
    "```",
    "",
  ];

  const contextPath = path.resolve(metaDir, "context.md");
  await writeFile(contextPath, lines.join("\n"), "utf8");

  try {
    const currentState = await readState(projectRoot);
    const mergedFunctions = currentState.supabase.functions ?? [];
    await patchState(projectRoot, {
      project: {
        name: path.basename(projectRoot),
        root: projectRoot,
      },
      git: {
        branch: gitBranch.ok ? gitBranch.stdout.trim() || null : null,
      },
      vercel: {
        connected: vercelVersion.ok,
      },
      supabase: {
        connected: supabaseVersion.ok,
        projectRef: supabaseProjectRef,
        functions: mergedFunctions,
      },
      env: {
        knownKeys: combinedEnvKeys,
      },
      activity: {
        lastAction: "capture",
        lastActionAt: new Date().toISOString(),
      },
    });
    ok("Updated .bowerbird/state.json");
  } catch (error) {
    warn("Could not update .bowerbird/state.json", error instanceof Error ? error.message : "Unknown state error.");
  }

  try {
    const capabilities = await detectCapabilities(projectRoot);
    await writeCapabilities(projectRoot, capabilities);
    ok("Updated .bowerbird/capabilities.json");
  } catch (error) {
    warn("Could not update .bowerbird/capabilities.json", error instanceof Error ? error.message : "Unknown capabilities error.");
  }

  ok("Saved context to .bowerbird/context.md");
  if (!vercelEnvLs.ok) {
    warn("Could not fully read Vercel env list.", vercelEnvLs.stderr || "Check Vercel login.");
  }
  return 0;
}

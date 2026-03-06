import { run } from "../core/runner";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../core/config";
import { patchState, readState } from "../core/state";
import { ProviderAdapter } from "./types";

function ensureString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function readLinkedProjectRef(projectRoot: string): Promise<string> {
  const configPath = path.resolve(projectRoot, "supabase", "config.toml");
  try {
    const raw = await readFile(configPath, "utf8");
    const match = raw.match(/^\s*project_id\s*=\s*["']([a-z0-9_-]+)["']/im);
    return match?.[1]?.trim() || "";
  } catch {
    return "";
  }
}

async function hasDeployableFunctions(projectRoot: string): Promise<boolean> {
  const functionsDir = path.resolve(projectRoot, "supabase", "functions");
  try {
    const entries = await readdir(functionsDir, { withFileTypes: true });
    const entryFiles = ["index.ts", "index.js", "main.ts", "main.js", "mod.ts"];
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
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export const supabaseAdapter: ProviderAdapter = {
  name: "supabase",
  supports(capability) {
    return capability === "supabase_functions";
  },
  async execute(capability, payload) {
    if (capability !== "supabase_functions") {
      return {
        ok: false,
        output: `Capability ${capability} is not supported by supabase adapter.`,
      };
    }

    const functionName = ensureString(payload?.functionName).trim();
    const configuredProjectRef = ensureString(payload?.projectRef).trim();
    if (!functionName) {
      return {
        ok: false,
        output: "Missing Supabase function name. Provide functionName.",
      };
    }

    const { projectRoot } = await getConfig();
    const deployableFunctionsExist = await hasDeployableFunctions(projectRoot);
    if (!deployableFunctionsExist) {
      return {
        ok: true,
        output: "No Supabase functions found in this project. Skipping backend deployment.",
      };
    }

    const linkedProjectRef = await readLinkedProjectRef(projectRoot);
    const projectRef = configuredProjectRef || linkedProjectRef;
    if (!projectRef) {
      return {
        ok: false,
        output: "Supabase project not linked. Run: supabase link",
      };
    }

    const result = await run("supabase", ["functions", "deploy", functionName, "--project-ref", projectRef]);
    if (result.exitCode === 0) {
      try {
        const current = await readState(projectRoot);
        await patchState(projectRoot, {
          supabase: {
            connected: true,
            projectRef,
            functions: [...new Set([...(current.supabase.functions ?? []), functionName])],
          },
          activity: {
            lastAction: "deploy_supabase_function",
            lastActionAt: new Date().toISOString(),
          },
        });
      } catch {
        // Keep deploy success even if state patch fails.
      }
    }
    return {
      ok: result.exitCode === 0,
      output: result.exitCode === 0
        ? `Deployed Supabase function ${functionName}.`
        : (result.stderr || result.stdout || "Supabase function deploy failed."),
    };
  },
};

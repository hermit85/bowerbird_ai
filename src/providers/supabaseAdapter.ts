import { run } from "../core/runner";
import { ProviderAdapter } from "./types";

function ensureString(value: unknown): string {
  return typeof value === "string" ? value : "";
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
    const projectRef = ensureString(payload?.projectRef).trim();
    if (!functionName) {
      return {
        ok: false,
        output: "Missing Supabase function name. Provide functionName.",
      };
    }
    if (!projectRef) {
      return {
        ok: false,
        output: "Missing Supabase project ref. Provide projectRef.",
      };
    }

    const result = await run("supabase", ["functions", "deploy", functionName, "--project-ref", projectRef]);
    return {
      ok: result.exitCode === 0,
      output: result.exitCode === 0
        ? `Deployed Supabase function ${functionName}.`
        : (result.stderr || result.stdout || "Supabase function deploy failed."),
    };
  },
};

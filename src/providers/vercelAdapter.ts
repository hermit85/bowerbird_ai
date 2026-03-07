import { deploy } from "../recipes/deploy";
import { run } from "../core/runner";
import { ProviderAdapter } from "./types";

function ensureString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export const vercelAdapter: ProviderAdapter = {
  name: "vercel",
  supports(capability) {
    return (
      capability === "deploy_preview" ||
      capability === "deploy_production" ||
      capability === "logs" ||
      capability === "env_management"
    );
  },
  async execute(capability, payload) {
    if (capability === "deploy_preview") {
      const code = await deploy([]);
      return {
        ok: code === 0,
        output: code === 0 ? "Preview deployment completed." : "Preview deployment failed.",
      };
    }

    if (capability === "deploy_production") {
      const code = await deploy(["--prod", "--yes"]);
      return {
        ok: code === 0,
        output: code === 0 ? "Production deployment completed." : "Production deployment failed.",
      };
    }

    if (capability === "logs") {
      const logs = await run("vercel", ["logs"]);
      return {
        ok: logs.exitCode === 0,
        output: logs.stdout || logs.stderr || "No logs returned.",
      };
    }

    if (capability === "env_management") {
      const key = ensureString(payload?.key).trim();
      const value = ensureString(payload?.value);
      const target = ensureString(payload?.target).trim() || "preview";

      if (!key) {
        return { ok: false, output: "Missing env key for Vercel env add." };
      }
      if (!value) {
        return { ok: false, output: `Missing value for env key ${key}.` };
      }

      const envAdd = await run("vercel", ["env", "add", key, target], { input: `${value}\n` });
      return {
        ok: envAdd.exitCode === 0,
        output: envAdd.exitCode === 0 ? `Added ${key} to Vercel (${target}).` : (envAdd.stderr || envAdd.stdout || "Vercel env add failed."),
      };
    }

    return {
      ok: false,
      output: `Capability ${capability} is not supported by vercel adapter.`,
    };
  },
};

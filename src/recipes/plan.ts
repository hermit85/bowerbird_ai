import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../core/config";
import { fail, ok, warn } from "../core/reporter";

type PlanStep =
  | { id: string; type: "vercel_env_add"; key: string; valueFrom: "prompt" }
  | { id: string; type: "vercel_deploy"; mode: "preview" };

type PlanDocument = {
  goal: string;
  steps: PlanStep[];
};

export async function plan(rawArgs: string[]): Promise<number> {
  const goal = rawArgs.join(" ").trim();
  if (!goal) {
    warn("Usage: bowerbird plan \"<goal text>\"");
    return 1;
  }

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

  const planDoc: PlanDocument = {
    goal,
    steps: [
      { id: "1", type: "vercel_env_add", key: "OPENAI_API_KEY", valueFrom: "prompt" },
      { id: "2", type: "vercel_deploy", mode: "preview" },
    ],
  };

  const planPath = path.resolve(metaDir, "plan.json");
  await writeFile(planPath, `${JSON.stringify(planDoc, null, 2)}\n`, "utf8");

  const planMd = [
    "# BowerBird Plan",
    "",
    `Goal: ${goal}`,
    "",
    "## Steps",
    "1. vercel_env_add",
    "   Adds the required environment variable in Vercel.",
    "   `valueFrom: prompt` means BowerBird will ask you interactively.",
    "2. vercel_deploy (preview)",
    "   Triggers a preview deployment.",
    "",
    "## Notes",
    "- Edit .bowerbird/plan.json to customize steps.",
    "- Supported v0 step types: vercel_env_add, vercel_deploy, vercel_logs.",
    "- Then run: bowerbird run [--dry]",
    "",
  ].join("\n");
  await writeFile(path.resolve(metaDir, "plan.md"), planMd, "utf8");

  ok("Saved .bowerbird/plan.json");
  ok("Saved .bowerbird/plan.md");
  return 0;
}

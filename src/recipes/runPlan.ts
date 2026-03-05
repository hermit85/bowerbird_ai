import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { getConfig } from "../core/config";
import { fail, ok, warn } from "../core/reporter";
import { run } from "../core/runner";

type VercelEnvAddStep = {
  id: string;
  type: "vercel_env_add";
  key: string;
  valueFrom: "prompt";
};

type VercelDeployStep = {
  id: string;
  type: "vercel_deploy";
  mode: "preview";
};

type VercelLogsStep = {
  id: string;
  type: "vercel_logs";
};

type AllowedStep = VercelEnvAddStep | VercelDeployStep | VercelLogsStep;

type PlanDocument = {
  goal: string;
  steps: AllowedStep[];
};

function parseDryFlag(rawArgs: string[]): boolean {
  return rawArgs.includes("--dry");
}

function validatePlan(value: unknown): { ok: true; plan: PlanDocument } | { ok: false; message: string } {
  if (!value || typeof value !== "object") {
    return { ok: false, message: "Plan must be a JSON object." };
  }

  const plan = value as { goal?: unknown; steps?: unknown };
  if (typeof plan.goal !== "string" || !plan.goal.trim()) {
    return { ok: false, message: "Plan.goal must be a non-empty string." };
  }
  if (!Array.isArray(plan.steps)) {
    return { ok: false, message: "Plan.steps must be an array." };
  }

  const parsedSteps: AllowedStep[] = [];
  for (const step of plan.steps) {
    if (!step || typeof step !== "object") {
      return { ok: false, message: "Every step must be an object." };
    }
    const raw = step as Record<string, unknown>;
    if (typeof raw.id !== "string" || !raw.id.trim()) {
      return { ok: false, message: "Each step.id must be a non-empty string." };
    }
    if (typeof raw.type !== "string") {
      return { ok: false, message: `Step ${raw.id} is missing type.` };
    }

    if (raw.type === "vercel_env_add") {
      if (typeof raw.key !== "string" || !raw.key.trim()) {
        return { ok: false, message: `Step ${raw.id}: vercel_env_add requires key.` };
      }
      if (raw.valueFrom !== "prompt") {
        return { ok: false, message: `Step ${raw.id}: vercel_env_add requires valueFrom: "prompt".` };
      }
      parsedSteps.push({
        id: raw.id,
        type: "vercel_env_add",
        key: raw.key,
        valueFrom: "prompt",
      });
      continue;
    }

    if (raw.type === "vercel_deploy") {
      if (raw.mode !== "preview") {
        return { ok: false, message: `Step ${raw.id}: vercel_deploy only supports mode: "preview".` };
      }
      parsedSteps.push({
        id: raw.id,
        type: "vercel_deploy",
        mode: "preview",
      });
      continue;
    }

    if (raw.type === "vercel_logs") {
      parsedSteps.push({
        id: raw.id,
        type: "vercel_logs",
      });
      continue;
    }

    return { ok: false, message: `Unknown step type "${raw.type}" in step ${raw.id}.` };
  }

  return {
    ok: true,
    plan: {
      goal: plan.goal.trim(),
      steps: parsedSteps,
    },
  };
}

function renderDryCommand(step: AllowedStep): string {
  if (step.type === "vercel_env_add") {
    return `vercel env add ${step.key} preview`;
  }
  if (step.type === "vercel_deploy") {
    return "vercel deploy --yes";
  }
  return "vercel logs";
}

async function promptSecret(label: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const value = await rl.question(`Enter value for ${label}: `);
    return value;
  } finally {
    rl.close();
  }
}

export async function runPlan(rawArgs: string[]): Promise<number> {
  const dry = parseDryFlag(rawArgs);

  let projectRoot: string;
  try {
    const config = await getConfig();
    projectRoot = config.projectRoot;
  } catch (error) {
    fail("Config validation failed", error instanceof Error ? error.message : "Unknown error.");
    return 1;
  }

  const metaDir = path.resolve(projectRoot, ".bowerbird");
  const planPath = path.resolve(metaDir, "plan.json");

  let planRaw: string;
  try {
    planRaw = await readFile(planPath, "utf8");
  } catch {
    warn("No plan found at .bowerbird/plan.json. Run `bowerbird plan \"<goal>\"` first.");
    return 1;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(planRaw);
  } catch {
    fail("Invalid JSON in .bowerbird/plan.json");
    return 1;
  }

  const validated = validatePlan(parsedJson);
  if (!validated.ok) {
    fail("Invalid plan", validated.message);
    return 1;
  }

  if (dry) {
    ok("Dry run mode.");
    for (const step of validated.plan.steps) {
      ok(`Step ${step.id}: ${renderDryCommand(step)}`);
    }
    return 0;
  }

  const commandLogs: string[] = [];
  for (const step of validated.plan.steps) {
    if (step.type === "vercel_env_add") {
      const secret = await promptSecret(step.key);
      const envAdd = await run("vercel", ["env", "add", step.key, "preview"], {
        input: `${secret}\n`,
      });
      commandLogs.push(
        [
          `$ vercel env add ${step.key} preview`,
          `exitCode: ${envAdd.exitCode}`,
          "stdout:",
          "[redacted]",
          "stderr:",
          envAdd.exitCode === 0 ? "(empty)" : "[redacted]",
          "",
        ].join("\n"),
      );
      if (envAdd.exitCode !== 0) {
        await mkdir(metaDir, { recursive: true });
        await writeFile(path.resolve(metaDir, "last_run_log.txt"), commandLogs.join("\n"), "utf8");
        fail(`Step ${step.id} failed`, "vercel_env_add failed.");
        return 1;
      }
      ok(`Step ${step.id} complete: added ${step.key}`);
      continue;
    }

    if (step.type === "vercel_deploy") {
      const deploy = await run("vercel", ["deploy", "--yes"]);
      commandLogs.push(
        [
          "$ vercel deploy --yes",
          `exitCode: ${deploy.exitCode}`,
          "stdout:",
          deploy.stdout || "(empty)",
          "stderr:",
          deploy.stderr || "(empty)",
          "",
        ].join("\n"),
      );
      if (deploy.exitCode !== 0) {
        await mkdir(metaDir, { recursive: true });
        await writeFile(path.resolve(metaDir, "last_run_log.txt"), commandLogs.join("\n"), "utf8");
        fail(`Step ${step.id} failed`, "vercel_deploy failed.");
        return 1;
      }
      ok(`Step ${step.id} complete: preview deploy triggered`);
      continue;
    }

    const logs = await run("vercel", ["logs"]);
    commandLogs.push(
      [
        "$ vercel logs",
        `exitCode: ${logs.exitCode}`,
        "stdout:",
        logs.stdout || "(empty)",
        "stderr:",
        logs.stderr || "(empty)",
        "",
      ].join("\n"),
    );
    if (logs.exitCode !== 0) {
      await mkdir(metaDir, { recursive: true });
      await writeFile(path.resolve(metaDir, "last_run_log.txt"), commandLogs.join("\n"), "utf8");
      fail(`Step ${step.id} failed`, "vercel_logs failed.");
      return 1;
    }
    ok(`Step ${step.id} complete: logs fetched`);
  }

  await mkdir(metaDir, { recursive: true });
  await writeFile(path.resolve(metaDir, "last_run_log.txt"), commandLogs.join("\n"), "utf8");
  ok("Plan run complete. Logs saved to .bowerbird/last_run_log.txt");
  return 0;
}

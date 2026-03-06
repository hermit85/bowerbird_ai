import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { execa } from "execa";
import { assertNotDryRun, getDryRun, isDryRun } from "../core/dryRun";
import { fail, ok, warn } from "../core/reporter";
import { run } from "../core/runner";
import { getConfig } from "../core/config";
import { patchState, readState } from "../core/state";
import { DoPlan, normalizeInstruction, parseDoInstruction } from "../core/doParser";
import { getAdapterForCapability } from "../providers";

function parseArgs(rawArgs: string[]): { dry: boolean; inlineInstruction: string | null } {
  const dry = isDryRun(rawArgs) || getDryRun();
  const instructionParts = rawArgs.filter((arg) => arg !== "--dry");
  const inlineInstruction = instructionParts.join(" ").trim();
  return { dry, inlineInstruction: inlineInstruction.length > 0 ? inlineInstruction : null };
}

async function readClipboardInstruction(): Promise<string> {
  assertNotDryRun("read clipboard instruction");
  if (process.platform !== "darwin") {
    throw new Error("`bowerbird do` currently supports clipboard parsing on macOS only.");
  }

  const paste = await execa("pbpaste", [], { reject: false });
  if ((paste.exitCode ?? 1) !== 0) {
    throw new Error("pbpaste failed. Copy instruction text to clipboard and retry.");
  }

  const instruction = paste.stdout ?? "";
  if (!instruction.trim()) {
    throw new Error("Clipboard is empty. Copy an instruction first.");
  }

  return instruction;
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

function planToMarkdown(plan: DoPlan): string {
  const lines = [
    "# bowerbird do plan",
    "",
    `Detected task: ${plan.detectedTask}`,
    "",
    "## Source instruction",
    "",
    plan.sourceText,
    "",
    "## Steps",
    "",
  ];

  for (const [idx, step] of plan.steps.entries()) {
    lines.push(`${idx + 1}. ${step.title}`);
    lines.push(`   - Command: \`${step.cmd} ${step.args.join(" ")}\``);
  }

  return `${lines.join("\n")}\n`;
}

async function writeArtifacts(plan: DoPlan, logText: string): Promise<void> {
  const { projectRoot } = await getConfig();
  const dir = path.resolve(projectRoot, ".bowerbird");
  await mkdir(dir, { recursive: true });

  await writeFile(path.resolve(dir, "do_last_plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  await writeFile(path.resolve(dir, "do_last_plan.md"), planToMarkdown(plan), "utf8");
  await writeFile(path.resolve(dir, "do_last_run_log.txt"), `${logText.trim()}\n`, "utf8");
}

function formatStep(step: DoPlan["steps"][number]): string {
  return `${step.cmd} ${step.args.join(" ")}`.trim();
}

export async function doCommand(rawArgs: string[] = []): Promise<number> {
  const { dry, inlineInstruction } = parseArgs(rawArgs);
  let projectRoot = process.cwd();

  try {
    const config = await getConfig();
    projectRoot = config.projectRoot;
  } catch {
    // Existing command handlers already surface actionable errors when config is required.
  }

  let instruction = inlineInstruction;
  try {
    if (!instruction) {
      if (dry) {
        warn('Dry run needs an inline instruction. Example: bowerbird do --dry "deploy preview"');
        return 0;
      }
      instruction = await readClipboardInstruction();
    }
  } catch (error) {
    warn(error instanceof Error ? error.message : "Failed to read instruction.");
    return 1;
  }

  const parsed = parseDoInstruction(instruction);
  if (!parsed) {
    const normalized = normalizeInstruction(instruction);
    console.log(`[DEBUG] normalized instruction: "${normalized}"`);
    warn("I couldn't understand this instruction.");
    warn(
      "Try one of: 'deploy preview', 'deploy production', 'add env KEY to vercel', 'deploy supabase function NAME --project-ref REF'.",
    );
    return 1;
  }

  if (dry) {
    // Regression guard: dry-run must never call run(), deploy(), execa(), or any command executor.
    for (const [index, step] of parsed.steps.entries()) {
      console.log(`${index + 1}. ${formatStep(step)}`);
    }
    try {
      await patchState(projectRoot, {
        activity: {
          lastAction: "preview_plan",
          lastActionAt: new Date().toISOString(),
        },
      });
    } catch {
      // Keep dry-run success if state write fails.
    }
    await writeArtifacts(parsed, `dry_run=true\nsteps=${parsed.steps.map(formatStep).join("\n")}`);
    return 0;
  }

  if (parsed.detectedTask === "vercel_env_add") {
    const key = parsed.metadata?.key;
    if (!key) {
      fail("Failed to parse env key from instruction.");
      return 1;
    }

    ok(`Detected instruction: add env ${key} to Vercel`);
    const value = await promptSecret(key);
    const adapter = getAdapterForCapability("env_management");
    if (!adapter) {
      fail("No provider adapter found for env management.");
      return 1;
    }
    const result = await adapter.execute("env_management", { key, value, target: "preview" });
    if (!result.ok) {
      fail("Failed to add Vercel environment variable.", result.output);
      await writeArtifacts(parsed, `exitCode=1\n${result.output}`);
      return 1;
    }

    ok(`Added ${key} to Vercel.`);
    try {
      const current = await readState(projectRoot);
      const knownKeys = [...new Set([...(current.env.knownKeys ?? []), key])];
      await patchState(projectRoot, {
        env: { knownKeys },
        vercel: { connected: true },
        activity: {
          lastAction: "vercel_env_add",
          lastActionAt: new Date().toISOString(),
        },
      });
    } catch {
      // Keep command success if state write fails.
    }
    await writeArtifacts(parsed, "exitCode=0\nvercel env add success");
    return 0;
  }

  if (parsed.detectedTask === "supabase_function_deploy") {
    const functionName = parsed.metadata?.functionName;
    const projectRef = parsed.metadata?.projectRef;
    if (!functionName || !projectRef) {
      fail("Failed to parse Supabase function deployment arguments.");
      return 1;
    }

    ok(`Detected instruction: deploy supabase function ${functionName}`);
    const adapter = getAdapterForCapability("supabase_functions");
    if (!adapter) {
      fail("No provider adapter found for Supabase functions.");
      return 1;
    }
    const result = await adapter.execute("supabase_functions", { functionName, projectRef });
    if (!result.ok) {
      fail("Failed to deploy Supabase function.", result.output);
      await writeArtifacts(parsed, `exitCode=1\n${result.output}`);
      return 1;
    }

    ok(`Deployed Supabase function ${functionName}.`);
    try {
      const current = await readState(projectRoot);
      const functions = [...new Set([...(current.supabase.functions ?? []), functionName])];
      await patchState(projectRoot, {
        supabase: {
          connected: true,
          projectRef,
          functions,
        },
        activity: {
          lastAction: "supabase_function_deploy",
          lastActionAt: new Date().toISOString(),
        },
      });
    } catch {
      // Keep command success if state write fails.
    }
    await writeArtifacts(parsed, `exitCode=0\nsupabase functions deploy ${functionName}`);
    return 0;
  }

  if (parsed.detectedTask === "deploy_production") {
    ok("Detected instruction: deploy production");
    const adapter = getAdapterForCapability("deploy_production");
    if (!adapter) {
      fail("No provider adapter found for production deployment.");
      return 1;
    }
    const result = await adapter.execute("deploy_production");
    await writeArtifacts(parsed, `exitCode=${result.ok ? 0 : 1}\n${result.output}\ndeploy_production`);
    return result.ok ? 0 : 1;
  }

  ok("Detected instruction: deploy preview");
  const adapter = getAdapterForCapability("deploy_preview");
  if (!adapter) {
    fail("No provider adapter found for preview deployment.");
    return 1;
  }
  const result = await adapter.execute("deploy_preview");
  await writeArtifacts(parsed, `exitCode=${result.ok ? 0 : 1}\n${result.output}\ndeploy_preview`);
  return result.ok ? 0 : 1;
}

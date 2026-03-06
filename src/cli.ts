#!/usr/bin/env node
import { doctor } from "./recipes/doctor";
import { deploy } from "./recipes/deploy";
import { fixDeploy } from "./recipes/fixDeploy";
import { init } from "./recipes/init";
import { ship } from "./recipes/ship";
import { autoprompt } from "./recipes/autoprompt";
import { fix } from "./recipes/fix";
import { repair } from "./recipes/repair";
import { applyPatch } from "./recipes/applyPatch";
import { repairLoop } from "./recipes/repairLoop";
import { go } from "./recipes/go";
import { pastePatch } from "./recipes/pastePatch";
import { capture } from "./recipes/capture";
import { plan } from "./recipes/plan";
import { runPlan } from "./recipes/runPlan";
import { doCommand } from "./recipes/do";
import { consoleCommand } from "./recipes/console";
import { isDryRun, setDryRun } from "./core/dryRun";

function printHelp(): void {
  console.log("Usage: bowerbird <command> [options]");
  console.log("");
  console.log("Commands:");
  console.log("  doctor        Run environment and tooling diagnostics");
  console.log("  init          Create starter BowerBird setup files");
  console.log("  deploy        Commit/push and trigger Vercel deploy");
  console.log("  fix-deploy    Deploy with automatic error brief on failure");
  console.log("  ship          Run doctor, build, then deploy");
  console.log("  autoprompt    Generate AI prompt from .bowerbird/last_error.md");
  console.log("  fix           Attempt auto-fix deploy, then generate prompt on failure");
  console.log("  repair        Analyze deploy failure and generate repair prompt");
  console.log("  apply-patch   Apply .bowerbird/repair_patch.diff and commit");
  console.log("  repair-loop   Run ship -> repair -> apply-patch loop");
  console.log("  go            Founder workflow: repair-loop --max 3 --copy");
  console.log("  paste-patch   Save clipboard patch into .bowerbird and sanitize it");
  console.log("  capture       Capture local + infra context into .bowerbird/context.md");
  console.log("  plan          Create .bowerbird/plan.json and .bowerbird/plan.md");
  console.log("  run           Execute .bowerbird/plan.json (use --dry to preview)");
  console.log("  do            Translate & execute AI instructions from clipboard");
  console.log("  console       Start local web console on http://127.0.0.1:4311");
  console.log("");
  console.log("Options:");
  console.log("  --config      TODO: custom config path override");
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const dryRun = isDryRun(rawArgs);
  setDryRun(dryRun);
  if (dryRun) {
    console.log("DRY RUN: no commands executed.");
  }

  const args = rawArgs.filter((arg) => arg !== "--dry");
  const command = args[0];
  const hasConfigFlag = args.includes("--config");

  // TODO: wire --config to getConfig()/run once override support is added.
  if (hasConfigFlag) {
    console.warn("`--config` is not implemented yet. Using operator.config.json in current directory.");
  }

  if (command === "doctor") {
    const code = await doctor();
    process.exitCode = code;
    return;
  }

  if (command === "init") {
    const code = await init();
    process.exitCode = code;
    return;
  }

  if (command === "deploy") {
    const code = await deploy(args.slice(1));
    process.exitCode = code;
    return;
  }

  if (command === "fix-deploy" || command === "fixdeploy") {
    const code = await fixDeploy(args.slice(1));
    process.exitCode = code;
    return;
  }

  if (command === "ship") {
    const code = await ship(args.slice(1));
    process.exitCode = code;
    return;
  }

  if (command === "autoprompt" || command === "prompt") {
    const code = await autoprompt();
    process.exitCode = code;
    return;
  }

  if (command === "fix") {
    const code = await fix(args.slice(1));
    process.exitCode = code;
    return;
  }

  if (command === "repair") {
    const code = await repair(args.slice(1));
    process.exitCode = code;
    return;
  }

  if (command === "apply-patch") {
    const code = await applyPatch();
    process.exitCode = code;
    return;
  }

  if (command === "repair-loop") {
    const code = await repairLoop(args.slice(1));
    process.exitCode = code;
    return;
  }

  if (command === "go") {
    const code = await go();
    process.exitCode = code;
    return;
  }

  if (command === "paste-patch") {
    const code = await pastePatch();
    process.exitCode = code;
    return;
  }

  if (command === "capture") {
    const code = await capture();
    process.exitCode = code;
    return;
  }

  if (command === "plan") {
    const code = await plan(args.slice(1));
    process.exitCode = code;
    return;
  }

  if (command === "run") {
    const code = await runPlan(args.slice(1));
    process.exitCode = code;
    return;
  }

  if (command === "do") {
    const code = await doCommand(args.slice(1));
    process.exitCode = code;
    return;
  }

  if (command === "console") {
    const code = await consoleCommand();
    process.exitCode = code;
    return;
  }

  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.message : "Unexpected error while running CLI.";
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});

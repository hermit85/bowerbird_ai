import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { getDryRun } from "../core/dryRun";
import { getConfig } from "../core/config";
import { fail, ok, warn } from "../core/reporter";
import { run, type RunResult } from "../core/runner";

type DeployOptions = {
  prod: boolean;
  message: string;
};

type FailedStep = {
  step: string;
  cmd: string;
  args: string[];
  stdout: string;
  stderr: string;
};

function parseArgs(args: string[]): DeployOptions {
  let prod = false;
  let message = "chore: deploy";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--prod") {
      prod = true;
      continue;
    }

    if (arg === "--message") {
      const value = args[i + 1];
      if (value && !value.startsWith("--")) {
        message = value;
        i += 1;
      }
    }
  }

  return { prod, message };
}

function truncateLastLines(text: string, maxLines = 120): string {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return "No output.";
  }
  return lines.slice(-maxLines).join("\n");
}

function commandLog(cmd: string, args: string[], result: RunResult): string {
  return [
    `$ ${cmd} ${args.join(" ")}`.trim(),
    `exitCode: ${result.exitCode}`,
    "stdout:",
    result.stdout || "(empty)",
    "stderr:",
    result.stderr || "(empty)",
    `durationMs: ${result.durationMs}`,
    "",
  ].join("\n");
}

function extractDeploymentUrl(output: string): string | null {
  const tokens = output.split(/\s+/).map((token) => token.replace(/[),.;]+$/g, ""));
  const vercelTokens = tokens.filter((token) =>
    /^https:\/\/[a-zA-Z0-9.-]+\.vercel\.app(?:\/\S*)?$/.test(token),
  );
  if (vercelTokens.length > 0) {
    return vercelTokens[vercelTokens.length - 1] ?? null;
  }

  const genericUrls = tokens.filter((token) => /^https?:\/\/\S+$/.test(token));
  if (genericUrls.length > 0) {
    return genericUrls[genericUrls.length - 1] ?? null;
  }

  return null;
}

function isNothingToCommitOutput(result: RunResult): boolean {
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return (
    text.includes("nothing to commit") ||
    text.includes("no changes added to commit") ||
    text.includes("working tree clean")
  );
}

async function confirmProdDeploy(): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question("Deploy to production? (yes/no): ");
    return answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

async function runStep(
  step: string,
  cmd: string,
  args: string[],
): Promise<{ ok: true; result: RunResult } | { ok: false; failed: FailedStep }> {
  try {
    const result = await run(cmd, args);
    if (result.exitCode === 0) {
      ok(step);
      return { ok: true, result };
    }

    const failed = {
      step,
      cmd,
      args,
      stdout: result.stdout,
      stderr: result.stderr,
    };
    fail(step, truncateLastLines(result.stderr || result.stdout, 60));
    return { ok: false, failed };
  } catch (error) {
    const failed = {
      step,
      cmd,
      args,
      stdout: "",
      stderr: error instanceof Error ? error.message : "Unknown execution error.",
    };
    fail(step, truncateLastLines(failed.stderr, 60));
    return { ok: false, failed };
  }
}

async function saveDeployArtifacts(
  projectRoot: string,
  deployUrl: string | null,
  logs: string[],
): Promise<void> {
  const metaDir = path.resolve(projectRoot, ".bowerbird");
  await mkdir(metaDir, { recursive: true });
  const now = new Date().toISOString();
  const lastDeployText = [`timestamp=${now}`, `url=${deployUrl ?? "unknown"}`].join("\n");
  await writeFile(path.resolve(metaDir, "last_deploy.txt"), `${lastDeployText}\n`, "utf8");
  await writeFile(path.resolve(metaDir, "last_deploy_log.txt"), logs.join("\n"), "utf8");
}

async function saveDeployLog(projectRoot: string, logs: string[]): Promise<void> {
  const metaDir = path.resolve(projectRoot, ".bowerbird");
  await mkdir(metaDir, { recursive: true });
  await writeFile(path.resolve(metaDir, "last_deploy_log.txt"), logs.join("\n"), "utf8");
}

function failedCommandLog(failed: FailedStep): string {
  return [
    `$ ${failed.cmd} ${failed.args.join(" ")}`.trim(),
    "exitCode: 1",
    "stdout:",
    failed.stdout || "(empty)",
    "stderr:",
    failed.stderr || "(empty)",
    "",
  ].join("\n");
}

async function saveErrorBrief(projectRoot: string, failed: FailedStep): Promise<void> {
  const metaDir = path.resolve(projectRoot, ".bowerbird");
  await mkdir(metaDir, { recursive: true });
  const now = new Date().toISOString();
  const attempted = `$ ${failed.cmd} ${failed.args.join(" ")}`.trim();
  const body = [
    "# Bowerbird Deploy Error Brief",
    "",
    `timestamp: ${now}`,
    `failed_step: ${failed.step}`,
    `command: ${attempted}`,
    "",
    "## stdout (last 120 lines)",
    "```",
    truncateLastLines(failed.stdout, 120),
    "```",
    "",
    "## stderr (last 120 lines)",
    "```",
    truncateLastLines(failed.stderr, 120),
    "```",
    "",
    "## Paste this into Codex/Claude to get a patch",
    "```text",
    "My deploy failed. Please propose a patch based on this error brief:",
    `- Failed step: ${failed.step}`,
    `- Command: ${attempted}`,
    "Focus on the root cause and return minimal code changes.",
    "```",
    "",
  ].join("\n");
  await writeFile(path.resolve(metaDir, "last_error.md"), body, "utf8");
}

async function exitWithErrorBrief(
  projectRoot: string,
  failed: FailedStep,
  logs: string[],
): Promise<number> {
  try {
    await saveDeployLog(projectRoot, [...logs, failedCommandLog(failed)]);
    await saveErrorBrief(projectRoot, failed);
    console.log("Saved error brief to .bowerbird/last_error.md");
  } catch (error) {
    warn(
      "Failed to save .bowerbird/last_error.md",
      error instanceof Error ? error.message : "Unknown file write error.",
    );
  }
  return 1;
}

export async function fixDeploy(rawArgs: string[]): Promise<number> {
  const options = parseArgs(rawArgs);
  const logs: string[] = [];

  let projectRoot = process.cwd();
  try {
    const config = await getConfig();
    projectRoot = config.projectRoot;
    ok(`Deploy mode: ${options.prod ? "production" : "preview"}`);
  } catch (error) {
    fail("Config validation failed", error instanceof Error ? error.message : "Unknown error.");
    return 1;
  }

  const statusStep = await runStep("git status", "git", ["status", "--porcelain"]);
  if (!statusStep.ok) {
    return exitWithErrorBrief(projectRoot, statusStep.failed, logs);
  }
  logs.push(commandLog("git", ["status", "--porcelain"], statusStep.result));

  if (statusStep.result.stdout.trim().length > 0) {
    const addStep = await runStep("git add", "git", ["add", "."]);
    if (!addStep.ok) {
      return exitWithErrorBrief(projectRoot, addStep.failed, logs);
    }
    logs.push(commandLog("git", ["add", "."], addStep.result));

    try {
      const commitResult = await run("git", ["commit", "-m", options.message]);
      logs.push(commandLog("git", ["commit", "-m", options.message], commitResult));
      if (commitResult.exitCode === 0) {
        ok("git commit");
      } else if (isNothingToCommitOutput(commitResult)) {
        ok("git commit (nothing to commit)");
      } else {
        const failed: FailedStep = {
          step: "git commit",
          cmd: "git",
          args: ["commit", "-m", options.message],
          stdout: commitResult.stdout,
          stderr: commitResult.stderr,
        };
        fail("git commit", truncateLastLines(commitResult.stderr || commitResult.stdout, 60));
        return exitWithErrorBrief(projectRoot, failed, logs);
      }
    } catch (error) {
      const failed: FailedStep = {
        step: "git commit",
        cmd: "git",
        args: ["commit", "-m", options.message],
        stdout: "",
        stderr: error instanceof Error ? error.message : "Unknown execution error.",
      };
      fail("git commit", truncateLastLines(failed.stderr, 60));
      return exitWithErrorBrief(projectRoot, failed, logs);
    }
  } else {
    ok("git commit skipped (clean tree)");
  }

  const pushStep = await runStep("git push", "git", ["push"]);
  if (!pushStep.ok) {
    return exitWithErrorBrief(projectRoot, pushStep.failed, logs);
  }
  logs.push(commandLog("git", ["push"], pushStep.result));

  if (options.prod && !getDryRun()) {
    const confirmed = await confirmProdDeploy();
    if (!confirmed) {
      warn("Production deploy canceled by user");
      return 0;
    }
  } else if (options.prod) {
    ok("Dry run: skipped production confirmation prompt");
  }

  const vercelArgs = options.prod ? ["--prod", "--yes"] : ["deploy", "--yes"];
  const vercelStep = await runStep("vercel deploy", "vercel", vercelArgs);
  if (!vercelStep.ok) {
    return exitWithErrorBrief(projectRoot, vercelStep.failed, logs);
  }
  logs.push(commandLog("vercel", vercelArgs, vercelStep.result));

  const deployOutput = `${vercelStep.result.stdout}\n${vercelStep.result.stderr}`;
  const deployUrl = extractDeploymentUrl(deployOutput);
  if (deployUrl) {
    ok(`Deployment URL: ${deployUrl}`);
  } else {
    warn("Could not extract deployment URL from Vercel output");
  }

  try {
    await saveDeployArtifacts(projectRoot, deployUrl, logs);
    ok("Saved deploy artifacts to .bowerbird/");
  } catch (error) {
    warn(
      "Deploy completed but failed to persist logs",
      error instanceof Error ? error.message : "Unknown file write error.",
    );
  }

  return 0;
}

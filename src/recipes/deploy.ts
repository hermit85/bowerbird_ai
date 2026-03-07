import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDryRun } from "../core/dryRun";
import { getConfig } from "../core/config";
import { fail, ok, warn } from "../core/reporter";
import { patchState } from "../core/state";
import { run, type RunResult } from "../core/runner";

type DeployOptions = {
  prod: boolean;
  message: string;
  autoConfirm: boolean;
};

function parseArgs(args: string[]): DeployOptions {
  let prod = false;
  let message = "chore: deploy";
  let autoConfirm = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--prod") {
      prod = true;
      continue;
    }

    if (arg === "--yes" || arg === "--confirm" || arg === "--non-interactive") {
      autoConfirm = true;
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

  return { prod, message, autoConfirm };
}

function truncateLastLines(text: string, maxLines = 60): string {
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

async function executeOrBlock(
  cmd: string,
  args: string[],
  label: string,
): Promise<{ ok: true; result: RunResult } | { ok: false }> {
  try {
    const result = await run(cmd, args);
    if (result.exitCode === 0) {
      ok(label);
      return { ok: true, result };
    }

    fail(label, truncateLastLines(result.stderr || result.stdout));
    return { ok: false };
  } catch (error) {
    fail(label, error instanceof Error ? error.message : "Unknown execution error.");
    return { ok: false };
  }
}

export async function deploy(rawArgs: string[]): Promise<number> {
  const options = parseArgs(rawArgs);
  const dryRun = getDryRun();
  const logs: string[] = [];

  let projectRoot: string;
  try {
    const config = await getConfig();
    projectRoot = config.projectRoot;
    ok(`Deploy mode: ${options.prod ? "production" : "preview"}`);
  } catch (error) {
    fail("Config validation failed", error instanceof Error ? error.message : "Unknown error.");
    return 1;
  }

  if (dryRun) {
    ok("Planned: git status --porcelain");
    ok("Planned: git add . (if changes detected)");
    ok(`Planned: git commit -m "${options.message}" (if changes detected)`);
    ok("Planned: git push");
    if (options.prod && !options.autoConfirm) {
      ok("Planned: skip production deploy (not enabled)");
    }
    if (options.prod) {
      ok("Planned: vercel --prod --yes");
    } else {
      ok("Planned: vercel deploy --yes");
    }
    ok("Deploy dry run complete");
    return 0;
  }

  const statusCheck = await executeOrBlock("git", ["status", "--porcelain"], "Checked git status");
  if (!statusCheck.ok) {
    return 1;
  }
  logs.push(commandLog("git", ["status", "--porcelain"], statusCheck.result));

  const hasChanges = statusCheck.result.stdout.trim().length > 0;
  if (hasChanges) {
    const addStep = await executeOrBlock("git", ["add", "."], "Staged changes");
    if (!addStep.ok) {
      return 1;
    }
    logs.push(commandLog("git", ["add", "."], addStep.result));

    try {
      const commitResult = await run("git", ["commit", "-m", options.message]);
      logs.push(commandLog("git", ["commit", "-m", options.message], commitResult));

      if (commitResult.exitCode === 0) {
        ok("Created commit");
      } else if (isNothingToCommitOutput(commitResult)) {
        ok("No new commit needed");
      } else {
        fail("Failed to create commit", truncateLastLines(commitResult.stderr || commitResult.stdout));
        return 1;
      }
    } catch (error) {
      fail("Failed to create commit", error instanceof Error ? error.message : "Unknown execution error.");
      return 1;
    }
  } else {
    ok("Working tree is clean, skipping commit");
  }

  const pushStep = await executeOrBlock("git", ["push"], "Pushed git changes");
  if (!pushStep.ok) {
    return 1;
  }
  logs.push(commandLog("git", ["push"], pushStep.result));

  if (options.prod && !options.autoConfirm) {
    warn("Production deploy not enabled.");
    return 0;
  }

  const vercelArgs = options.prod ? ["--prod", "--yes"] : ["deploy", "--yes"];
  const vercelStep = await executeOrBlock(
    "vercel",
    vercelArgs,
    `Vercel ${options.prod ? "production" : "preview"} deploy finished`,
  );
  if (!vercelStep.ok) {
    return 1;
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
    const metaDir = path.resolve(projectRoot, ".bowerbird");
    await mkdir(metaDir, { recursive: true });
    const now = new Date().toISOString();
    const lastDeployText = [`timestamp=${now}`, `url=${deployUrl ?? "unknown"}`].join("\n");
    await writeFile(path.resolve(metaDir, "last_deploy.txt"), `${lastDeployText}\n`, "utf8");
    await writeFile(path.resolve(metaDir, "last_deploy_log.txt"), logs.join("\n"), "utf8");
    ok("Saved deploy artifacts to .bowerbird/");
  } catch (error) {
    warn(
      "Deploy completed but failed to persist logs",
      error instanceof Error ? error.message : "Unknown file write error.",
    );
  }

  try {
    await patchState(projectRoot, {
      project: {
        name: path.basename(projectRoot),
        root: projectRoot,
      },
      vercel: {
        connected: true,
        lastDeployUrl: deployUrl,
        lastDeployAt: new Date().toISOString(),
      },
      activity: {
        lastAction: options.prod ? "deploy_production" : "deploy_preview",
        lastActionAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    warn("Deploy completed but failed to update state.json", error instanceof Error ? error.message : "Unknown state error.");
  }

  return 0;
}

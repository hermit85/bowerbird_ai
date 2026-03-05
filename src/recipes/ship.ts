import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../core/config";
import { fail, ok, warn } from "../core/reporter";
import { deploy } from "./deploy";
import { doctor } from "./doctor";
import { run } from "../core/runner";

type ShipOptions = {
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

function parseArgs(args: string[]): ShipOptions {
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

async function ensureErrorBrief(projectRoot: string, failed: FailedStep): Promise<void> {
  try {
    await saveErrorBrief(projectRoot, failed);
    console.log("Saved error brief to .bowerbird/last_error.md");
  } catch (error) {
    warn(
      "Failed to save .bowerbird/last_error.md",
      error instanceof Error ? error.message : "Unknown file write error.",
    );
  }
}

async function hasBuildScript(projectRoot: string): Promise<boolean> {
  const packageJsonPath = path.resolve(projectRoot, "package.json");
  await access(packageJsonPath);
  const raw = await readFile(packageJsonPath, "utf8");
  const pkg = JSON.parse(raw) as { scripts?: Record<string, unknown> };
  return typeof pkg.scripts?.build === "string" && pkg.scripts.build.length > 0;
}

export async function ship(rawArgs: string[]): Promise<number> {
  const parsed = parseArgs(rawArgs);
  const forwardArgs = parsed.prod
    ? parsed.message === "chore: deploy"
      ? ["--prod"]
      : ["--prod", "--message", parsed.message]
    : parsed.message === "chore: deploy"
      ? []
      : ["--message", parsed.message];

  let projectRoot = process.cwd();
  try {
    const config = await getConfig();
    projectRoot = config.projectRoot;
  } catch (error) {
    fail("Config validation failed", error instanceof Error ? error.message : "Unknown error.");
    return 1;
  }

  ok("Running doctor");
  const doctorCode = await doctor();
  if (doctorCode !== 0) {
    fail("Doctor checks failed");
    return doctorCode;
  }

  let runBuild = false;
  let packageJsonExists = true;
  try {
    runBuild = await hasBuildScript(projectRoot);
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      packageJsonExists = false;
    } else {
      const details = error instanceof Error ? error.message : "Unknown package.json read error.";
      warn("Build script detection failed", details);
    }
  }

  if (!packageJsonExists) {
    warn("package.json not found, skipping build");
  } else if (!runBuild) {
    warn("Build script not found, skipping build");
  }

  if (runBuild) {
    ok("Running build: npm run build");
    try {
      const buildResult = await run("npm", ["run", "build"]);
      if (buildResult.exitCode === 0) {
        ok("Build passed");
      } else {
        fail("Build failed", truncateLastLines(buildResult.stderr || buildResult.stdout, 60));
        await ensureErrorBrief(projectRoot, {
          step: "npm run build",
          cmd: "npm",
          args: ["run", "build"],
          stdout: buildResult.stdout,
          stderr: buildResult.stderr,
        });
        return 1;
      }
    } catch (error) {
      const stderr = error instanceof Error ? error.message : "Unknown execution error.";
      fail("Build failed", truncateLastLines(stderr, 60));
      await ensureErrorBrief(projectRoot, {
        step: "npm run build",
        cmd: "npm",
        args: ["run", "build"],
        stdout: "",
        stderr,
      });
      return 1;
    }
  }
  const deployCode = await deploy(forwardArgs);
  if (deployCode !== 0) {
    fail("Deploy failed");
    await ensureErrorBrief(projectRoot, {
      step: "deploy",
      cmd: "bowerbird",
      args: ["deploy", ...forwardArgs],
      stdout: "",
      stderr: "Deploy returned a non-zero exit code. Check terminal output above.",
    });
    return 1;
  }

  const lastDeployPath = path.resolve(projectRoot, ".bowerbird", "last_deploy.txt");
  try {
    const lastDeploy = await readFile(lastDeployPath, "utf8");
    const urlLine = lastDeploy
      .split(/\r?\n/)
      .find((line) => line.startsWith("url="));
    const url = urlLine?.slice(4).trim();
    if (url) {
      ok(`Ship complete: ${url}`);
      return 0;
    }
  } catch {
    // Keep default completion message when deploy metadata is unavailable.
  }

  ok("Ship complete");
  return 0;
}

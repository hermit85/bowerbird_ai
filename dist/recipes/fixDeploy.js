import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { getConfig } from "../core/config";
import { fail, ok, warn } from "../core/reporter";
import { run } from "../core/runner";
function parseArgs(args) {
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
function truncateLastLines(text, maxLines = 120) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
        return "No output.";
    }
    return lines.slice(-maxLines).join("\n");
}
function commandLog(cmd, args, result) {
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
function extractDeploymentUrl(output) {
    const tokens = output.split(/\s+/).map((token) => token.replace(/[),.;]+$/g, ""));
    const vercelTokens = tokens.filter((token) => /^https:\/\/[a-zA-Z0-9.-]+\.vercel\.app(?:\/\S*)?$/.test(token));
    if (vercelTokens.length > 0) {
        return vercelTokens[vercelTokens.length - 1] ?? null;
    }
    const genericUrls = tokens.filter((token) => /^https?:\/\/\S+$/.test(token));
    if (genericUrls.length > 0) {
        return genericUrls[genericUrls.length - 1] ?? null;
    }
    return null;
}
function isNothingToCommitOutput(result) {
    const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
    return (text.includes("nothing to commit") ||
        text.includes("no changes added to commit") ||
        text.includes("working tree clean"));
}
async function confirmProdDeploy() {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    try {
        const answer = await rl.question("Deploy to production? (yes/no): ");
        return answer.trim().toLowerCase() === "yes";
    }
    finally {
        rl.close();
    }
}
async function runStep(step, cmd, args) {
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
    }
    catch (error) {
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
async function saveDeployArtifacts(projectRoot, deployUrl, logs) {
    const metaDir = path.resolve(projectRoot, ".bowerbird");
    await mkdir(metaDir, { recursive: true });
    const now = new Date().toISOString();
    const lastDeployText = [`timestamp=${now}`, `url=${deployUrl ?? "unknown"}`].join("\n");
    await writeFile(path.resolve(metaDir, "last_deploy.txt"), `${lastDeployText}\n`, "utf8");
    await writeFile(path.resolve(metaDir, "last_deploy_log.txt"), logs.join("\n"), "utf8");
}
async function saveErrorBrief(projectRoot, failed) {
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
async function exitWithErrorBrief(projectRoot, failed) {
    try {
        await saveErrorBrief(projectRoot, failed);
        console.log("Saved error brief to .bowerbird/last_error.md");
    }
    catch (error) {
        warn("Failed to save .bowerbird/last_error.md", error instanceof Error ? error.message : "Unknown file write error.");
    }
    return 1;
}
export async function fixDeploy(rawArgs) {
    const options = parseArgs(rawArgs);
    const logs = [];
    let projectRoot = process.cwd();
    try {
        const config = await getConfig();
        projectRoot = config.projectRoot;
        ok(`Deploy mode: ${options.prod ? "production" : "preview"}`);
    }
    catch (error) {
        fail("Config validation failed", error instanceof Error ? error.message : "Unknown error.");
        return 1;
    }
    const statusStep = await runStep("git status", "git", ["status", "--porcelain"]);
    if (!statusStep.ok) {
        return exitWithErrorBrief(projectRoot, statusStep.failed);
    }
    logs.push(commandLog("git", ["status", "--porcelain"], statusStep.result));
    if (statusStep.result.stdout.trim().length > 0) {
        const addStep = await runStep("git add", "git", ["add", "."]);
        if (!addStep.ok) {
            return exitWithErrorBrief(projectRoot, addStep.failed);
        }
        logs.push(commandLog("git", ["add", "."], addStep.result));
        try {
            const commitResult = await run("git", ["commit", "-m", options.message]);
            logs.push(commandLog("git", ["commit", "-m", options.message], commitResult));
            if (commitResult.exitCode === 0) {
                ok("git commit");
            }
            else if (isNothingToCommitOutput(commitResult)) {
                ok("git commit (nothing to commit)");
            }
            else {
                const failed = {
                    step: "git commit",
                    cmd: "git",
                    args: ["commit", "-m", options.message],
                    stdout: commitResult.stdout,
                    stderr: commitResult.stderr,
                };
                fail("git commit", truncateLastLines(commitResult.stderr || commitResult.stdout, 60));
                return exitWithErrorBrief(projectRoot, failed);
            }
        }
        catch (error) {
            const failed = {
                step: "git commit",
                cmd: "git",
                args: ["commit", "-m", options.message],
                stdout: "",
                stderr: error instanceof Error ? error.message : "Unknown execution error.",
            };
            fail("git commit", truncateLastLines(failed.stderr, 60));
            return exitWithErrorBrief(projectRoot, failed);
        }
    }
    else {
        ok("git commit skipped (clean tree)");
    }
    const pushStep = await runStep("git push", "git", ["push"]);
    if (!pushStep.ok) {
        return exitWithErrorBrief(projectRoot, pushStep.failed);
    }
    logs.push(commandLog("git", ["push"], pushStep.result));
    if (options.prod) {
        const confirmed = await confirmProdDeploy();
        if (!confirmed) {
            warn("Production deploy canceled by user");
            return 0;
        }
    }
    const vercelArgs = options.prod ? ["--prod", "--yes"] : ["deploy", "--yes"];
    const vercelStep = await runStep("vercel deploy", "vercel", vercelArgs);
    if (!vercelStep.ok) {
        return exitWithErrorBrief(projectRoot, vercelStep.failed);
    }
    logs.push(commandLog("vercel", vercelArgs, vercelStep.result));
    const deployOutput = `${vercelStep.result.stdout}\n${vercelStep.result.stderr}`;
    const deployUrl = extractDeploymentUrl(deployOutput);
    if (deployUrl) {
        ok(`Deployment URL: ${deployUrl}`);
    }
    else {
        warn("Could not extract deployment URL from Vercel output");
    }
    try {
        await saveDeployArtifacts(projectRoot, deployUrl, logs);
        ok("Saved deploy artifacts to .bowerbird/");
    }
    catch (error) {
        warn("Deploy completed but failed to persist logs", error instanceof Error ? error.message : "Unknown file write error.");
    }
    return 0;
}

import { access } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../core/config";
import { fail, ok, warn } from "../core/reporter";
import { run } from "../core/runner";
function mark(summary, level) {
    summary[level] += 1;
}
async function checkCommand(summary, label, cmd, args) {
    try {
        const result = await run(cmd, args);
        if (result.exitCode === 0) {
            ok(`${label}: ${result.stdout.trim() || "available"}`);
            mark(summary, "ok");
            return { ok: true, stdout: result.stdout };
        }
        fail(`${label}: command failed`, result.stderr.trim() || result.stdout.trim() || "No details available.");
        mark(summary, "blocker");
        return { ok: false };
    }
    catch (error) {
        fail(`${label}: unavailable or blocked`, error instanceof Error ? error.message : "Unknown execution error.");
        mark(summary, "blocker");
        return { ok: false };
    }
}
async function checkEnvFiles(summary, projectRoot) {
    const envFiles = [".env", ".env.local"];
    const found = [];
    for (const envFile of envFiles) {
        try {
            await access(path.resolve(projectRoot, envFile));
            found.push(envFile);
        }
        catch {
            // Missing env file is expected for some setups.
        }
    }
    if (found.length > 0) {
        ok(`Environment files found: ${found.join(", ")}`);
        mark(summary, "ok");
        return;
    }
    warn("No environment files found", "Expected .env or .env.local in projectRoot.");
    mark(summary, "warn");
}
export async function doctor() {
    const summary = { ok: 0, warn: 0, blocker: 0 };
    let config;
    try {
        config = await getConfig();
        ok(`Config loaded from operator.config.json (projectRoot: ${config.projectRoot})`);
        mark(summary, "ok");
    }
    catch (error) {
        fail("Config validation failed", error instanceof Error ? error.message : "Unknown config error.");
        mark(summary, "blocker");
        console.log("");
        console.log(`Summary: OK ${summary.ok} | WARN ${summary.warn} | BLOCKER ${summary.blocker}`);
        console.log("Next action: fix operator.config.json, then run `bowerbird doctor` again.");
        return 1;
    }
    await checkCommand(summary, "Git", "git", ["--version"]);
    await checkCommand(summary, "Node.js", "node", ["--version"]);
    const vercelVersion = await checkCommand(summary, "Vercel CLI", "vercel", ["--version"]);
    if (vercelVersion.ok) {
        try {
            const whoami = await run("vercel", ["whoami"]);
            if (whoami.exitCode === 0) {
                ok(`Vercel auth: logged in as ${whoami.stdout.trim() || "unknown user"}`);
                mark(summary, "ok");
            }
            else {
                warn("Vercel auth: not logged in", whoami.stderr.trim() || "Run `vercel login` to authenticate.");
                mark(summary, "warn");
            }
        }
        catch (error) {
            warn("Vercel auth check skipped", error instanceof Error ? error.message : "Unknown auth check error.");
            mark(summary, "warn");
        }
    }
    const supabaseVersion = await checkCommand(summary, "Supabase CLI", "supabase", ["--version"]);
    if (supabaseVersion.ok) {
        try {
            const loginHelp = await run("supabase", ["login", "--help"]);
            if (loginHelp.exitCode === 0) {
                warn("Supabase auth status is not directly verified", "Run `supabase login` if commands later require authentication. If you've run it recently, OK to ignore for now.");
                mark(summary, "warn");
            }
            else {
                warn("Supabase auth may be required", loginHelp.stderr.trim() ||
                    "Run `supabase login` if needed. If you've run it recently, OK to ignore for now.");
                mark(summary, "warn");
            }
        }
        catch (error) {
            warn("Supabase auth check skipped", error instanceof Error ? error.message : "Unknown auth check error.");
            mark(summary, "warn");
        }
    }
    await checkEnvFiles(summary, config.projectRoot);
    console.log("");
    console.log(`Summary: OK ${summary.ok} | WARN ${summary.warn} | BLOCKER ${summary.blocker}`);
    if (summary.blocker > 0) {
        console.log("Next action: resolve BLOCKER items first, then re-run `bowerbird doctor`.");
        return 1;
    }
    if (summary.warn > 0) {
        console.log("Next action: review WARN items to avoid deployment/setup issues.");
        return 0;
    }
    console.log("Next action: environment looks good. Continue with project setup.");
    return 0;
}
//# sourceMappingURL=doctor.js.map
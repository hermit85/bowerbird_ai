import path from "node:path";
import { execa } from "execa";
import { getConfig } from "./config";
import { ensureSafe } from "./safety";
function resolveRunCwd(projectRoot, cwd) {
    const resolved = cwd ? path.resolve(projectRoot, cwd) : projectRoot;
    const relative = path.relative(projectRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`Invalid cwd "${cwd}". Command execution must stay inside projectRoot (${projectRoot}).`);
    }
    return resolved;
}
export async function run(cmd, args = [], options = {}) {
    const config = await getConfig();
    const runCwd = resolveRunCwd(config.projectRoot, options.cwd);
    ensureSafe(cmd, args, config.allowCommands, config.blockedPatterns);
    const start = Date.now();
    const result = await execa(cmd, args, {
        cwd: runCwd,
        reject: false,
    });
    const durationMs = Date.now() - start;
    return {
        exitCode: result.exitCode ?? 1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        durationMs,
    };
}
//# sourceMappingURL=runner.js.map
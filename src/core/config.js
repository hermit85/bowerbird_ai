import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
const configSchema = z.object({
    projectRoot: z.string().min(1, "projectRoot is required"),
    allowCommands: z.array(z.string().min(1)).default([]),
    blockedPatterns: z.array(z.string().min(1)).default([]),
});
export async function getConfig() {
    const configPath = path.resolve(process.cwd(), "operator.config.json");
    let raw;
    try {
        raw = await readFile(configPath, "utf-8");
    }
    catch (error) {
        throw new Error(`Could not read config at ${configPath}. Create operator.config.json in your current directory.`);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new Error(`Invalid JSON in config file: ${configPath}`);
    }
    const result = configSchema.safeParse(parsed);
    if (!result.success) {
        const details = result.error.issues
            .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
            .join("; ");
        throw new Error(`Invalid operator config: ${details}`);
    }
    return {
        ...result.data,
        projectRoot: path.resolve(process.cwd(), result.data.projectRoot),
    };
}
//# sourceMappingURL=config.js.map
import { writeFile, access } from "node:fs/promises";
import path from "node:path";
import { ok, warn } from "../core/reporter";

export async function init(): Promise<number> {
  const cwd = process.cwd();

  const configPath = path.resolve(cwd, "operator.config.json");

  try {
    await access(configPath);
    warn("operator.config.json already exists");
  } catch {
    const config = {
      projectRoot: ".",
      allowCommands: ["git", "node", "npm", "npx", "vercel", "supabase"],
      blockedPatterns: ["rm -rf", "sudo", "curl |", "bash -c", "sh -c"],
    };

    await writeFile(configPath, JSON.stringify(config, null, 2));
    ok("Created operator.config.json");
  }

  const envPath = path.resolve(cwd, ".env");
  const envExamplePath = path.resolve(cwd, ".env.example");

  try {
    await access(envPath);
  } catch {
    await writeFile(envPath, "");
    ok("Created .env");
  }

  try {
    await access(envExamplePath);
  } catch {
    await writeFile(envExamplePath, "API_KEY=\nDATABASE_URL=\n");
    ok("Created .env.example");
  }

  try {
    await access(path.resolve(cwd, "package.json"));
    ok("Detected package.json");
  } catch {
    warn("package.json not found");
  }

  try {
    await access(path.resolve(cwd, ".vercel"));
    ok("Detected Vercel project");
  } catch {
    // Optional detection.
  }

  try {
    await access(path.resolve(cwd, "supabase"));
    ok("Detected Supabase project");
  } catch {
    // Optional detection.
  }

  ok("Init complete");
  return 0;
}

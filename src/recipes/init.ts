import { writeFile, access, readFile } from "node:fs/promises";
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

  const gitignorePath = path.resolve(cwd, ".gitignore");
  const recommendedRules = [
    "node_modules/",
    "dist/",
    ".env",
    ".bowerbird/",
    ".vercel",
    ".DS_Store",
  ];

  try {
    await access(gitignorePath);
    const currentContent = await readFile(gitignorePath, "utf8");
    const existingLines = new Set(currentContent.split(/\r?\n/));
    const missingRules = recommendedRules.filter((rule) => !existingLines.has(rule));

    if (missingRules.length > 0) {
      const separator = currentContent.endsWith("\n") || currentContent.length === 0 ? "" : "\n";
      const appended = `${separator}${missingRules.join("\n")}\n`;
      await writeFile(gitignorePath, `${currentContent}${appended}`);
      ok("Updated .gitignore with missing rules");
    } else {
      ok(".gitignore already contains recommended rules");
    }
  } catch {
    const content = `# BowerBird managed\n${recommendedRules.join("\n")}\n`;
    await writeFile(gitignorePath, content);
    ok("Created .gitignore with recommended rules");
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

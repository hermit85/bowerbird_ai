import { readFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../core/config";
import { ok, warn } from "../core/reporter";
import { repairLoop } from "./repairLoop";

function extractUrl(lastDeployText: string): string | null {
  const line = lastDeployText
    .split(/\r?\n/)
    .find((item) => item.startsWith("url="));
  const url = line?.slice(4).trim();
  return url || null;
}

export async function go(): Promise<number> {
  const code = await repairLoop(["--max", "3", "--copy"]);

  let projectRoot = process.cwd();
  try {
    const config = await getConfig();
    projectRoot = config.projectRoot;
  } catch {
    // repair-loop already reports config issues.
  }

  if (code === 0) {
    try {
      const deployText = await readFile(
        path.resolve(projectRoot, ".bowerbird", "last_deploy.txt"),
        "utf8",
      );
      const url = extractUrl(deployText);
      if (url) {
        ok(`Live: ${url}`);
        return 0;
      }
    } catch {
      // Fallback summary below.
    }

    ok("Live: deployment succeeded");
    return 0;
  }

  warn(".bowerbird/repair_prompt.md");
  warn(".bowerbird/repair_patch.diff");
  warn(".bowerbird/last_apply_patch_log.txt");
  warn(".bowerbird/repair_history.json");
  return 1;
}

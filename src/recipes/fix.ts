import { ok } from "../core/reporter";
import { autoprompt } from "./autoprompt";
import { fixDeploy } from "./fixDeploy";

export async function fix(rawArgs: string[]): Promise<number> {
  const code = await fixDeploy(rawArgs);
  if (code === 0) {
    ok("Fix complete");
    return 0;
  }

  const p = await autoprompt();
  if (p === 0) {
    ok("Prompt copied. Paste into Codex/Claude and apply patch.");
  }
  return 1;
}

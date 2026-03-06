import { getConfig } from "../core/config";
import { fail } from "../core/reporter";
import { readState } from "../core/state";

function formatConnection(value: boolean): string {
  return value ? "connected" : "not connected";
}

export async function stateSummary(): Promise<number> {
  let projectRoot: string;
  try {
    const config = await getConfig();
    projectRoot = config.projectRoot;
  } catch (error) {
    fail("Config validation failed", error instanceof Error ? error.message : "Unknown error.");
    return 1;
  }

  try {
    const state = await readState(projectRoot);
    console.log(`Project: ${state.project.name}`);
    console.log(`Branch: ${state.git.branch ?? "unknown"}`);
    console.log(`Last deploy: ${state.vercel.lastDeployUrl ?? "none"}`);
    console.log(`Vercel: ${formatConnection(state.vercel.connected)}`);
    const supabase = state.supabase.projectRef
      ? `${formatConnection(state.supabase.connected)} (${state.supabase.projectRef})`
      : formatConnection(state.supabase.connected);
    console.log(`Supabase: ${supabase}`);
    console.log(
      `Known env keys: ${state.env.knownKeys.length > 0 ? state.env.knownKeys.join(", ") : "none"}`,
    );
    return 0;
  } catch (error) {
    fail("Failed to read .bowerbird/state.json", error instanceof Error ? error.message : "Unknown error.");
    return 1;
  }
}

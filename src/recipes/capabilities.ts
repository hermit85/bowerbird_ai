import { detectCapabilities, ensureCapabilities, writeCapabilities } from "../core/capabilities";
import { getConfig } from "../core/config";
import { fail } from "../core/reporter";

export async function capabilitiesSummary(): Promise<number> {
  let projectRoot: string;
  try {
    const config = await getConfig();
    projectRoot = config.projectRoot;
  } catch (error) {
    fail("Config validation failed", error instanceof Error ? error.message : "Unknown error.");
    return 1;
  }

  try {
    await ensureCapabilities(projectRoot);
    const detected = await detectCapabilities(projectRoot);
    await writeCapabilities(projectRoot, detected);

    console.log("Capabilities:");
    console.log(`- deploy_preview: ${detected.deploy_preview ? "yes" : "no"}`);
    console.log(`- deploy_production: ${detected.deploy_production ? "yes" : "no"}`);
    console.log(`- env_management: ${detected.env_management ? "yes" : "no"}`);
    console.log(`- logs: ${detected.logs ? "yes" : "no"}`);
    console.log(`- repair_loop: ${detected.repair_loop ? "yes" : "no"}`);
    console.log(`- supabase_functions: ${detected.supabase_functions ? "yes" : "no"}`);
    console.log(`- database_migrations: ${detected.database_migrations ? "yes" : "no"}`);
    return 0;
  } catch (error) {
    fail("Failed to read/write capabilities", error instanceof Error ? error.message : "Unknown error.");
    return 1;
  }
}

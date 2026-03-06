import { getProviderMappings } from "../providers";

export async function providersSummary(): Promise<number> {
  const mappings = getProviderMappings();
  console.log("Providers:");
  console.log(`- deploy_preview -> ${mappings.deploy_preview}`);
  console.log(`- deploy_production -> ${mappings.deploy_production}`);
  console.log(`- logs -> ${mappings.logs}`);
  console.log(`- env_management -> ${mappings.env_management}`);
  console.log(`- supabase_functions -> ${mappings.supabase_functions}`);
  return 0;
}

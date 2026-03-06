import { supabaseAdapter } from "./supabaseAdapter";
import { vercelAdapter } from "./vercelAdapter";
import { CapabilityName, ProviderAdapter } from "./types";

const mapping: Record<CapabilityName, ProviderAdapter | null> = {
  deploy_preview: vercelAdapter,
  deploy_production: vercelAdapter,
  env_management: vercelAdapter,
  logs: vercelAdapter,
  repair_loop: null,
  supabase_functions: supabaseAdapter,
  database_migrations: null,
};

export function getAdapterForCapability(capability: CapabilityName): ProviderAdapter | null {
  return mapping[capability] ?? null;
}

export function getProviderMappings(): Record<CapabilityName, string> {
  return {
    deploy_preview: mapping.deploy_preview?.name ?? "none",
    deploy_production: mapping.deploy_production?.name ?? "none",
    env_management: mapping.env_management?.name ?? "none",
    logs: mapping.logs?.name ?? "none",
    repair_loop: mapping.repair_loop?.name ?? "none",
    supabase_functions: mapping.supabase_functions?.name ?? "none",
    database_migrations: mapping.database_migrations?.name ?? "none",
  };
}

export { vercelAdapter, supabaseAdapter };
export type { CapabilityName, ProviderAdapter };

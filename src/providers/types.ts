export type CapabilityName =
  | "deploy_preview"
  | "deploy_production"
  | "env_management"
  | "logs"
  | "repair_loop"
  | "supabase_functions"
  | "database_migrations";

export type ProviderAdapter = {
  name: string;
  supports(capability: CapabilityName): boolean;
  execute(capability: CapabilityName, payload?: any): Promise<{ ok: boolean; output: string }>;
};

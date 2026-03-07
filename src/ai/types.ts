import type { StackInfo } from "../detection/stackDetector";

export type ExecutionAction =
  | { type: "connect_database" }
  | { type: "deploy_backend_functions" }
  | { type: "prepare_preview" }
  | { type: "make_app_live" }
  | { type: "env_add"; key: string; value?: string }
  | { type: "deploy_supabase_function"; name: string }
  | { type: "run_repair" }
  | { type: "show_logs" };

export type IntentName =
  | "launch_application"
  | "connect_database"
  | "deploy_backend"
  | "prepare_preview"
  | "make_app_live"
  | "run_repair"
  | "show_logs"
  | "env_add"
  | "deploy_supabase_function";

export type ParsedIntent =
  | { rawCommand: string; intent: "launch_application"; target?: "preview" | "production" }
  | { rawCommand: string; intent: "connect_database" }
  | { rawCommand: string; intent: "deploy_backend" }
  | { rawCommand: string; intent: "prepare_preview" }
  | { rawCommand: string; intent: "make_app_live"; target?: "production" }
  | { rawCommand: string; intent: "run_repair" }
  | { rawCommand: string; intent: "show_logs" }
  | { rawCommand: string; intent: "env_add"; key: string }
  | { rawCommand: string; intent: "deploy_supabase_function"; name: string };

export type ParsedCommand = {
  rawCommand: string;
  intents: ParsedIntent[];
};

export type LaunchSnapshot = {
  databaseConnected: boolean;
  backendDeployed: boolean;
  previewReady: boolean;
  appLive: boolean;
};

export type AIContext = {
  stack: StackInfo;
  launch: LaunchSnapshot;
};

export type ResolvedCapabilities = {
  canConnectDatabase: boolean;
  canDeployBackend: boolean;
  canDeployPreview: boolean;
  canDeployProduction: boolean;
  backendRequired: boolean;
  backendProvider: "supabase-functions" | null;
};

export type PlanBuildResult = {
  steps: ExecutionAction[];
  reasoning: string[];
};

export type DetectionSummary = {
  rawInput: string;
  actions: ExecutionAction[];
  reasoning: string[];
  intents: ParsedIntent[];
  capabilities: ResolvedCapabilities;
};


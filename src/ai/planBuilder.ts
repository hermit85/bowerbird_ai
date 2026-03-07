import type { ParsedIntent, PlanBuildResult, ResolvedCapabilities, ExecutionAction, LaunchSnapshot } from "./types";

function pushStep(steps: ExecutionAction[], step: ExecutionAction): void {
  const key = JSON.stringify(step);
  if (steps.some((existing) => JSON.stringify(existing) === key)) {
    return;
  }
  steps.push(step);
}

export function buildExecutionPlan(
  intents: ParsedIntent[],
  capabilities: ResolvedCapabilities,
  launch: LaunchSnapshot,
): PlanBuildResult {
  const steps: ExecutionAction[] = [];
  const reasoning: string[] = [];

  for (const intent of intents) {
    if (intent.intent === "launch_application") {
      if (!launch.databaseConnected && capabilities.canConnectDatabase) {
        pushStep(steps, { type: "connect_database" });
        reasoning.push("Supabase is not fully connected");
      }
      if (!launch.backendDeployed && capabilities.backendRequired && capabilities.canDeployBackend) {
        pushStep(steps, { type: "deploy_backend_functions" });
        reasoning.push("Backend functions were detected");
      }
      if (!launch.previewReady && capabilities.canDeployPreview) {
        pushStep(steps, { type: "prepare_preview" });
        reasoning.push("Preview deployment is required");
      }
      if (!launch.appLive && capabilities.canDeployProduction) {
        pushStep(steps, { type: "make_app_live" });
        reasoning.push("Production deployment is required");
      }
      continue;
    }

    if (intent.intent === "connect_database") {
      pushStep(steps, { type: "connect_database" });
      reasoning.push("User requested database setup");
      continue;
    }

    if (intent.intent === "deploy_backend") {
      if (capabilities.backendRequired && capabilities.canDeployBackend) {
        pushStep(steps, { type: "deploy_backend_functions" });
        reasoning.push("Backend functions are available for deployment");
      }
      continue;
    }

    if (intent.intent === "prepare_preview") {
      pushStep(steps, { type: "prepare_preview" });
      reasoning.push("User requested preview deployment");
      continue;
    }

    if (intent.intent === "make_app_live") {
      pushStep(steps, { type: "make_app_live" });
      reasoning.push("User requested production deployment");
      continue;
    }

    if (intent.intent === "run_repair") {
      pushStep(steps, { type: "run_repair" });
      reasoning.push("User requested deployment repair");
      continue;
    }

    if (intent.intent === "show_logs") {
      pushStep(steps, { type: "show_logs" });
      reasoning.push("User requested logs");
      continue;
    }

    if (intent.intent === "env_add") {
      pushStep(steps, { type: "env_add", key: intent.key });
      reasoning.push(`Environment key ${intent.key} requested`);
      continue;
    }

    if (intent.intent === "deploy_supabase_function") {
      pushStep(steps, { type: "deploy_supabase_function", name: intent.name });
      reasoning.push(`Supabase function ${intent.name} requested`);
    }
  }

  return { steps, reasoning };
}


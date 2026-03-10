import { enqueue } from "../engine/engine";
import { createEmptyInspectionFindings } from "../detection/stackDetector";
import { buildExecutionPlan } from "./planBuilder";
import { parseAIInstructions } from "./parser";
import { resolveCapabilities } from "./capabilityResolver";
import type {
  AIContext,
  DetectionSummary,
  ExecutionAction,
  ParsedCommand,
  ResolvedCapabilities,
} from "./types";

export type AIImportSummary = {
  actionsDetected: number;
  jobsQueued: number;
  actions: ExecutionAction[];
  jobIds: string[];
  reasoning?: string[];
  intents?: ParsedCommand["intents"];
  capabilities?: ResolvedCapabilities;
};

function defaultContext(): AIContext {
  return {
    stack: {
      framework: null,
      deploy: null,
      database: null,
      backend: null,
      inspectionFindings: createEmptyInspectionFindings(),
    },
    launch: {
      databaseConnected: false,
      backendDeployed: false,
      previewReady: false,
      appLive: false,
    },
  };
}

export function detectAIInstructions(text: string, context?: AIContext): DetectionSummary {
  const parsed = parseAIInstructions(text);
  const resolvedContext = context ?? defaultContext();
  const capabilities = resolveCapabilities(resolvedContext);
  const built = buildExecutionPlan(parsed.intents, capabilities, resolvedContext.launch);
  return {
    rawInput: text,
    actions: built.steps,
    reasoning: built.reasoning,
    intents: parsed.intents,
    capabilities,
  };
}

export function executeAIInstructions(text: string, context?: AIContext): AIImportSummary {
  const summary = detectAIInstructions(text, context);
  const actions = summary.actions;
  const jobIds: string[] = [];

  for (const action of actions) {
    if (action.type === "prepare_preview") {
      jobIds.push(enqueue("deploy_preview").id);
      continue;
    }
    if (action.type === "make_app_live") {
      jobIds.push(enqueue("deploy_production").id);
      continue;
    }
    if (action.type === "deploy_backend_functions") {
      jobIds.push(enqueue("deploy_supabase_function", { name: "generate" }).id);
      continue;
    }
    if (action.type === "connect_database") {
      // Requires explicit user-provided DATABASE_URL; do not queue invalid empty-value env jobs.
      continue;
    }
    if (action.type === "deploy_supabase_function") {
      jobIds.push(enqueue("deploy_supabase_function", { name: action.name }).id);
      continue;
    }
    if (action.type === "run_repair") {
      jobIds.push(enqueue("repair_deployment").id);
      continue;
    }
    if (action.type === "show_logs") {
      jobIds.push(enqueue("view_logs").id);
      continue;
    }
    if (action.type === "env_add") {
      const value = typeof action.value === "string" ? action.value : "";
      if (!value) {
        // Do not enqueue env mutations without explicit value.
        continue;
      }
      jobIds.push(
        enqueue("add_env", {
          key: action.key,
          value,
          target: "preview",
        }).id,
      );
      continue;
    }

    const _never: never = action;
    void _never;
  }

  return {
    actionsDetected: actions.length,
    jobsQueued: jobIds.length,
    actions,
    jobIds,
    reasoning: summary.reasoning,
    intents: summary.intents,
    capabilities: summary.capabilities,
  };
}

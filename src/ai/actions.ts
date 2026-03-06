import { enqueue } from "../engine/engine";
import { parseAIInstructions, type ExecutionAction, type ExecutionPlan } from "./parser";

export type AIImportSummary = {
  actionsDetected: number;
  jobsQueued: number;
  actions: ExecutionAction[];
  jobIds: string[];
};

export function detectAIInstructions(text: string): ExecutionPlan {
  return parseAIInstructions(text);
}

export function executeAIInstructions(text: string): AIImportSummary {
  const plan = detectAIInstructions(text);
  const actions = plan.actions;
  const jobIds: string[] = [];

  for (const action of actions) {
    if (action.type === "deploy_preview") {
      jobIds.push(enqueue("deploy_preview").id);
      continue;
    }
    if (action.type === "deploy_production") {
      jobIds.push(enqueue("deploy_production").id);
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
      jobIds.push(
        enqueue("add_env", {
          key: action.key,
          value: action.value ?? "",
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
  };
}

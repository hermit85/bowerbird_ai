import type { Capabilities } from "./capabilities";
import { isActionAllowed } from "./capabilities";

export type Suggestion = {
  id: string;
  label: string;
  action: string;
};

export function generateSuggestions(state: any, capabilities?: Capabilities): Suggestion[] {
  const suggestions: Suggestion[] = [];

  if (!state?.vercel?.lastDeployUrl) {
    suggestions.push({
      id: "deploy_preview",
      label: "Deploy preview",
      action: "deploy preview",
    });
  }

  if (state?.supabase?.connected && (!state?.supabase?.functions || state.supabase.functions.length === 0)) {
    suggestions.push({
      id: "deploy_supabase_function",
      label: "Deploy backend",
      action: "deploy backend",
    });
  }

  if (!state?.env?.knownKeys || state.env.knownKeys.length < 2) {
    suggestions.push({
      id: "add_env",
      label: "Connect database",
      action: "connect database",
    });
  }

  if (state?.activity?.lastAction === "repair") {
    suggestions.push({
      id: "redeploy_preview",
      label: "Redeploy preview",
      action: "deploy preview",
    });
  }

  if (!capabilities) {
    return suggestions;
  }

  return suggestions.filter((suggestion) => isActionAllowed(suggestion.action, capabilities));
}

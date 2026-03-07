import type { AIContext, ResolvedCapabilities } from "./types";

export function resolveCapabilities(context: AIContext): ResolvedCapabilities {
  const stack = context?.stack;

  const backendProvider = stack?.backend === "supabase-functions" ? "supabase-functions" : null;
  const backendRequired = backendProvider !== null;

  return {
    canConnectDatabase: stack?.database === "supabase" || stack?.database === null,
    canDeployBackend: backendProvider !== null,
    canDeployPreview: stack?.deploy === "vercel" || stack?.deploy === null,
    canDeployProduction: stack?.deploy === "vercel" || stack?.deploy === null,
    backendRequired,
    backendProvider,
  };
}


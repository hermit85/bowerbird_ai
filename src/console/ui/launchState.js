export function getLaunchState(status) {
  const knownKeys = Array.isArray(status?.env?.knownKeys) ? status.env.knownKeys : [];
  const supabaseFunctions = Array.isArray(status?.supabase?.functions) ? status.supabase.functions : [];
  const functionsRequired = status?.supabase?.functionsRequired;
  const lastDeployUrl = String(status?.vercel?.lastDeployUrl || "").trim();
  const lastAction = String(status?.activity?.lastAction || "").toLowerCase();

  return {
    databaseConnected: knownKeys.includes("DATABASE_URL"),
    backendDeployed: functionsRequired === false ? true : supabaseFunctions.length > 0,
    previewReady: Boolean(lastDeployUrl),
    appLive: /production|make_app_live|deploy_production/.test(lastAction),
    deployToProduction: false,
  };
}

export function getLaunchChecklist(launchState) {
  return [
    {
      id: "founderConnectDbBtn",
      label: "Connect database",
      done: Boolean(launchState?.databaseConnected),
      instruction: "add env DATABASE_URL",
    },
    {
      id: "founderDeployFunctionsBtn",
      label: "Deploy backend functions",
      done: Boolean(launchState?.backendDeployed),
      instruction: "deploy supabase function generate",
    },
    {
      id: "founderPreviewBtn",
      label: "Prepare preview",
      done: Boolean(launchState?.previewReady),
      instruction: "deploy preview",
    },
    {
      id: "founderLiveBtn",
      label: "Make app live",
      done: Boolean(launchState?.appLive),
      instruction: "deploy production",
      requiresConfirm: true,
    },
  ];
}

export function getNextRecommendedAction(launchState) {
  if (!launchState?.databaseConnected) {
    return "connect_database";
  }
  if (!launchState?.backendDeployed) {
    return "deploy_backend_functions";
  }
  if (!launchState?.previewReady) {
    return "prepare_preview";
  }
  if (!launchState?.appLive) {
    return "make_app_live";
  }
  return "app_live";
}

export function mergeLaunchState(base, overrides) {
  return {
    databaseConnected: Boolean(overrides?.databaseConnected ?? base?.databaseConnected),
    backendDeployed: Boolean(overrides?.backendDeployed ?? base?.backendDeployed),
    previewReady: Boolean(overrides?.previewReady ?? base?.previewReady),
    appLive: Boolean(overrides?.appLive ?? base?.appLive),
    deployToProduction: Boolean(overrides?.deployToProduction ?? base?.deployToProduction),
  };
}

export function isProjectLive(launchState) {
  return Boolean(
    launchState?.databaseConnected &&
    launchState?.backendDeployed &&
    launchState?.previewReady &&
    launchState?.appLive,
  );
}

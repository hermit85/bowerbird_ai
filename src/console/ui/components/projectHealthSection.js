function pill(label, value, ok) {
  const color = ok ? "bg-emerald-100 text-emerald-800 border-emerald-300" : "bg-slate-100 text-slate-700 border-slate-300";
  return `<div class="rounded-md border px-3 py-2 ${color}">
    <div class="text-xs uppercase tracking-wide">${label}</div>
    <div class="text-sm font-medium mt-0.5">${value}</div>
  </div>`;
}

function envConfiguredCount(status) {
  const count = Array.isArray(status?.env?.knownKeys) ? status.env.knownKeys.length : 0;
  return count >= 2;
}

export function ProjectHealthSection({ status }) {
  const knownKeys = Array.isArray(status?.env?.knownKeys) ? status.env.knownKeys : [];
  const databaseConnected = knownKeys.includes("DATABASE_URL");
  const backendDeployed = Array.isArray(status?.supabase?.functions) && status.supabase.functions.length > 0;
  const previewReady = Boolean(status?.vercel?.lastDeployUrl);
  const appLiveFlag = /production|make_app_live|deploy_production/.test(String(status?.activity?.lastAction || "").toLowerCase());
  const appLive = Boolean(databaseConnected && backendDeployed && previewReady && appLiveFlag);
  const supabaseConnected = Boolean(status?.supabase?.connected);
  const envConfigured = envConfiguredCount(status);

  return `
    <section class="rounded-xl bg-white p-4 shadow-sm">
      <h2 class="text-lg font-semibold mb-3">Project Health</h2>
      <div class="grid gap-2 md:grid-cols-3">
        ${pill("App", appLive ? "Live" : "Not live", appLive)}
        ${pill("Database", supabaseConnected ? "Connected" : "Not connected", supabaseConnected)}
        ${pill("Environment", envConfigured ? "Ready" : "Needs setup", envConfigured)}
      </div>
    </section>
  `;
}

function buttonClass(base, disabled) {
  return `${base} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`;
}

export function QuickActionsSection({ loading, capabilities }) {
  const caps = capabilities || {};
  const deployPreviewBusy = Boolean(loading.quickDeployPreviewBtn);
  const deployProdBusy = Boolean(loading.quickDeployProdBtn);
  const addEnvBusy = Boolean(loading.quickAddEnvBtn);
  const supabaseBusy = Boolean(loading.quickSupabaseDeployBtn);
  const logsBusy = Boolean(loading.quickViewLogsBtn);
  const repairBusy = Boolean(loading.quickRepairBtn);

  const buttons = [];
  if (caps.deploy_preview !== false) {
    buttons.push(`<button id="quickDeployPreviewBtn" ${deployPreviewBusy ? "disabled" : ""} class="${buttonClass("rounded-md bg-slate-700 text-white px-3 py-2 text-sm", deployPreviewBusy)}">${deployPreviewBusy ? "Running..." : "Deploy preview"}</button>`);
  }
  if (caps.deploy_production !== false) {
    buttons.push(`<button id="quickDeployProdBtn" ${deployProdBusy ? "disabled" : ""} class="${buttonClass("rounded-md bg-rose-700 text-white px-3 py-2 text-sm", deployProdBusy)}">${deployProdBusy ? "Running..." : "Deploy production"}</button>`);
  }
  if (caps.env_management !== false) {
    buttons.push(`<button id="quickAddEnvBtn" ${addEnvBusy ? "disabled" : ""} class="${buttonClass("rounded-md bg-emerald-700 text-white px-3 py-2 text-sm", addEnvBusy)}">${addEnvBusy ? "Running..." : "Add environment variable"}</button>`);
  }
  if (caps.supabase_functions !== false) {
    buttons.push(`<button id="quickSupabaseDeployBtn" ${supabaseBusy ? "disabled" : ""} class="${buttonClass("rounded-md bg-indigo-700 text-white px-3 py-2 text-sm", supabaseBusy)}">${supabaseBusy ? "Running..." : "Deploy Supabase function"}</button>`);
  }
  if (caps.logs !== false) {
    buttons.push(`<button id="quickViewLogsBtn" ${logsBusy ? "disabled" : ""} class="${buttonClass("rounded-md bg-slate-500 text-white px-3 py-2 text-sm", logsBusy)}">${logsBusy ? "Loading..." : "View logs"}</button>`);
  }
  if (caps.repair_loop !== false) {
    buttons.push(`<button id="quickRepairBtn" ${repairBusy ? "disabled" : ""} class="${buttonClass("rounded-md bg-amber-700 text-white px-3 py-2 text-sm", repairBusy)}">${repairBusy ? "Running..." : "Repair deployment"}</button>`);
  }

  return `
    <section class="rounded-xl bg-white p-4 shadow-sm">
      <h2 class="text-lg font-semibold mb-3">Quick Actions</h2>
      <div class="flex gap-2 flex-wrap">${buttons.join("") || "<span class='text-sm text-slate-500'>No quick actions available for current capabilities.</span>"}</div>
    </section>
  `;
}

function buttonClass(base, disabled) {
  return `${base} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`;
}

export function DeploymentSection({ loading, capabilities }) {
  const caps = capabilities || {};
  const previewBusy = Boolean(loading.previewDeployBtn);
  const prodBusy = Boolean(loading.prodDeployBtn);
  const logsBusy = Boolean(loading.viewLogsBtn);

  const buttons = [];
  if (caps.deploy_preview !== false) {
    buttons.push(`<button id="previewDeployBtn" ${previewBusy ? "disabled" : ""} class="${buttonClass("rounded-md bg-slate-700 text-white px-3 py-2 text-sm", previewBusy)}">${previewBusy ? "Deploying..." : "Preview deploy"}</button>`);
  }
  if (caps.deploy_production !== false) {
    buttons.push(`<button id="prodDeployBtn" ${prodBusy ? "disabled" : ""} class="${buttonClass("rounded-md bg-rose-700 text-white px-3 py-2 text-sm", prodBusy)}">${prodBusy ? "Deploying..." : "Production deploy"}</button>`);
  }
  if (caps.logs !== false) {
    buttons.push(`<button id="viewLogsBtn" ${logsBusy ? "disabled" : ""} class="${buttonClass("rounded-md bg-slate-500 text-white px-3 py-2 text-sm", logsBusy)}">${logsBusy ? "Loading..." : "View logs"}</button>`);
  }

  return `
    <section class="rounded-xl bg-white p-4 shadow-sm">
      <h2 class="text-lg font-semibold mb-3">Deployment</h2>
      <div class="flex gap-2 flex-wrap">${buttons.join("") || "<span class='text-sm text-slate-500'>Deployment actions unavailable.</span>"}</div>
    </section>
  `;
}

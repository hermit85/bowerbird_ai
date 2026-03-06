export function DeploymentSection() {
  return `
    <section class="rounded-xl bg-white p-4 shadow-sm">
      <h2 class="text-lg font-semibold mb-3">Deployment</h2>
      <div class="flex gap-2 flex-wrap">
        <button id="previewDeployBtn" class="rounded-md bg-slate-700 text-white px-3 py-2 text-sm">Preview deploy</button>
        <button id="prodDeployBtn" class="rounded-md bg-rose-700 text-white px-3 py-2 text-sm">Production deploy</button>
        <button id="viewLogsBtn" class="rounded-md bg-slate-500 text-white px-3 py-2 text-sm">View logs</button>
      </div>
    </section>
  `;
}

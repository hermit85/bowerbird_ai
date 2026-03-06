export function EnvironmentSection({ status }) {
  const envList = status.envVars?.length
    ? status.envVars.map((name) => `<li class="py-0.5">${name}</li>`).join("")
    : "<li class='text-slate-500'>No env names detected</li>";

  return `
    <section class="rounded-xl bg-white p-4 shadow-sm">
      <h2 class="text-lg font-semibold mb-3">Environment</h2>
      <ul class="text-sm list-disc pl-5 max-h-28 overflow-auto">${envList}</ul>
      <div class="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
        <input id="envKeyInput" class="rounded-md border border-slate-300 p-2 text-sm" placeholder="KEY" />
        <input id="envValueInput" class="rounded-md border border-slate-300 p-2 text-sm" placeholder="value" type="password" />
        <button id="addEnvBtn" class="rounded-md bg-emerald-700 text-white px-3 py-2 text-sm">Add env</button>
      </div>
    </section>
  `;
}

function buttonClass(base, disabled) {
  return `${base} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function CommandCenterSection({ loading, commandText, commandFocused, heroState, errorSummary, status }) {
  const busy = Boolean(loading.commandCenterRunBtn);
  const suggestions = [
    "launch SaaS",
    "deploy preview",
    "connect database",
    "deploy supabase function",
    "repair deployment",
  ];
  const launchOptions = [
    "launch SaaS",
    "launch AI agent",
    "deploy existing project",
  ];

  const appLive = Boolean(status?.vercel?.lastDeployUrl);
  const dbConnected = Boolean(status?.supabase?.connected);
  const envReady = (status?.env?.knownKeys || []).length >= 2;

  if (heroState === "running") {
    return `
      <section class="rounded-xl bg-white p-5 shadow-sm border border-blue-200">
        <h2 class="text-xl font-semibold">Deployment Running</h2>
        <p class="text-sm text-slate-600 mt-1">BowerBird is currently working through your deployment steps.</p>
        <ul class="mt-4 space-y-2 text-sm">
          <li>${envReady ? "✓" : "○"} env configured</li>
          <li>${dbConnected ? "✓" : "○"} database connected</li>
          <li>⏳ building project</li>
        </ul>
      </section>
    `;
  }

  if (heroState === "failed") {
    const fixBusy = Boolean(loading.heroFixBtn);
    const logsBusy = Boolean(loading.heroLogsBtn);
    return `
      <section class="rounded-xl bg-white p-5 shadow-sm border border-rose-200">
        <h2 class="text-xl font-semibold text-rose-800">Deployment failed</h2>
        <p class="text-sm text-slate-700 mt-2">${escapeHtml(errorSummary || "No error summary available.")}</p>
        <div class="mt-4 flex gap-2 flex-wrap">
          <button id="heroFixBtn" ${fixBusy ? "disabled" : ""} class="${buttonClass("rounded-md bg-rose-700 text-white px-4 py-2 text-sm font-medium", fixBusy)}">${fixBusy ? "Fixing..." : "Fix with AI"}</button>
          <button id="heroLogsBtn" ${logsBusy ? "disabled" : ""} class="${buttonClass("rounded-md bg-slate-700 text-white px-4 py-2 text-sm font-medium", logsBusy)}">${logsBusy ? "Loading..." : "View logs"}</button>
        </div>
      </section>
    `;
  }

  const isLive = heroState === "live";
  const header = isLive ? "Your project is live" : "Command Center";
  const subtitle = isLive
    ? "Use commands below to keep shipping."
    : "Tell BowerBird what to do in plain words.";

  const topBlock = isLive
    ? `<div class="mt-4 grid gap-2 md:grid-cols-3 text-sm">
        <div class="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2"><span class="font-medium">App:</span> ${appLive ? "Live" : "Not live"}</div>
        <div class="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2"><span class="font-medium">Database:</span> ${dbConnected ? "Connected" : "Not connected"}</div>
        <div class="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2"><span class="font-medium">Environment:</span> ${envReady ? "Ready" : "Needs setup"}</div>
      </div>`
    : `<div class="mt-4 text-xs text-slate-500">${launchOptions.join(" • ")}</div>`;

  return `
    <section class="rounded-xl bg-white p-5 shadow-sm border border-slate-200">
      <h2 class="text-xl font-semibold">${header}</h2>
      <p class="text-sm text-slate-600 mt-1">${subtitle}</p>
      ${topBlock}
      <label class="text-sm font-medium mt-4 block">Optional command input</label>
      <input
        id="command-center-input"
        class="mt-2 w-full rounded-md border border-slate-300 p-3 text-base"
        placeholder="deploy preview"
        value="${escapeHtml(commandText || "")}"
      />
      <p class="text-xs text-slate-500 mt-2">Examples: launch SaaS, deploy preview, add env DATABASE_URL, deploy supabase function generate</p>
      <div id="command-suggestions" class="mt-3 ${commandFocused ? "flex" : "hidden"} gap-2 flex-wrap">
        ${suggestions
          .map((item) => `<button type="button" class="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100" data-command-suggestion="${escapeHtml(item)}">${escapeHtml(item)}</button>`)
          .join("")}
      </div>
      <div class="mt-3">
        <button id="commandCenterRunBtn" ${busy ? "disabled" : ""} class="${buttonClass("rounded-md bg-slate-900 text-white px-4 py-2 text-sm font-medium", busy)}">${busy ? "Running..." : "Run"}</button>
      </div>
    </section>
  `;
}

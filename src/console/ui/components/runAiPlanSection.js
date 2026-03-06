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

function formatPlanStep(step) {
  const type = String(step?.type || "");
  if (type === "deploy_preview") return "deploy preview";
  if (type === "deploy_production") return "deploy production";
  if (type === "run_repair") return "run repair";
  if (type === "show_logs") return "show logs";
  if (type === "env_add") {
    return `add env ${String(step?.key || "KEY")}`;
  }
  if (type === "deploy_supabase_function") {
    const name = String(step?.name || "NAME");
    return `deploy supabase function ${name}`;
  }
  return type || "unknown";
}

function statusIcon(status) {
  if (status === "success") return "✓";
  if (status === "failed") return "✗";
  if (status === "running") return "⏳";
  return "•";
}

export function RunAiPlanSection({ loading, text, steps, jobIds, operations }) {
  const detectBusy = Boolean(loading.aiPlanDetectBtn);
  const runBusy = Boolean(loading.aiPlanRunBtn);
  const planSteps = Array.isArray(steps) ? steps : [];
  const queue = Array.isArray(operations) ? operations : [];
  const byId = new Map(queue.map((job) => [job.id, job]));
  const hasJobs = Array.isArray(jobIds) && jobIds.length > 0;

  const planList = planSteps.length > 0
    ? `<div class="mt-3">
      <div class="text-sm font-medium text-slate-700">Plan</div>
      <ol class="mt-1 list-decimal pl-5 text-sm text-slate-700 space-y-1">
        ${planSteps.map((step) => `<li>${escapeHtml(formatPlanStep(step))}</li>`).join("")}
      </ol>
    </div>`
    : "";

  const runStatus = hasJobs
    ? `<div class="mt-3">
      <div class="text-sm font-medium text-slate-700">Running plan</div>
      <ul class="mt-1 text-sm text-slate-700 space-y-1">
        ${jobIds.map((id, index) => {
          const job = byId.get(id);
          const status = String(job?.status || "queued");
          const step = planSteps[index];
          return `<li>${statusIcon(status)} ${escapeHtml(formatPlanStep(step))}</li>`;
        }).join("")}
      </ul>
    </div>`
    : "";

  return `
    <section class="rounded-xl bg-white p-5 shadow-sm border border-slate-200">
      <h2 class="text-lg font-semibold">AI Chat → Execution Plan</h2>
      <label class="text-sm font-medium mt-3 block">Paste Claude/Codex chat here</label>
      <textarea id="ai-plan-input" class="mt-2 w-full rounded-md border border-slate-300 p-3 h-28 text-sm" placeholder="Paste full AI conversation...">${escapeHtml(text || "")}</textarea>
      <div class="mt-3 flex gap-2 flex-wrap">
        <button id="aiPlanDetectBtn" ${detectBusy ? "disabled" : ""} class="${buttonClass("rounded-md bg-slate-700 text-white px-3 py-2 text-sm", detectBusy)}">${detectBusy ? "Detecting..." : "Detect actions"}</button>
        <button id="aiPlanRunBtn" ${runBusy || planSteps.length === 0 ? "disabled" : ""} class="${buttonClass("rounded-md bg-emerald-700 text-white px-3 py-2 text-sm", runBusy || planSteps.length === 0)}">${runBusy ? "Running..." : "Run"}</button>
      </div>
      ${planList}
      ${runStatus}
    </section>
  `;
}

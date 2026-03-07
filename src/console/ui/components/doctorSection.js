function badge(status) {
  if (status === "ok") {
    return '<span class="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">OK</span>';
  }
  if (status === "warn") {
    return '<span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Warn</span>';
  }
  if (status === "blocker") {
    return '<span class="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-800">Blocker</span>';
  }
  return '<span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">Unknown</span>';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function DoctorSection({ doctor, loading }) {
  const report = doctor && typeof doctor === "object" ? doctor : null;
  if (!report) {
    return `
      <section class="rounded-xl bg-white p-4 shadow-sm">
        <h2 class="text-lg font-semibold mb-2">Doctor</h2>
        <p class="text-sm text-slate-600">Loading environment checks...</p>
      </section>
    `;
  }

  const overall = String(report.overall || "warning");
  const overallLabel = overall === "ready" ? "Environment ready" : overall === "blocked" ? "Environment blocked" : "Needs attention";
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const issues = Array.isArray(report.issues) ? report.issues : [];
  const actions = Array.isArray(report.actions) ? report.actions : [];

  const checksHtml = checks.length > 0
    ? checks.map((check) => {
      const detail = check?.detail ? `<div class="text-xs text-slate-500 mt-1">${escapeHtml(check.detail)}</div>` : "";
      return `<li class="rounded-md border border-slate-200 px-3 py-2">
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-medium text-slate-800">${escapeHtml(check.label || "Check")}</span>
          ${badge(check.status)}
        </div>
        <div class="text-sm text-slate-700 mt-1">${escapeHtml(check.message || "")}</div>
        ${detail}
      </li>`;
    }).join("")
    : "<li class='text-sm text-slate-500'>No checks found.</li>";

  const issuesHtml = issues.length > 0
    ? issues.map((issue) => `<li class="text-sm text-slate-700">• ${escapeHtml(issue.message || "")}</li>`).join("")
    : "<li class='text-sm text-emerald-700'>No issues found.</li>";

  const actionsHtml = actions.length > 0
    ? actions.map((action) => {
      const actionId = String(action?.id || "");
      const label = String(action?.label || "Action");
      const description = String(action?.description || "");
      const isAutofix = String(action?.type || "") === "autofix";
      const command = String(action?.command || "");
      if (isAutofix) {
        const busy = Boolean(loading?.[`doctor-fix-${actionId}`]);
        return `<div class="rounded-md border border-slate-200 p-3">
          <div class="text-sm font-medium text-slate-800">${escapeHtml(label)}</div>
          <div class="text-xs text-slate-600 mt-1">${escapeHtml(description)}</div>
          <button
            id="doctorFixBtn-${escapeHtml(actionId)}"
            data-doctor-action-id="${escapeHtml(actionId)}"
            ${busy ? "disabled" : ""}
            class="mt-2 rounded-md bg-slate-900 text-white px-3 py-1.5 text-xs ${busy ? "opacity-60 cursor-not-allowed" : ""}"
          >${busy ? "Fixing..." : "Run safe fix"}</button>
        </div>`;
      }
      return `<div class="rounded-md border border-slate-200 p-3">
        <div class="text-sm font-medium text-slate-800">${escapeHtml(label)}</div>
        <div class="text-xs text-slate-600 mt-1">${escapeHtml(description)}</div>
        ${command
          ? `<div class="mt-2 flex items-center gap-2">
            <code class="rounded bg-slate-100 px-2 py-1 text-xs text-slate-800">${escapeHtml(command)}</code>
            <button
              id="doctorCopyBtn-${escapeHtml(actionId)}"
              data-copy-text="${escapeHtml(command)}"
              class="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
            >Copy</button>
          </div>`
          : ""}
      </div>`;
    }).join("")
    : "<p class='text-sm text-slate-500'>No actions needed.</p>";

  return `
    <section class="rounded-xl bg-white p-4 shadow-sm">
      <h2 class="text-lg font-semibold mb-1">Doctor</h2>
      <p class="text-sm text-slate-700">${escapeHtml(overallLabel)}</p>

      <h3 class="text-sm font-semibold mt-4 mb-2">Checks</h3>
      <ul class="space-y-2">${checksHtml}</ul>

      <h3 class="text-sm font-semibold mt-4 mb-2">Issues found</h3>
      <ul class="space-y-1">${issuesHtml}</ul>

      <h3 class="text-sm font-semibold mt-4 mb-2">Recommended fixes</h3>
      <div class="space-y-2">${actionsHtml}</div>
    </section>
  `;
}


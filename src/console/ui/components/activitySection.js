function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function actionLabel(type) {
  if (type === "deploy_preview") return "Preview deployment";
  if (type === "deploy_production") return "Production deployment";
  if (type === "add_env") return "Environment variable";
  if (type === "deploy_supabase_function") return "Supabase function";
  if (type === "view_logs") return "Viewing logs";
  if (type === "repair_deployment") return "Deployment repair";
  return "Operation";
}

function statusMark(status) {
  if (status === "success") return { mark: "✓", cls: "text-emerald-700" };
  if (status === "failed") return { mark: "✗", cls: "text-rose-700" };
  if (status === "running") return { mark: "⏳", cls: "text-blue-700" };
  return { mark: "•", cls: "text-slate-500" };
}

function timelineText(op) {
  const base = actionLabel(op.type);
  if (op.status === "running") {
    if (op.type === "deploy_preview") return "Deploying your app to preview environment";
    if (op.type === "add_env") return "Adding environment variable";
    if (op.type === "deploy_supabase_function") return "Deploying Supabase function";
    if (op.type === "repair_deployment") return "Fixing deployment error";
    return `${base} in progress`;
  }
  if (op.status === "success") {
    if (op.type === "deploy_preview") return "Preview deployment finished";
    if (op.type === "add_env") return "Environment variable added";
    if (op.type === "deploy_supabase_function") return "Supabase function deployed";
    if (op.type === "repair_deployment") return "Deployment repair finished";
    return `${base} finished`;
  }
  if (op.status === "failed") {
    return `${base} failed`;
  }
  return `${base} queued`;
}

export function ActivitySection({ operations }) {
  const latest = Array.isArray(operations) ? [...operations].reverse().slice(0, 8) : [];
  const rows = latest.length > 0
    ? latest
      .map((op) => {
        const status = statusMark(op.status);
        const time = new Date(op.finishedAt || op.startedAt || op.createdAt || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        return `<li class="py-1 flex items-center justify-between gap-3">
          <span class="${status.cls} text-xs font-semibold w-14">${escapeHtml(status.mark)}</span>
          <span class="text-sm flex-1">${escapeHtml(timelineText(op))}</span>
          <span class="text-xs text-slate-500">${escapeHtml(time)}</span>
        </li>`;
      })
      .join("")
    : `<li class="py-1 text-sm text-slate-500">No recent operations.</li>`;

  return `
    <section class="rounded-xl bg-white p-4 shadow-sm">
      <h2 class="text-lg font-semibold mb-2">Activity</h2>
      <ul>${rows}</ul>
    </section>
  `;
}

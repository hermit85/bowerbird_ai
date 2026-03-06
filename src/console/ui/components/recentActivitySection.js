export function RecentActivitySection({ status }) {
  const activity = status.activity || {};
  const vercel = status.vercel || {};

  const lastAction = activity.lastAction || "No recent activity";
  const lastActionAt = activity.lastActionAt || "-";
  const lastDeployUrl = vercel.lastDeployUrl || "No deploy yet";
  const lastDeployAt = vercel.lastDeployAt || "-";

  return `
    <section class="rounded-xl bg-white p-4 shadow-sm">
      <h2 class="text-lg font-semibold mb-3">Recent Activity</h2>
      <div class="grid grid-cols-3 gap-3 py-1"><div class="font-medium">Last action</div><div class="col-span-2 break-all">${escapeHtml(lastAction)}</div></div>
      <div class="grid grid-cols-3 gap-3 py-1"><div class="font-medium">Action time</div><div class="col-span-2 break-all">${escapeHtml(lastActionAt)}</div></div>
      <div class="grid grid-cols-3 gap-3 py-1"><div class="font-medium">Last deploy</div><div class="col-span-2 break-all">${escapeHtml(lastDeployUrl)}</div></div>
      <div class="grid grid-cols-3 gap-3 py-1"><div class="font-medium">Deploy time</div><div class="col-span-2 break-all">${escapeHtml(lastDeployAt)}</div></div>
    </section>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

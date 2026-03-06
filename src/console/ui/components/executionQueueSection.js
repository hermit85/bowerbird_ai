function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function statusClass(status) {
  if (status === "running") {
    return "text-blue-700";
  }
  if (status === "success") {
    return "text-emerald-700";
  }
  if (status === "failed") {
    return "text-rose-700";
  }
  return "text-slate-500";
}

export function ExecutionQueueSection({ operations }) {
  if (!Array.isArray(operations) || operations.length === 0) {
    return `
      <section class="rounded-xl bg-white p-4 shadow-sm">
        <h2 class="text-lg font-semibold mb-3">Execution Queue</h2>
        <p class="text-sm text-slate-500">No operations yet.</p>
      </section>
    `;
  }

  const rows = [...operations]
    .reverse()
    .map((op) => {
      const timestamp = op.finishedAt || op.startedAt || "-";
      const status = escapeHtml(op.status || "-");
      return `<tr class="border-t border-slate-200">
        <td class="py-2 pr-3 align-top text-sm break-all">${escapeHtml(op.id || "-")}</td>
        <td class="py-2 pr-3 align-top text-sm break-all">${escapeHtml(op.type || "-")}</td>
        <td class="py-2 pr-3 align-top text-sm capitalize ${statusClass(op.status)}">${status}</td>
        <td class="py-2 align-top text-sm">${escapeHtml(formatTime(op.createdAt || timestamp))}</td>
      </tr>`;
    })
    .join("");

  return `
    <section class="rounded-xl bg-white p-4 shadow-sm">
      <h2 class="text-lg font-semibold mb-3">Execution Queue</h2>
      <div class="overflow-auto">
        <table class="w-full text-left">
          <thead>
            <tr class="text-xs uppercase text-slate-500">
              <th class="pb-2 pr-3">Job ID</th>
              <th class="pb-2 pr-3">Type</th>
              <th class="pb-2 pr-3">Status</th>
              <th class="pb-2">Created</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

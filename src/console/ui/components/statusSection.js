export function StatusSection({ status }) {
  const row = (label, value) => {
    const safe = value === null || value === undefined || value === "" ? "-" : value;
    return `<div class="grid grid-cols-3 gap-3 py-1"><div class="font-medium">${label}</div><div class="col-span-2 break-all">${safe}</div></div>`;
  };

  const project = status.project || {};
  const git = status.git || {};
  const vercel = status.vercel || {};
  const supabase = status.supabase || {};
  const activity = status.activity || {};
  const supabaseLabel = supabase.connected
    ? supabase.projectRef
      ? `Connected (${supabase.projectRef})`
      : "Connected"
    : "Not connected";

  return `
    <section class="rounded-xl bg-white p-4 shadow-sm">
      <h2 class="text-lg font-semibold mb-3">Project Status</h2>
      ${row("Project", project.name)}
      ${row("Root", project.root)}
      ${row("Branch", git.branch)}
      ${row("Last deploy", vercel.lastDeployUrl || "No deploy yet")}
      ${row("Last deploy at", vercel.lastDeployAt)}
      ${row("Last action", activity.lastAction || "No recent activity")}
      ${row("Last action at", activity.lastActionAt)}
      ${row("Vercel", vercel.connected ? "Connected" : "Not connected")}
      ${row("Supabase", supabaseLabel)}
    </section>
  `;
}

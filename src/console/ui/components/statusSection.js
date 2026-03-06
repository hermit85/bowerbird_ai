export function StatusSection({ status }) {
  const row = (label, value) => {
    const safe = value === null || value === undefined || value === "" ? "-" : value;
    return `<div class="grid grid-cols-3 gap-3 py-1"><div class="font-medium">${label}</div><div class="col-span-2 break-all">${safe}</div></div>`;
  };

  return `
    <section class="rounded-xl bg-white p-4 shadow-sm">
      <h2 class="text-lg font-semibold mb-3">Project Status</h2>
      ${row("Repo", status.repoPath)}
      ${row("Branch", status.branch)}
      ${row("Last deploy", status.lastDeployUrl)}
      ${row("Vercel", status.vercelStatus)}
      ${row("Supabase", status.supabaseStatus)}
    </section>
  `;
}

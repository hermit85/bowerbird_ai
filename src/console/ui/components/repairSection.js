function buttonClass(base, disabled) {
  return `${base} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`;
}

export function RepairSection({ status, loading, capabilities }) {
  const caps = capabilities || {};
  const copyBusy = Boolean(loading.copyPromptBtn);
  const pasteBusy = Boolean(loading.pastePatchBtn);
  const applyBusy = Boolean(loading.applyRedeployBtn);
  const canRepair = caps.repair_loop !== false;

  return `
    <section class="rounded-xl bg-white p-4 shadow-sm">
      <h2 class="text-lg font-semibold mb-3">Repair Center</h2>
      <div class="text-sm font-medium mb-1">.bowerbird/last_error.json</div>
      <pre class="bg-slate-950 text-slate-100 rounded-md p-2 text-xs overflow-auto max-h-36">${escapeHtml(status.lastErrorJson || "(missing)")}</pre>
      <div class="text-sm font-medium mt-3 mb-1">.bowerbird/repair_prompt.md</div>
      <pre id="repairPromptText" class="bg-slate-950 text-slate-100 rounded-md p-2 text-xs overflow-auto max-h-36">${escapeHtml(status.repairPrompt || "(missing)")}</pre>
      <div class="mt-3 flex gap-2 flex-wrap">
        <button id="copyPromptBtn" ${copyBusy ? "disabled" : ""} class="${buttonClass("rounded-md bg-sky-600 text-white px-3 py-2 text-sm", copyBusy)}">${copyBusy ? "Copying..." : "Copy prompt"}</button>
        <button id="pastePatchBtn" ${pasteBusy ? "disabled" : ""} class="${buttonClass("rounded-md bg-amber-600 text-white px-3 py-2 text-sm", pasteBusy)}">${pasteBusy ? "Pasting..." : "Paste patch"}</button>
        ${canRepair ? `<button id="applyRedeployBtn" ${applyBusy ? "disabled" : ""} class="${buttonClass("rounded-md bg-indigo-600 text-white px-3 py-2 text-sm", applyBusy)}">${applyBusy ? "Applying..." : "Apply patch + redeploy"}</button>` : ""}
      </div>
    </section>
  `;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

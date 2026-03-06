function buttonClass(base, disabled) {
  return `${base} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`;
}

export function InstructionSection({ instruction, loading }) {
  const previewBusy = Boolean(loading.previewPlanBtn);
  const executeBusy = Boolean(loading.executeInstructionBtn);

  return `
    <section class="rounded-xl bg-white p-4 shadow-sm">
      <h2 class="text-lg font-semibold mb-3">AI Instruction Runner</h2>
      <label class="text-sm font-medium">Paste instruction from AI</label>
      <textarea id="instruction-input" class="mt-1 w-full rounded-md border border-slate-300 p-2 h-24" placeholder="deploy preview">${instruction || ""}</textarea>
      <div class="mt-3 flex gap-2">
        <button id="previewPlanBtn" ${previewBusy ? "disabled" : ""} class="${buttonClass("rounded-md bg-slate-700 text-white px-3 py-2 text-sm", previewBusy)}">${previewBusy ? "Planning..." : "Preview plan"}</button>
        <button id="executeInstructionBtn" ${executeBusy ? "disabled" : ""} class="${buttonClass("rounded-md bg-emerald-600 text-white px-3 py-2 text-sm", executeBusy)}">${executeBusy ? "Running..." : "Execute"}</button>
      </div>
    </section>
  `;
}

export function InstructionSection({ instruction }) {
  return `
    <section class="rounded-xl bg-white p-4 shadow-sm">
      <h2 class="text-lg font-semibold mb-3">AI Instruction Runner</h2>
      <label class="text-sm font-medium">Paste instruction from AI</label>
      <textarea id="instruction-input" class="mt-1 w-full rounded-md border border-slate-300 p-2 h-24" placeholder="deploy preview">${instruction || ""}</textarea>
      <div class="mt-3 flex gap-2">
        <button id="previewPlanBtn" class="rounded-md bg-slate-700 text-white px-3 py-2 text-sm">Preview plan</button>
        <button id="executeInstructionBtn" class="rounded-md bg-emerald-600 text-white px-3 py-2 text-sm">Execute</button>
      </div>
    </section>
  `;
}

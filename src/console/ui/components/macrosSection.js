function buttonClass(base, disabled) {
  return `${base} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`;
}

export function MacrosSection({ loading, macros }) {
  const list = Array.isArray(macros) ? macros : [];
  if (list.length === 0) {
    return `
      <section class="rounded-xl bg-white p-4 shadow-sm">
        <h2 class="text-lg font-semibold mb-3">Macros</h2>
        <p class="text-sm text-slate-500">No macros available for current capabilities.</p>
      </section>
    `;
  }

  const buttons = list.map((macro) => {
    const busy = Boolean(loading[`macro-${macro.id}`]);
    const label = busy ? "Running macro..." : macro.label;
    return `<button
      id="macroBtn-${macro.id}"
      data-macro-id="${macro.id}"
      data-macro-label="${macro.label}"
      data-macro-steps="${macro.steps?.length ?? 0}"
      ${busy ? "disabled" : ""}
      class="${buttonClass("rounded-md bg-violet-700 text-white px-3 py-2 text-sm", busy)}"
    >${label}</button>`;
  }).join("");

  return `
    <section class="rounded-xl bg-white p-4 shadow-sm">
      <h2 class="text-lg font-semibold mb-3">Macros</h2>
      <div class="flex gap-2 flex-wrap">${buttons}</div>
    </section>
  `;
}

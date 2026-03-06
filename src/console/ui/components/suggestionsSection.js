function buttonClass(base, disabled) {
  return `${base} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function SuggestionsSection({ suggestions, loading }) {
  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    return `
      <section class="rounded-xl bg-white p-4 shadow-sm">
        <h2 class="text-lg font-semibold mb-2">Suggested Next Steps</h2>
        <p class="text-sm text-slate-500">Everything looks good. No suggested actions.</p>
      </section>
    `;
  }

  const buttons = suggestions
    .map((suggestion) => {
      const busy = Boolean(loading[`suggestion-${suggestion.id}`]);
      return `<button
        id="suggestionBtn-${escapeHtml(suggestion.id)}"
        data-suggestion-id="${escapeHtml(suggestion.id)}"
        data-suggestion-action="${escapeHtml(suggestion.action)}"
        ${busy ? "disabled" : ""}
        class="${buttonClass("rounded-md bg-teal-700 text-white px-3 py-2 text-sm", busy)}"
      >${busy ? "Running..." : escapeHtml(suggestion.label)}</button>`;
    })
    .join("");

  return `
    <section class="rounded-xl bg-white p-4 shadow-sm">
      <h2 class="text-lg font-semibold mb-3">Suggested Next Steps</h2>
      <div class="flex gap-2 flex-wrap">${buttons}</div>
    </section>
  `;
}

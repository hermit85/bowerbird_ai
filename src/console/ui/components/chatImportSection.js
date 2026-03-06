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

export function ChatImportSection({ loading, chatText, parsedActions, emptyMessage }) {
  const extractBusy = Boolean(loading.extractActionsBtn);

  const actionsList = Array.isArray(parsedActions) && parsedActions.length > 0
    ? `<div class="mt-3">
      <div class="text-sm font-medium text-slate-700 mb-1">Detected actions:</div>
      <ul class="list-disc pl-5 text-sm text-slate-700 space-y-1">${parsedActions
        .map((action) => `<li>${escapeHtml(action)}</li>`)
        .join("")}</ul>
    </div>`
    : emptyMessage
      ? `<p class="mt-3 text-sm text-slate-500">${escapeHtml(emptyMessage)}</p>`
      : "";

  return `
    <section class="rounded-xl bg-white p-4 shadow-sm">
      <h2 class="text-lg font-semibold mb-3">Import from AI Chat</h2>
      <textarea id="chat-import-input" class="w-full rounded-md border border-slate-300 p-2 h-28" placeholder="Paste Claude/Codex chat text here...">${escapeHtml(chatText || "")}</textarea>
      <div class="mt-3">
        <button id="extractActionsBtn" ${extractBusy ? "disabled" : ""} class="${buttonClass("rounded-md bg-slate-700 text-white px-3 py-2 text-sm", extractBusy)}">${extractBusy ? "Extracting..." : "Extract actions"}</button>
      </div>
      ${actionsList}
    </section>
  `;
}

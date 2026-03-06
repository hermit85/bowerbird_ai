function buttonClass(base, disabled) {
  return `${base} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`;
}

export function AutoModeSection({ loading }) {
  const busy = Boolean(loading.autoModeBtn);
  return `
    <section class="rounded-xl bg-white p-4 shadow-sm">
      <h2 class="text-lg font-semibold mb-3">Auto Mode</h2>
      <button id="autoModeBtn" ${busy ? "disabled" : ""} class="${buttonClass("rounded-md bg-emerald-800 text-white px-3 py-2 text-sm", busy)}">${busy ? "Running auto mode..." : "Run safe operations automatically"}</button>
    </section>
  `;
}

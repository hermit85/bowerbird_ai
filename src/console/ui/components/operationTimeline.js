// operationTimeline.js — Structured founder-facing operation timeline

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// ---------------------------------------------------------------------------
// Label helpers (mirrored from app.js to avoid import refactoring)
// ---------------------------------------------------------------------------

function operationLabel(operation) {
  if (operation === "connect_database") return "Connected your app";
  if (operation === "deploy_backend_functions") return "Connected what was missing";
  if (operation === "prepare_preview") return "Prepared a test version";
  if (operation === "make_app_live") return "Ready for publishing";
  if (operation === "show_logs") return "Show details";
  if (operation === "run_repair") return "Try a guided fix";
  if (operation === "deploy_preview") return "Prepared a test version";
  if (operation === "deploy_production") return "Published your app";
  if (operation === "add_env") return "Connected your app";
  if (operation === "deploy_supabase_function") return "Connected what was missing";
  if (operation === "repair_deployment") return "Tried a guided fix";
  if (operation === "view_logs") return "View details";
  return operation || "Operation";
}

function entryLabel(entry) {
  if (entry.operation) {
    if (entry.message && entry.message !== entry.operation) {
      // Strip status suffixes from message to get the clean label
      const msg = String(entry.message);
      const cleaned = msg
        .replace(/ queued$/, "")
        .replace(/ running$/, "")
        .replace(/ completed$/, "")
        .replace(/ failed$/, "")
        .trim();
      if (cleaned) return cleaned;
    }
    return operationLabel(entry.operation);
  }
  // Job object (from operations)
  const type = String(entry.type || "");
  if (type === "add_env") {
    const key = String(entry.payload?.key || "");
    return key ? `Connected your app (${key})` : "Connected your app";
  }
  if (type === "deploy_supabase_function") {
    const fn = String(entry.payload?.functionName || entry.payload?.name || "");
    return fn ? `Connected what was missing (${fn})` : "Connected what was missing";
  }
  return operationLabel(type);
}

function friendlyDetail(operation) {
  if (operation === "connect_database") return "Connecting what your app needs to save data";
  if (operation === "deploy_backend_functions") return "Setting up missing app capabilities";
  if (operation === "prepare_preview") return "Preparing a test version you can review";
  if (operation === "deploy_preview") return "Preparing a test version you can review";
  if (operation === "make_app_live") return "Publishing your app for people";
  if (operation === "deploy_production") return "Publishing your app for people";
  if (operation === "show_logs" || operation === "view_logs") return "Collecting details to help you";
  if (operation === "run_repair" || operation === "repair_deployment") return "Trying a guided fix";
  if (operation === "add_env") return "Connecting what your app needs";
  if (operation === "deploy_supabase_function") return "Setting up missing app capabilities";
  return null;
}

// ---------------------------------------------------------------------------
// Status visual helpers
// ---------------------------------------------------------------------------

function timelineStatusIcon(status) {
  if (status === "success") return "✓";
  if (status === "running") return "●";
  if (status === "failed") return "✗";
  if (status === "warn") return "!";
  if (status === "queued") return "○";
  if (status === "skipped") return "↷";
  if (status === "confirming") return "⏸";
  return "○";
}

function timelineStatusColor(status) {
  if (status === "success") return "text-emerald-600";
  if (status === "running") return "text-blue-600";
  if (status === "failed") return "text-rose-600";
  if (status === "warn") return "text-amber-600";
  if (status === "confirming") return "text-amber-500";
  return "text-slate-400";
}

function timelineStatusBg(status) {
  if (status === "success") return "bg-emerald-100";
  if (status === "running") return "bg-blue-100";
  if (status === "failed") return "bg-rose-100";
  if (status === "warn") return "bg-amber-100";
  if (status === "confirming") return "bg-amber-50 border border-amber-200";
  return "bg-slate-100";
}

function timelineBorderColor(status) {
  if (status === "running") return "border-sky-200 bg-sky-50/50";
  if (status === "failed") return "border-rose-200 bg-rose-50/50";
  if (status === "warn") return "border-amber-200 bg-amber-50/50";
  if (status === "confirming") return "border-amber-200 bg-amber-50/30";
  return "border-slate-200/80 bg-white/70";
}

function normalizeTimelineStatus(status) {
  const s = String(status || "queued");
  if (s === "error" || s === "failed") return "failed";
  if (s === "success" || s === "completed") return "success";
  if (s === "running") return "running";
  if (s === "queued" || s === "pending") return "queued";
  if (s === "skipped") return "skipped";
  if (s === "confirming") return "confirming";
  return "queued";
}

// Map job.type → operation for matching activity entries to jobs
function normalizeJobOperation(type) {
  if (type === "deploy_preview") return "prepare_preview";
  if (type === "deploy_production") return "make_app_live";
  if (type === "add_env") return "connect_database";
  if (type === "deploy_supabase_function") return "deploy_backend_functions";
  if (type === "repair_deployment") return "run_repair";
  if (type === "view_logs") return "show_logs";
  return type;
}

function formatTime(ts) {
  const date = new Date(ts || Date.now());
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Job output matching
// ---------------------------------------------------------------------------

function findJobOutput(activityEntry, operations) {
  const jobs = Array.isArray(operations) ? operations : [];

  // Exact match by jobIds stored on the activity entry
  if (Array.isArray(activityEntry.jobIds) && activityEntry.jobIds.length > 0) {
    for (const jobId of activityEntry.jobIds) {
      const job = jobs.find((j) => String(j.id) === String(jobId));
      if (job?.output) return job.output;
    }
  }

  // Heuristic fallback: match by operation type + time proximity
  const operation = activityEntry.operation;
  if (!operation) return null;
  const entryTime = new Date(activityEntry.timestamp).getTime();

  for (const job of [...jobs].reverse()) {
    const jobOp = normalizeJobOperation(job.type);
    if (jobOp === operation && job.output) {
      const jobTime = job.finishedAt || job.startedAt || job.createdAt;
      if (Math.abs(jobTime - entryTime) < 300000) {
        return job.output;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// buildTimeline — pure function, merges data sources into timeline entries
// ---------------------------------------------------------------------------

export function buildTimeline(activityLog, operations, executionPlan, prodConfirmChecked) {
  const entries = [];

  const planSteps = Array.isArray(executionPlan?.steps) ? executionPlan.steps : [];
  const planActive = planSteps.some(
    (s) => s?.status === "running" || s?.status === "pending",
  );

  if (planActive && planSteps.length > 0) {
    // Plan is actively running — use plan steps as authoritative source
    for (let i = 0; i < planSteps.length; i++) {
      const step = planSteps[i];
      const operation = String(step?.operation || "");
      let status = normalizeTimelineStatus(step?.status);

      // Show confirming state for production deploy awaiting confirmation
      if (
        operation === "make_app_live" &&
        status === "queued" &&
        !prodConfirmChecked
      ) {
        status = "confirming";
      }

      entries.push({
        id: step?.id || `plan_${i}`,
        label: step?.label || operationLabel(operation) || `Step ${i + 1}`,
        detail: status === "running" || status === "confirming"
          ? friendlyDetail(operation)
          : null,
        status,
        timestamp: Date.now(),
        displayTime: formatTime(Date.now()),
        error: step?.error || null,
        output: null,
        source: "plan",
        planIndex: i,
      });
    }
  } else {
    // Use activity log entries
    const recent = Array.isArray(activityLog) ? activityLog.slice(0, 8) : [];
    for (const entry of recent) {
      const status = normalizeTimelineStatus(entry.status);
      const operation = String(entry.operation || "");
      entries.push({
        id: entry.id,
        label: entryLabel(entry),
        detail: status === "running" ? friendlyDetail(operation) : null,
        status,
        timestamp: new Date(entry.timestamp).getTime(),
        displayTime: formatTime(entry.timestamp),
        error: entry.error || null,
        output: findJobOutput(entry, operations),
        source: "activity",
        planIndex: null,
      });
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// computeOutcome — summary block when all steps are complete
// ---------------------------------------------------------------------------

export function computeOutcome(entries) {
  if (entries.length === 0) return null;

  const hasActive = entries.some(
    (e) => e.status === "running" || e.status === "queued" || e.status === "confirming",
  );
  if (hasActive) return null;

  const succeeded = entries.filter((e) => e.status === "success");
  const failed = entries.filter((e) => e.status === "failed");
  const skipped = entries.filter((e) => e.status === "skipped");
  const warned = entries.filter((e) => e.status === "warn");

  // Only show outcome when there was actual work
  if (succeeded.length === 0 && failed.length === 0) return null;

  let tone, title, message, nextAction;

  if (failed.length === 0) {
    tone = "success";
    title = "All steps completed";
    message =
      succeeded.length === 1
        ? `${escapeHtml(succeeded[0].label)} finished successfully.`
        : `${succeeded.length} operations finished successfully.`;
    nextAction = null;
  } else if (succeeded.length === 0) {
    tone = "failed";
    title = "Operation failed";
    message =
      failed.length === 1
        ? `${escapeHtml(failed[0].label)} failed.`
        : `${failed.length} operations failed.`;
    nextAction = "Review the errors below and retry, or check logs in Advanced.";
  } else {
    tone = "partial";
    title = "Completed with issues";
    const parts = [];
    if (succeeded.length > 0) parts.push(`${succeeded.length} succeeded`);
    if (failed.length > 0) parts.push(`${failed.length} failed`);
    if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
    message = parts.join(", ") + ".";
    nextAction = "Review failed steps and retry them individually.";
  }

  return { tone, title, message, nextAction, succeeded, failed, skipped, warned };
}

// ---------------------------------------------------------------------------
// Outcome summary HTML
// ---------------------------------------------------------------------------

function renderOutcomeSummary(outcome) {
  const toneStyles = {
    success: "bg-emerald-50 border-emerald-200 text-emerald-900",
    failed: "bg-rose-50 border-rose-200 text-rose-900",
    partial: "bg-amber-50 border-amber-200 text-amber-900",
  };
  const style = toneStyles[outcome.tone] || toneStyles.partial;
  const iconMap = { success: "✓", failed: "✗", partial: "!" };
  const icon = iconMap[outcome.tone] || "!";

  let html = `
    <div class="mb-4 rounded-lg border p-3 ${style}">
      <div class="flex items-center gap-2">
        <span class="text-sm font-bold">${icon}</span>
        <span class="text-sm font-semibold">${escapeHtml(outcome.title)}</span>
      </div>
      <div class="text-sm mt-1">${outcome.message}</div>`;

  if (outcome.skipped.length > 0) {
    html += `<div class="text-xs mt-1 opacity-80">Skipped: ${outcome.skipped.map((e) => escapeHtml(e.label)).join(", ")}</div>`;
  }
  if (outcome.nextAction) {
    html += `<div class="text-xs mt-2 font-medium">${escapeHtml(outcome.nextAction)}</div>`;
  }

  html += `</div>`;
  return html;
}

// ---------------------------------------------------------------------------
// OperationTimeline — main render function
// ---------------------------------------------------------------------------

export function OperationTimeline({ entries, outcome, expandedIds, doctorReport }) {
  if (entries.length === 0) {
    // Empty state — welcoming, not blank
    let envLine = "○ Checking environment";
    if (doctorReport) {
      const checks = Array.isArray(doctorReport.checks) ? doctorReport.checks : [];
      const issues = Array.isArray(doctorReport.issues) ? doctorReport.issues : [];
      const hasBlocker = issues.some((i) => i.severity === "error");
      const hasWarning = issues.some((i) => i.severity === "warning");
      if (checks.length > 0 && !hasBlocker && !hasWarning) {
        envLine = "✓ Environment ready";
      } else if (hasBlocker) {
        envLine = "○ Environment blocked — check Doctor in Advanced";
      } else if (hasWarning) {
        envLine = "○ Environment needs attention";
      }
    }

    return `
      <section class="mt-8 rounded-3xl bg-white/88 p-6 shadow-soft border border-slate-200/70">
        <h2 class="text-lg font-semibold">Recent progress</h2>
        <p class="mt-1 text-sm text-slate-600">Your launch momentum, one clear step at a time.</p>
        <ul class="mt-3 space-y-2 text-sm text-slate-600">
          <li class="flex items-center gap-2">
            <span class="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-xs text-emerald-600">✓</span>
            <span>Project loaded</span>
          </li>
          <li class="flex items-center gap-2">
            <span class="flex items-center justify-center w-5 h-5 rounded-full bg-slate-100 text-xs text-slate-400">${envLine.startsWith("✓") ? "✓" : "○"}</span>
            <span>${escapeHtml(envLine.replace(/^[✓○] /, ""))}</span>
          </li>
          <li class="flex items-center gap-2">
            <span class="flex items-center justify-center w-5 h-5 rounded-full bg-slate-100 text-xs text-slate-400">○</span>
            <span>Ready for your next guided step</span>
          </li>
        </ul>
      </section>
    `;
  }

  const rows = entries
    .map((entry, index) => {
      const isLast = index === entries.length - 1;
      const isExpanded = expandedIds instanceof Set && expandedIds.has(entry.id);
      const icon = timelineStatusIcon(entry.status);
      const iconColor = timelineStatusColor(entry.status);
      const iconBg = timelineStatusBg(entry.status);
      const borderColor = timelineBorderColor(entry.status);
      const isRunning = entry.status === "running";
      const isConfirming = entry.status === "confirming";

      // Connector line between steps
      const connector = !isLast
        ? `<div class="absolute left-[9px] top-7 bottom-0 w-px bg-slate-200" aria-hidden="true"></div>`
        : "";

      // Step number badge (only for plan steps)
      const stepBadge =
        entry.planIndex !== null
          ? `<div class="text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">Step ${entry.planIndex + 1}</div>`
          : "";

      // Detail text (shown for running and confirming states)
      const detailHtml = entry.detail
        ? `<div class="mt-1 text-xs text-slate-500">${escapeHtml(entry.detail)}</div>`
        : "";

      // Confirming banner
      const confirmingHtml = isConfirming
        ? `<div class="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">Waiting for your confirmation before proceeding</div>`
        : "";

      // Progress bar for running state
      const progressHtml = isRunning
        ? `<div class="mt-2 h-1 rounded-full bg-slate-100 overflow-hidden"><div class="h-full bg-blue-400 rounded-full" style="width:60%;animation:pulse 2s ease-in-out infinite"></div></div>`
        : "";

      // Error block
      const errorHtml =
        entry.status === "failed" && entry.error
          ? `<div class="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">${escapeHtml(String(entry.error).split(/\r?\n/)[0])}</div>`
          : "";

      // Expandable log toggle
      let logHtml = "";
      if (entry.output) {
        const toggleLabel = isExpanded ? "Hide logs" : "View logs";
        logHtml = `<button id="timelineLogToggle-${escapeHtml(entry.id)}" class="mt-2 text-xs text-slate-500 hover:text-slate-700 cursor-pointer" data-timeline-toggle="${escapeHtml(entry.id)}">${toggleLabel}</button>`;
        if (isExpanded) {
          logHtml += `<pre class="mt-2 text-[11px] leading-relaxed bg-slate-950 text-slate-200 rounded-md p-3 overflow-auto max-h-40 whitespace-pre-wrap">${escapeHtml(entry.output)}</pre>`;
        }
      }

      return `
        <li class="relative pl-8 ${isLast ? "" : "pb-4"}">
          ${connector}
          <div class="absolute left-0 top-1 flex items-center justify-center w-[18px] h-[18px] rounded-full ${iconBg}">
            <span class="text-[11px] leading-none ${iconColor}" ${isRunning ? 'style="animation:pulse 1.5s ease-in-out infinite"' : ""}>${icon}</span>
          </div>
          <div class="rounded-2xl border ${borderColor} p-3.5 ${isRunning ? "ring-1 ring-sky-200 shadow-soft" : ""} ${isConfirming ? "ring-1 ring-amber-200" : ""}">
            ${stepBadge}
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm font-medium text-slate-800">${escapeHtml(entry.label)}</span>
              <span class="text-[11px] text-slate-400 whitespace-nowrap">${escapeHtml(entry.displayTime)}</span>
            </div>
            ${detailHtml}
            ${confirmingHtml}
            ${progressHtml}
            ${errorHtml}
            ${logHtml}
          </div>
        </li>
      `;
    })
    .join("");

  const outcomeHtml = outcome ? renderOutcomeSummary(outcome) : "";

  return `
    <section class="mt-8 rounded-3xl bg-white/88 p-6 shadow-soft border border-slate-200/70">
      <h2 class="text-lg font-semibold mb-1">Recent progress</h2>
      <p class="mb-3 text-sm text-slate-600">A trusted timeline showing what moved forward and what is still in progress.</p>
      ${outcomeHtml}
      <ol class="list-none m-0 p-0">${rows}</ol>
    </section>
    <style>
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
    </style>
  `;
}

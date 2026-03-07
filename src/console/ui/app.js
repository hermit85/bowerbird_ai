import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18";
import { createRoot } from "https://esm.sh/react-dom@18/client";
import { AutoModeSection } from "/components/autoModeSection.js";
import { ExecutionQueueSection } from "/components/executionQueueSection.js";
import { StatusSection } from "/components/statusSection.js";
import { ChatImportSection } from "/components/chatImportSection.js";
import { MacrosSection } from "/components/macrosSection.js";
import { QuickActionsSection } from "/components/quickActionsSection.js";
import { InstructionSection } from "/components/instructionSection.js";
import { RepairSection } from "/components/repairSection.js";
import { DeploymentSection } from "/components/deploymentSection.js";
import { EnvironmentSection } from "/components/environmentSection.js";
import { DoctorSection } from "/components/doctorSection.js";
import { OperationTimeline, buildTimeline, computeOutcome } from "/components/operationTimeline.js";
import { getLaunchChecklist, getLaunchState, isProjectLive, mergeLaunchState } from "/launchState.js";

console.log("deplo.app UI loaded");

const ALL_MACROS = [
  {
    id: "setup_supabase_api",
    label: "Setup Supabase API",
    steps: [
      "add env SUPABASE_URL to vercel",
      "add env SUPABASE_ANON_KEY to vercel",
      "deploy supabase function api",
      "deploy preview",
    ],
  },
  {
    id: "first_deploy",
    label: "First Deploy",
    steps: ["deploy preview"],
  },
];

function stepSupported(step, capabilities) {
  const normalized = String(step || "").toLowerCase();
  if (normalized.includes("deploy production")) {
    return capabilities.deploy_production !== false;
  }
  if (normalized.includes("deploy preview")) {
    return capabilities.deploy_preview !== false;
  }
  if (normalized.includes("add env")) {
    return capabilities.env_management !== false;
  }
  if (normalized.includes("deploy supabase function")) {
    return capabilities.supabase_functions !== false;
  }
  if (normalized.includes("repair")) {
    return capabilities.repair_loop !== false;
  }
  if (normalized.includes("log")) {
    return capabilities.logs !== false;
  }
  return true;
}

function detectHeroState(status, operations) {
  const latest = Array.isArray(operations) ? [...operations].reverse() : [];
  const hasRunning = latest.some((job) => job?.status === "running");
  if (hasRunning) {
    return "running";
  }

  const latestStatus = latest[0]?.status;
  if (latestStatus === "failed") {
    return "failed";
  }

  if (status?.vercel?.lastDeployUrl) {
    return "live";
  }

  if (status?.lastErrorJson) {
    return "failed";
  }

  return "empty";
}

function extractErrorSummary(status) {
  const raw = status?.lastErrorJson || "";
  if (!raw) {
    return "A deployment step failed. You can fix it with AI or view logs.";
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.message && typeof parsed.message === "string") {
      return parsed.message;
    }
    if (parsed?.error && typeof parsed.error === "string") {
      return parsed.error;
    }
  } catch {
    // Fall through and use plain-text parsing.
  }

  const line = String(raw).split(/\r?\n/).find((item) => item.trim().length > 0);
  return line || "A deployment step failed. You can fix it with AI or view logs.";
}

function formatExecutionAction(action) {
  const type = String(action?.type || "");
  if (type === "connect_database") return "connect database";
  if (type === "deploy_backend_functions") return "deploy backend functions";
  if (type === "prepare_preview") return "deploy preview";
  if (type === "make_app_live") return "deploy production";
  if (type === "run_repair") return "run repair";
  if (type === "show_logs") return "show logs";
  if (type === "env_add") return `add env ${String(action?.key || "KEY")}`;
  if (type === "deploy_supabase_function") return `deploy supabase function ${String(action?.name || "NAME")}`;
  return type || "unknown";
}

function normalizeLaunchOperation(action) {
  const type = String(action?.type || "");
  if (type === "connect_database" || type === "env_add") return "connect_database";
  if (type === "deploy_backend_functions" || type === "deploy_supabase_function") return "deploy_backend_functions";
  if (type === "prepare_preview" || type === "deploy_preview") return "prepare_preview";
  if (type === "make_app_live" || type === "deploy_production") return "make_app_live";
  if (type === "show_logs") return "show_logs";
  if (type === "run_repair" || type === "repair_deployment") return "run_repair";
  return type || "operation";
}

function launchOperationLabel(operation) {
  if (operation === "connect_database") return "Connected your app";
  if (operation === "deploy_backend_functions") return "Connected what was missing";
  if (operation === "prepare_preview") return "Prepared a test version";
  if (operation === "make_app_live") return "Ready for publishing";
  if (operation === "show_logs") return "Show details";
  if (operation === "run_repair") return "Try a guided fix";
  return operation || "Operation";
}

function humanActionLabel(action) {
  return launchOperationLabel(normalizeLaunchOperation(action));
}

function checklistActionFromStepId(stepId) {
  if (stepId === "founderConnectDbBtn") return { type: "connect_database" };
  if (stepId === "founderDeployFunctionsBtn") return { type: "deploy_backend_functions" };
  if (stepId === "founderPreviewBtn") return { type: "prepare_preview" };
  if (stepId === "founderLiveBtn") return { type: "make_app_live" };
  return null;
}

function createPlanSteps(actions) {
  return (Array.isArray(actions) ? actions : []).map((action, index) => ({
    id: `plan_step_${index}_${normalizeLaunchOperation(action)}`,
    action,
    operation: normalizeLaunchOperation(action),
    label: humanActionLabel(action),
    status: "pending",
    error: null,
  }));
}

function createCompletionSnapshot(launchState) {
  return {
    connect_database: Boolean(launchState?.databaseConnected),
    deploy_backend_functions: Boolean(launchState?.backendDeployed),
    prepare_preview: Boolean(launchState?.previewReady),
    make_app_live: Boolean(launchState?.appLive),
  };
}

function friendlyIntent(action) {
  const type = String(action?.type || "");
  if (type === "prepare_preview") return "Prepare a test version you can review";
  if (type === "make_app_live") return "Publish your app for real people";
  if (type === "connect_database") return "Connect your app so it can save data";
  if (type === "deploy_backend_functions") return "Set up app features that run in the background";
  if (type === "env_add") return "Connect your app so it can save data";
  if (type === "deploy_supabase_function") return "Set up app features that run in the background";
  if (type === "show_logs") return "Show more details";
  if (type === "run_repair") return "Try a guided fix";
  return "Run this guided step";
}

function getEnvironmentStatusFromDoctor(doctorReport) {
  const overall = String(doctorReport?.overall || "").trim().toLowerCase();
  if (overall === "ready") {
    return { label: "Ready", severity: "ready" };
  }
  if (overall === "warning") {
    return { label: "Needs attention", severity: "warning" };
  }
  if (overall === "blocked") {
    return { label: "Blocked", severity: "blocked" };
  }
  return { label: "Checking", severity: "checking" };
}

function getDoctorAutofixActions(doctorReport) {
  const actions = Array.isArray(doctorReport?.actions) ? doctorReport.actions : [];
  return actions.filter((action) => String(action?.type || "") === "autofix" && String(action?.id || "").trim());
}

function getPrimaryNextActionState(doctorReport) {
  const environment = getEnvironmentStatusFromDoctor(doctorReport);
  const hasAutofix = getDoctorAutofixActions(doctorReport).length > 0;
  if (environment.severity === "blocked") {
    return {
      mode: hasAutofix ? "setup_fix" : "setup_open",
      subtitle: "Fix setup issues first before launching your app",
      buttonLabel: hasAutofix ? "Fix environment" : "Open Doctor",
      loadingLabel: hasAutofix ? "Applying safe fixes..." : "Opening Doctor...",
    };
  }
  if (environment.severity === "warning") {
    return {
      mode: hasAutofix ? "setup_fix" : "setup_open",
      subtitle: "Resolve setup issues first before launching your app",
      buttonLabel: hasAutofix ? "Fix environment" : "Open Doctor",
      loadingLabel: hasAutofix ? "Applying safe fixes..." : "Opening Doctor...",
    };
  }
  return {
    mode: "shipping",
    subtitle: "Launch your app",
    buttonLabel: "Launch my app",
    loadingLabel: "Launching...",
  };
}

function renderFounderSetupProgress(launchState, loading, launchProgress, launchStepStates, doctorReport) {
  const steps = getLaunchChecklist(launchState);
  const nextAction = getPrimaryNextActionState(doctorReport);
  const environment = getEnvironmentStatusFromDoctor(doctorReport);
  const isSetupFirst = nextAction.mode !== "shipping";

  const allDone = steps.every((step) => step.done);
  const hasIncomplete = steps.some((step) => !step.done);
  const rows = steps
    .map((step) => {
      const busy = Boolean(loading?.[step.id]);
      const liveState = launchStepStates?.[step.id];
      const displayState = liveState || (step.done ? "completed" : "pending");
      if (displayState === "completed") {
        return `<li class="py-1 text-sm text-emerald-800">✓ ${step.label}</li>`;
      }
      const indicator = displayState === "running"
        ? '<span class="inline-block mr-2 text-blue-700 animate-pulse">●</span>'
        : '<span class="inline-block mr-2 text-slate-500">→</span>';
      return `<li class="py-1">
        <button
          id="${step.id}"
          data-step-instruction="${step.instruction}"
          ${step.requiresConfirm ? 'data-step-confirm="production"' : ""}
          ${busy || displayState === "running" ? "disabled" : ""}
          class="w-full text-left text-sm rounded-xl px-2.5 py-1.5 border border-slate-200/80 bg-white/70 text-slate-700 hover:bg-white hover:border-slate-300 transition ${(busy || displayState === "running") ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}"
        >${indicator}${step.label}</button>
      </li>`;
    })
    .join("");

  const guidanceBanner = environment.severity === "blocked"
    ? `<div class="mt-4 rounded-2xl border border-rose-200 bg-rose-50/90 p-4">
      <div class="text-xs font-semibold tracking-wide text-rose-700">Setup needed now</div>
      <p class="mt-1 text-sm text-rose-900">We found setup blockers. We will guide you step by step so you can keep moving.</p>
    </div>`
    : environment.severity === "warning"
      ? `<div class="mt-4 rounded-2xl border border-amber-200 bg-amber-50/90 p-4">
        <div class="text-xs font-semibold tracking-wide text-amber-700">Setup needs attention</div>
        <p class="mt-1 text-sm text-amber-900">Safe fixes run automatically, and production actions still require your approval.</p>
      </div>`
      : `<div class="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/90 p-4">
        <div class="text-xs font-semibold tracking-wide text-emerald-700">Ready to move</div>
        <p class="mt-1 text-sm text-emerald-900">Here is the fastest safe step forward.</p>
      </div>`;

  return `
    <section class="mt-8 rounded-3xl bg-gradient-to-b from-emerald-50/70 to-white/90 p-6 shadow-medium border border-emerald-100/70 transition-all duration-200">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="text-2xl font-semibold text-slate-900">Next best step</h2>
          <p class="text-sm text-slate-600 mt-1">${escapeHtml(nextAction.subtitle)}</p>
          <p class="mt-2 text-xs text-slate-500">You are guided step by step. Safe fixes run automatically, and you approve risky actions.</p>
        </div>
        <span class="rounded-full px-3 py-1 text-xs font-medium ${isSetupFirst ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}">${isSetupFirst ? "Setup first" : "Shipping"}</span>
      </div>
      ${guidanceBanner}
      ${hasIncomplete
        ? `<div class="mt-4">
          <button id="founderLaunchAppBtn" ${loading?.founderLaunchAppBtn ? "disabled" : ""} class="rounded-full bg-emerald-700 text-white px-5 py-2.5 text-sm font-semibold shadow-medium hover:bg-emerald-800 hover:-translate-y-0.5 transition ${loading?.founderLaunchAppBtn ? "opacity-60 cursor-not-allowed" : ""}">${loading?.founderLaunchAppBtn ? nextAction.loadingLabel : nextAction.buttonLabel}</button>
        </div>`
        : ""}
      ${launchProgress
        ? `<p class="mt-3 text-sm text-slate-700">${escapeHtml(launchProgress)}</p>`
        : ""}
      <ul class="mt-4 space-y-1.5">${rows}</ul>
      ${allDone ? '<p class="mt-3 text-sm font-medium text-emerald-700">Your app is live 🚀</p>' : ""}
    </section>
  `;
}

function renderProjectLiveInfo(status, launchState, doctorReport) {
  const appLive = isProjectLive(launchState);
  const dbConnected = Boolean(launchState?.databaseConnected);
  const environment = getEnvironmentStatusFromDoctor(doctorReport);
  const statusPill = (label, value, tone) => `
    <div class="rounded-2xl border p-3.5 shadow-sm ${tone}">
      <div class="text-xs tracking-wide text-slate-500">${label}</div>
      <div class="mt-1 text-base font-semibold">${escapeHtml(value)}</div>
      <div class="mt-1 text-xs text-slate-500">${label === "App" ? "Shipping status" : label === "Database" ? "Core data connection" : "Readiness check"}</div>
    </div>
  `;
  const appTone = appLive ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-slate-50 text-slate-800";
  const dbTone = dbConnected ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900";
  const envTone = environment.severity === "ready"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : environment.severity === "blocked"
      ? "border-rose-200 bg-rose-50 text-rose-900"
      : environment.severity === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-slate-200 bg-slate-50 text-slate-800";
  return `
    <section class="mt-8 rounded-3xl bg-white/85 p-6 shadow-soft border border-slate-200/65">
      <h2 class="text-xl font-semibold">Project confidence</h2>
      <p class="text-sm text-slate-600 mt-1">A calm snapshot of your launch readiness.</p>
      <div class="mt-4 grid gap-3 md:grid-cols-3 text-sm">
        ${statusPill("App", appLive ? "Live" : "In progress", appTone)}
        ${statusPill("Database", dbConnected ? "Connected" : "Needs setup", dbTone)}
        ${statusPill("Environment", environment.label, envTone)}
      </div>
    </section>
  `;
}

function toStackLabel(kind, value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return "Not detected";
  }
  if (kind === "framework") {
    if (raw === "next") return "Next.js";
    if (raw === "react") return "React";
    if (raw === "vite") return "Vite";
  }
  if (kind === "deploy") {
    if (raw === "vercel") return "Vercel";
    if (raw === "netlify") return "Netlify";
  }
  if (kind === "database") {
    if (raw === "supabase") return "Supabase";
  }
  if (kind === "backend") {
    if (raw === "supabase-functions") return "Supabase functions";
  }
  return "Not detected";
}

function renderDetectedStack(status) {
  const stack = status?.stack || {};
  return `
    <section class="rounded-2xl bg-slate-50/60 p-5 shadow-sm border border-slate-200/70">
      <h2 class="text-lg font-semibold">Technical setup</h2>
      <p class="text-xs text-slate-500 mt-1">Technical context used for guided operations.</p>
      <div class="mt-4 space-y-2 text-sm">
        <div class="flex justify-between border-b border-slate-100 pb-1"><span class="font-medium">Framework</span><span>${escapeHtml(toStackLabel("framework", stack.framework))}</span></div>
        <div class="flex justify-between border-b border-slate-100 pb-1"><span class="font-medium">Deploy</span><span>${escapeHtml(toStackLabel("deploy", stack.deploy))}</span></div>
        <div class="flex justify-between border-b border-slate-100 pb-1"><span class="font-medium">Database</span><span>${escapeHtml(toStackLabel("database", stack.database))}</span></div>
        <div class="flex justify-between"><span class="font-medium">Backend</span><span>${escapeHtml(toStackLabel("backend", stack.backend))}</span></div>
      </div>
    </section>
  `;
}

function renderEnvironmentSignal(doctorReport) {
  const report = doctorReport && typeof doctorReport === "object" ? doctorReport : null;
  if (!report) {
    return "";
  }

  const environment = getEnvironmentStatusFromDoctor(report);
  if (environment.severity === "ready" || environment.severity === "checking") {
    return "";
  }

  const issues = Array.isArray(report.issues) ? report.issues : [];
  const topIssues = issues.slice(0, 3);
  const isBlocked = environment.severity === "blocked";
  const wrapperClass = isBlocked
    ? "mt-4 rounded-xl border border-rose-300 bg-rose-50 p-4 shadow-sm"
    : "mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm";
  const titleClass = isBlocked ? "text-rose-900" : "text-amber-900";
  const bodyClass = isBlocked ? "text-rose-800" : "text-amber-800";
  const badgeClass = isBlocked
    ? "rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-900"
    : "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900";
  const badgeText = isBlocked ? "Blocked" : "Warning";
  const issueRows = topIssues.length > 0
    ? topIssues.map((issue) => `<li>• ${escapeHtml(String(issue?.message || ""))}</li>`).join("")
    : "<li>• Review Doctor details for setup issues.</li>";

  return `
    <section class="${wrapperClass}">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-base font-semibold ${titleClass}">Environment needs attention</h2>
        <span class="${badgeClass}">${badgeText}</span>
      </div>
      <ul class="mt-2 space-y-1 text-sm ${bodyClass}">${issueRows}</ul>
    </section>
  `;
}

function operationLabel(type) {
  if (type === "deploy_preview") return "Prepared a test version";
  if (type === "deploy_production") return "Published your app";
  if (type === "add_env") return "Connected your app";
  if (type === "deploy_supabase_function") return "Connected what was missing";
  if (type === "repair_deployment") return "Tried a guided fix";
  if (type === "view_logs") return "Show details";
  return String(type || "Operation");
}

function operationMessage(op) {
  const operation = String(op?.operation || "");
  if (operation) {
    return op?.message || launchOperationLabel(operation);
  }

  const type = String(op?.type || "");
  if (type === "add_env") {
    const key = String(op?.payload?.key || "ENV_KEY");
    return `Connected your app (${key})`;
  }
  if (type === "deploy_supabase_function") {
    const fn = String(op?.payload?.functionName || op?.payload?.name || "generate");
    return `Connected what was missing (${fn})`;
  }
  return operationLabel(type);
}

function normalizeOperationStatus(status) {
  const value = String(status || "queued");
  if (value === "failed") {
    return "error";
  }
  return value;
}

function formatOperationTime(op) {
  const ts = op?.timestamp || op?.finishedAt || op?.startedAt || op?.createdAt;
  const date = new Date(ts || Date.now());
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderActivityList(operations, doctorReport) {
  const recent = Array.isArray(operations) ? [...operations].reverse().slice(0, 5) : [];
  if (recent.length === 0) {
    const environment = getEnvironmentStatusFromDoctor(doctorReport);
    const environmentLine = environment.severity === "ready"
      ? "✔ Environment ready"
      : environment.severity === "warning"
        ? "○ Environment needs attention"
        : environment.severity === "blocked"
          ? "○ Environment blocked"
          : "○ Checking environment";
    return `
      <section class="mt-8 rounded-xl bg-white p-5 shadow-sm border border-slate-200">
        <h2 class="text-lg font-semibold">Activity</h2>
        <ul class="mt-2 space-y-1 text-sm text-slate-600">
          <li>✔ Project loaded</li>
          <li>${escapeHtml(environmentLine)}</li>
          <li>○ Waiting for next command</li>
        </ul>
      </section>
    `;
  }

  const rows = recent
    .map((op) => {
      const status = normalizeOperationStatus(op?.status);
      const marker = status === "error" ? "✖" : status === "running" ? "●" : "✔";
      const details = status === "error" && op?.output
        ? `<div class="text-xs text-rose-700 mt-1">${escapeHtml(String(op.output).split(/\r?\n/)[0] || "Operation failed.")}</div>`
        : "";
      return `<li class="py-1 text-sm text-slate-700">
        <div>${marker} ${escapeHtml(operationMessage(op))}</div>
        ${details}
      </li>`;
    })
    .join("");

  return `
    <section class="mt-8 rounded-xl bg-white p-5 shadow-sm border border-slate-200">
      <h2 class="text-lg font-semibold">Activity</h2>
      <ul class="mt-2">${rows}</ul>
    </section>
  `;
}

function getDoctorSuggestionShortcut(doctorReport) {
  const environment = getEnvironmentStatusFromDoctor(doctorReport);
  if (environment.severity === "blocked") {
    return {
      kind: "doctor_shortcut",
      label: "Fix environment",
      reason: "Environment is blocked. Review Doctor fixes first.",
    };
  }
  if (environment.severity === "warning") {
    return {
      kind: "doctor_shortcut",
      label: "Open Doctor",
      reason: "Environment needs attention before shipping.",
    };
  }
  return null;
}

function getDisplaySuggestions(baseSuggestions, doctorReport) {
  const items = [];
  const normalized = Array.isArray(baseSuggestions) ? baseSuggestions : [];
  for (const item of normalized) {
    const label = String(item?.label || item?.command || item?.action || "").trim();
    const command = String(item?.command || item?.action || "").trim();
    if (!label || !command) {
      continue;
    }
    items.push({
      kind: "command",
      label,
      command,
      reason: String(item?.reason || "").trim(),
    });
  }

  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = `${String(item.label)}::${String(item.command || "")}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  const shortcut = getDoctorSuggestionShortcut(doctorReport);
  if (shortcut) {
    return [shortcut, ...deduped];
  }
  return deduped;
}

function renderAiChatExecutionPlanSection({ loading, text, steps, guidance, prodConfirmChecked, suggestions, doctorReport }) {
  const analyzeBusy = Boolean(loading.aiAnalyzeBtn);
  const runBusy = Boolean(loading.aiRunPlanBtn);
  const autoRunBusy = Boolean(loading.aiAutoRunSafeBtn);
  const quickBusy = Boolean(loading.operatorQuickLaunchBtn)
    || Boolean(loading.operatorQuickBackendBtn)
    || Boolean(loading.operatorQuickPreviewBtn)
    || Boolean(loading.operatorQuickLiveBtn);
  const hasActions = Array.isArray(steps) && steps.length > 0;
  const hasProductionDeploy = Array.isArray(steps) && steps.some((step) => String(step?.operation) === "make_app_live");
  const runDisabled = runBusy || !hasActions || (hasProductionDeploy && !prodConfirmChecked);
  const safeTypes = new Set(["prepare_preview", "show_logs"]);
  const safeOnly = hasActions && steps.every((step) => safeTypes.has(String(step?.operation)));
  const statusClass = (status) => {
    if (status === "running") return "text-blue-700";
    if (status === "success") return "text-emerald-700";
    if (status === "failed") return "text-rose-700";
    if (status === "skipped") return "text-slate-500";
    return "text-slate-500";
  };
  const statusBackgroundClass = (status) => {
    if (status === "running") return "bg-sky-50 border-sky-200";
    if (status === "success") return "bg-emerald-50 border-emerald-200";
    if (status === "failed") return "bg-rose-50 border-rose-200";
    if (status === "skipped") return "bg-slate-50 border-slate-200";
    return "bg-white/90 border-slate-200";
  };
  const actionRows = Array.isArray(steps) && steps.length > 0
    ? steps.map((step, index) =>
      `<li class="rounded-xl border p-3 ${statusBackgroundClass(step?.status)}">
        <div class="text-[11px] uppercase tracking-wide text-slate-500">Step ${index + 1}</div>
        <div class="mt-1 text-sm font-medium text-slate-800">${escapeHtml(step?.label || `Step ${index + 1}`)}</div>
        <div class="mt-1 text-[11px] uppercase tracking-wide ${statusClass(step?.status)}">Status: ${escapeHtml(step?.status || "pending")}</div>
        ${step?.status === "failed" && step?.error
          ? `<div class="mt-1 text-xs text-rose-700">${escapeHtml(String(step.error))}</div>`
          : ""}
        ${step?.status === "failed"
          ? `<div class="mt-2">
            <button id="retryPlanStepBtn-${index}" data-retry-step-index="${index}" ${loading?.[`retryPlanStepBtn-${index}`] ? "disabled" : ""} class="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 ${loading?.[`retryPlanStepBtn-${index}`] ? "opacity-60 cursor-not-allowed" : ""}">${loading?.[`retryPlanStepBtn-${index}`] ? "Retrying..." : "Retry step"}</button>
          </div>`
          : ""}
      </li>`,
    ).join("")
    : "";
  const suggestionItems = getDisplaySuggestions(suggestions, doctorReport);
  const suggestionRows = suggestionItems.length > 0
    ? suggestionItems.map((suggestion, index) => {
      const label = String(suggestion?.label || `Suggestion ${index + 1}`);
      const command = String(suggestion?.command || "").trim();
      const reason = String(suggestion?.reason || "").trim();
      const kind = String(suggestion?.kind || "command");
      return `<button
        type="button"
        id="commandSuggestionBtn-${index}"
        class="w-full rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2.5 text-left hover:bg-slate-100 transition"
        data-command-suggestion="${escapeHtml(command)}"
        data-suggestion-kind="${escapeHtml(kind)}"
      >
        <div class="text-sm font-medium text-slate-800">${escapeHtml(label)}</div>
        ${reason ? `<div class="mt-0.5 text-xs text-slate-600">${escapeHtml(reason)}</div>` : ""}
      </button>`;
    }).join("")
    : `<div class="text-xs text-slate-500">No suggestions available right now.</div>`;
  const intentRows = Array.isArray(steps) && steps.length > 0
    ? steps.map((step) => `<li>✓ ${escapeHtml(friendlyIntent(step?.action || {}))}</li>`).join("")
    : "<li>Your app is ready. Choose what you want to do next.</li>";
  const guidanceClass = guidance?.tone === "ok"
    ? "bg-emerald-100 border-emerald-300 text-emerald-900"
    : guidance?.tone === "warn"
      ? "bg-amber-100 border-amber-300 text-amber-900"
      : guidance?.tone === "hint"
        ? "bg-sky-100 border-sky-300 text-sky-900"
        : "bg-slate-100 border-slate-300 text-slate-800";

  return `
    <section class="rounded-3xl bg-gradient-to-b from-sky-50/75 to-white/90 p-6 shadow-medium border border-sky-100/70 transition-all duration-200">
      <h2 class="text-2xl font-semibold">Welcome</h2>
      <p class="text-sm text-slate-600 mt-1">What do you want to make?</p>
      <label class="text-xs font-medium mt-4 block text-slate-600">Try a goal</label>
      <div class="mt-2 flex flex-wrap gap-2.5">
        <button id="operatorQuickLaunchBtn" data-operator-command="launch SaaS" ${quickBusy ? "disabled" : ""} class="rounded-full border border-slate-200/80 bg-white/80 px-3.5 py-1.5 text-xs text-slate-700 hover:bg-white transition ${quickBusy ? "opacity-60 cursor-not-allowed" : ""}">Start my app</button>
        <button id="operatorQuickBackendBtn" data-operator-command="deploy backend" ${quickBusy ? "disabled" : ""} class="rounded-full border border-slate-200/80 bg-white/80 px-3.5 py-1.5 text-xs text-slate-700 hover:bg-white transition ${quickBusy ? "opacity-60 cursor-not-allowed" : ""}">Connect what’s missing</button>
        <button id="operatorQuickPreviewBtn" data-operator-command="deploy preview" ${quickBusy ? "disabled" : ""} class="rounded-full border border-slate-200/80 bg-white/80 px-3.5 py-1.5 text-xs text-slate-700 hover:bg-white transition ${quickBusy ? "opacity-60 cursor-not-allowed" : ""}">Make a test version</button>
        <button id="operatorQuickLiveBtn" data-operator-command="make app live" ${quickBusy ? "disabled" : ""} class="rounded-full border border-slate-200/80 bg-white/80 px-3.5 py-1.5 text-xs text-slate-700 hover:bg-white transition ${quickBusy ? "opacity-60 cursor-not-allowed" : ""}">Publish for people</button>
      </div>
      <input id="ai-analyze-input" class="mt-3 rounded-2xl border border-slate-200/80 bg-white/85 text-sm shadow-inner focus:bg-white focus:border-slate-300" style="font-size:16px;padding:12px;width:420px;" placeholder="Make a recipe app for my mom" value="${escapeHtml(text || "")}" />
      <div class="mt-2 text-xs text-slate-500">You don’t need technical words. Describe your goal.</div>
      <div class="mt-1 text-xs text-slate-500">deplo.app handles safe steps and asks before sensitive ones.</div>
      <div class="mt-4">
        <div class="text-xs font-medium text-slate-600">Helpful starters</div>
        <div class="mt-2 space-y-2">${suggestionRows}</div>
      </div>
      <div class="mt-4">
        <button id="aiAnalyzeBtn" ${analyzeBusy ? "disabled" : ""} class="rounded-full bg-slate-700 text-white px-4 py-2.5 text-sm font-medium shadow-soft hover:bg-slate-800 hover:-translate-y-0.5 transition ${analyzeBusy ? "opacity-60 cursor-not-allowed" : ""}">${analyzeBusy ? "Checking..." : "Show steps"}</button>
        <button id="aiRunPlanBtn" ${runDisabled ? "disabled" : ""} class="ml-2 rounded-full bg-emerald-700 text-white px-5 py-2.5 text-sm font-semibold shadow-medium hover:bg-emerald-800 hover:-translate-y-0.5 transition ${runDisabled ? "opacity-60 cursor-not-allowed" : ""}">${runBusy ? "Starting..." : "Start guided steps"}</button>
      </div>
      ${hasProductionDeploy
        ? `<div class="mt-3 rounded-lg border border-amber-300 bg-amber-100 p-3 text-amber-900">
          <div class="text-sm font-semibold">Publishing for people affects your live app. Please confirm.</div>
          <label class="mt-2 flex items-center gap-2 text-sm">
            <input id="prodConfirmCheckbox" type="checkbox" ${prodConfirmChecked ? "checked" : ""} />
            <span>I confirm publishing</span>
          </label>
        </div>`
        : ""}
      ${safeOnly
        ? `<div class="mt-3 rounded-xl border border-emerald-300 bg-emerald-100 p-3 text-emerald-900">
          <div class="text-sm font-semibold">Safe to run automatically</div>
          <button id="aiAutoRunSafeBtn" ${autoRunBusy ? "disabled" : ""} class="mt-2 rounded-full bg-emerald-700 text-white px-3.5 py-2 text-sm font-medium shadow-sm ${autoRunBusy ? "opacity-60 cursor-not-allowed" : ""}">${autoRunBusy ? "Running..." : "Auto-run safe actions"}</button>
        </div>`
        : ""}
      ${hasActions
        ? `<div class="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3">
          <div class="text-sm font-semibold text-slate-800">What deplo.app will do</div>
          <ul class="mt-1 text-sm text-slate-700 space-y-1">${intentRows}</ul>
        </div>
        <div class="mt-3">
          <div class="rounded-lg border p-3 ${guidanceClass}">
            <div class="text-sm font-semibold">${escapeHtml(guidance?.label || "Ready to run")}</div>
            <div class="text-sm mt-1">${escapeHtml(guidance?.message || "")}</div>
          </div>
        </div>`
        : '<p class="mt-3 text-sm text-slate-600">Paste instructions from AI to run tasks automatically.</p>'}
      ${hasActions
        ? `<div class="mt-3">
          <div class="text-sm font-semibold text-slate-800">What will happen next</div>
          <ol class="mt-2 space-y-2">${actionRows}</ol>
        </div>`
        : ""}
    </section>
  `;
}

function computeExecutionPlanGuidance(text, actions, status) {
  const raw = String(text || "");
  const normalized = raw.toLowerCase().replace(/\s+/g, " ").trim();
  const detectedActions = Array.isArray(actions) ? actions : [];
  const hasActions = detectedActions.length > 0;

  const hasAddEnvPhrase = /\badd\s+env\b/.test(normalized) || /\bset\s+environment\s+variable\b/.test(normalized);
  const hasEnvKey = /\b(?:add\s+env|set\s+environment\s+variable)\s+[A-Z][A-Z0-9_]*\b/i.test(raw);
  const hasSupabasePhrase = /\bdeploy(?:\s+the)?\s+supabase\s+function\b/.test(normalized);
  const hasSupabaseName = /\bdeploy(?:\s+the)?\s+supabase\s+function\s+[a-z0-9_-]+\b/i.test(raw);

  if ((hasAddEnvPhrase && !hasEnvKey) || (hasSupabasePhrase && !hasSupabaseName)) {
    const details = [];
    if (hasAddEnvPhrase && !hasEnvKey) {
      details.push("Add the missing connection name.");
    }
    if (hasSupabasePhrase && !hasSupabaseName) {
      details.push("Add the missing feature name.");
    }
    return {
      label: "Missing information",
      tone: "warn",
      message: details.join(" "),
    };
  }

  if (hasActions) {
    return {
      label: "Ready to run",
      tone: "ok",
      message: `Found ${detectedActions.length} step${detectedActions.length === 1 ? "" : "s"} ready to start.`,
    };
  }

  return {
    label: "No steps detected",
    tone: "neutral",
    message: "Describe your idea in one sentence, for example: Make a recipe app for my mom.",
  };
}

function App() {
  const [status, setStatus] = useState({
    project: {
      name: "",
      root: "",
    },
    git: {
      branch: null,
    },
    vercel: {
      connected: false,
      lastDeployUrl: null,
      lastDeployAt: null,
    },
    stack: {
      framework: null,
      deploy: null,
      database: null,
      backend: null,
    },
    supabase: {
      connected: false,
      projectRef: null,
      functions: [],
    },
    env: {
      knownKeys: [],
    },
    activity: {
      lastAction: null,
      lastActionAt: null,
    },
    lastErrorJson: null,
    repairPrompt: null,
    repairHistory: null,
    lastDeployLog: null,
    lastApplyPatchLog: null,
  });
  const [capabilities, setCapabilities] = useState({
    deploy_preview: true,
    deploy_production: true,
    env_management: true,
    logs: true,
    repair_loop: true,
    supabase_functions: true,
    database_migrations: false,
  });
  const [suggestions, setSuggestions] = useState([]);
  const [doctorReport, setDoctorReport] = useState(null);
  const [operations, setOperations] = useState([]);
  const [chatText, setChatText] = useState("");
  const [chatActions, setChatActions] = useState([]);
  const [chatEmptyMessage, setChatEmptyMessage] = useState("");
  const [executionPlan, setExecutionPlan] = useState({
    rawInput: "",
    actions: [],
    steps: [],
    analyzedAt: null,
  });
  const [prodConfirmChecked, setProdConfirmChecked] = useState(false);
  const [commandText, setCommandText] = useState("");
  const [commandFocused, setCommandFocused] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [output, setOutput] = useState("Ready");
  const [loading, setLoading] = useState({});
  const [resultBanner, setResultBanner] = useState(null);
  const [launchProgress, setLaunchProgress] = useState("");
  const [launchStepStates, setLaunchStepStates] = useState({});
  const [launchStateOverrides, setLaunchStateOverrides] = useState({});
  const [activityLog, setActivityLog] = useState([]);
  const [expandedTimelineIds, setExpandedTimelineIds] = useState(new Set());
  const operationStatusRef = useRef({});
  const launchState = mergeLaunchState(getLaunchState(status), launchStateOverrides);

  async function loadStatus() {
    const response = await fetch("/api/status");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Failed to load status");
    }
    setStatus(data);
  }

  async function loadSuggestions() {
    const response = await fetch("/api/suggestions");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Failed to load suggestions");
    }
    if (Array.isArray(data)) {
      setSuggestions(data);
      return;
    }
    setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
  }

  async function loadCapabilities() {
    const response = await fetch("/api/capabilities");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Failed to load capabilities");
    }
    setCapabilities(data || {});
  }

  async function loadDoctorReport() {
    const response = await fetch("/api/doctor");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Failed to load doctor report");
    }
    setDoctorReport(data || null);
  }

  async function loadOperations() {
    const response = await fetch("/api/queue");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Failed to load operations");
    }
    const jobs = Array.isArray(data) ? data : [];
    const previous = operationStatusRef.current;
    const next = {};
    const newlyFinished = [];

    for (const job of jobs) {
      const id = String(job.id || "");
      if (!id) {
        continue;
      }
      const status = String(job.status || "");
      next[id] = status;
      const was = previous[id];
      const isTerminal = status === "success" || status === "failed";
      if (isTerminal && was !== status) {
        newlyFinished.push(job);
      }
    }

    operationStatusRef.current = next;
    setOperations(jobs);

    if (newlyFinished.length > 0) {
      const lines = newlyFinished.flatMap((job) => {
        const header = `[${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}] ${job.type} (${job.status})`;
        const body = String(job.output || "").trim();
        return body ? [header, body, ""] : [header, ""];
      });
      setOutput((prev) => {
        const chunk = lines.join("\n").trim();
        return chunk ? `${prev}\n\n${chunk}` : prev;
      });

      const deployFinished = newlyFinished.some((job) =>
        (job.type === "deploy_preview" || job.type === "deploy_production") && job.status === "success"
      );
      if (deployFinished) {
        void loadStatus();
      }
    }
  }

  useEffect(() => {
    Promise.all([loadStatus(), loadSuggestions(), loadCapabilities(), loadDoctorReport()]).catch((error) => setOutput(error.message));
    const timer = setInterval(() => {
      Promise.all([loadStatus(), loadSuggestions(), loadCapabilities(), loadDoctorReport()]).catch(() => {
        // keep previous status when polling fails
      });
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    loadOperations().catch(() => {
      // Keep previous operations list when polling fails.
    });
    const timer = setInterval(() => {
      loadOperations().catch(() => {
        // Keep previous operations list when polling fails.
      });
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const outputPanel = document.getElementById("outputPanel");
    if (outputPanel) {
      outputPanel.scrollTop = outputPanel.scrollHeight;
    }
  }, [output]);

  useEffect(() => {
    const root = document.getElementById("appBody");
    if (!root) {
      return;
    }

    let blurTimer = null;
    const onFocusIn = (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.id === "ai-analyze-input") {
        if (blurTimer) {
          clearTimeout(blurTimer);
          blurTimer = null;
        }
        setCommandFocused(true);
      }
    };
    const onFocusOut = () => {
      blurTimer = setTimeout(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || active.id !== "ai-analyze-input") {
          setCommandFocused(false);
        }
      }, 80);
    };

    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    return () => {
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      if (blurTimer) {
        clearTimeout(blurTimer);
      }
    };
  }, []);

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function firstNonEmptyLine(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

function markAction(label, outcome, details) {
  const time = nowTime();
  const defaultMessage = `${label} ${outcome === "success" ? "completed" : "failed"}`;
  const fixMessage = outcome === "success" && label === "Fix environment"
    ? firstNonEmptyLine(details)
    : "";
  setResultBanner({
    type: outcome,
    message: fixMessage || defaultMessage,
    time,
  });
  if (details) {
    setOutput(details);
  }
  }

  async function runAction(buttonId, label, work) {
    if (loading[buttonId]) {
      return;
    }

    setLoading((prev) => ({ ...prev, [buttonId]: true }));
    try {
      const result = await work();
      markAction(label, "success", result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Action failed";
      markAction(label, "error", message);
    } finally {
      setLoading((prev) => ({ ...prev, [buttonId]: false }));
    }
  }

  async function postJson(url, payload = {}) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      const details = data?.result
        ? [data.result.stdout, data.result.stderr].filter(Boolean).join("\n")
        : data?.message || "Action failed";
      throw new Error(details || "Action failed");
    }
    return data;
  }

  function formatActionResult(data, fallback = "Done") {
    if (!data || typeof data !== "object") {
      return fallback;
    }
    if (data.result && typeof data.result === "object") {
      const stdout = String(data.result.stdout || "");
      const stderr = String(data.result.stderr || "");
      const combined = [stdout, stderr].filter(Boolean).join("\n");
      if (combined) {
        return combined;
      }
    }
    if (data.output && typeof data.output === "string") {
      return data.output;
    }
    if (data.message && typeof data.message === "string") {
      return data.jobId ? `${data.message} (${data.jobId})` : data.message;
    }
    if (Array.isArray(data.jobIds) && data.jobIds.length > 0) {
      return `Jobs queued: ${data.jobIds.join(", ")}`;
    }
    return fallback;
  }

  async function waitForQueuedJobs(jobIds, timeoutMs = 180000) {
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return { ok: true, message: "No jobs queued." };
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const response = await fetch("/api/queue");
      const queue = await response.json();
      const jobs = Array.isArray(queue) ? queue : [];
      const tracked = jobIds.map((id) => jobs.find((job) => String(job?.id) === String(id))).filter(Boolean);
      if (tracked.length === jobIds.length) {
        const allDone = tracked.every((job) => job.status === "success" || job.status === "failed");
        if (allDone) {
          const failed = tracked.find((job) => job.status === "failed");
          if (failed) {
            return {
              ok: false,
              message: String(failed.output || "A launch step failed."),
            };
          }
          return { ok: true, message: "All jobs completed." };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return { ok: false, message: "Timed out waiting for launch steps to finish." };
  }

  function createActivityEntry(operation, status, message, error) {
    const entry = {
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      operation,
      status,
      message,
      ...(error ? { error } : {}),
    };
    setActivityLog((prev) => [entry, ...prev].slice(0, 100));
    return entry.id;
  }

  function updateActivityEntry(id, status, message, error, jobIds) {
    setActivityLog((prev) =>
      prev.map((entry) => {
        if (entry.id !== id) {
          return entry;
        }
        return {
          ...entry,
          status,
          message,
          timestamp: new Date().toISOString(),
          ...(error ? { error } : {}),
          ...(jobIds ? { jobIds } : {}),
        };
      }),
    );
  }

  function setPlanStepStatus(index, status, error = null) {
    setExecutionPlan((prev) => {
      const steps = Array.isArray(prev.steps) ? [...prev.steps] : [];
      if (!steps[index]) {
        return prev;
      }
      steps[index] = { ...steps[index], status, error };
      return { ...prev, steps };
    });
  }

  function markLaunchStateSuccess(operation) {
    if (operation === "connect_database") {
      setLaunchStateOverrides((prev) => ({ ...prev, databaseConnected: true }));
      return;
    }
    if (operation === "deploy_backend_functions") {
      setLaunchStateOverrides((prev) => ({ ...prev, backendDeployed: true }));
      return;
    }
    if (operation === "prepare_preview") {
      setLaunchStateOverrides((prev) => ({ ...prev, previewReady: true }));
      return;
    }
    if (operation === "make_app_live") {
      setLaunchStateOverrides((prev) => ({ ...prev, appLive: true }));
    }
  }

  function actionsContainProduction(actions) {
    return Array.isArray(actions) && actions.some((action) => {
      const type = String(action?.type || "");
      return type === "make_app_live";
    });
  }

  async function dispatchCoreAction(action, payload = {}) {
    return postJson("/api/actions/dispatch", { action, payload });
  }

  async function queueAction(action) {
    const type = String(action?.type || "");
    if (type === "prepare_preview") {
      return dispatchCoreAction("deploy_preview");
    }
    if (type === "make_app_live") {
      if (launchState?.deployToProduction !== true) {
        return {
          skipped: true,
          message: "Production deploy not enabled.",
        };
      }
      return dispatchCoreAction("make_app_live", { confirm: true });
    }
    if (type === "deploy_backend_functions") {
      const functionName = String(action?.name || "generate").trim() || "generate";
      const projectRef = String(status?.supabase?.projectRef || "").trim();
      return dispatchCoreAction("deploy_backend", {
        functionName,
        projectRef,
      });
    }
    if (type === "connect_database") {
      const valueInput = window.prompt("Database connection string (DATABASE_URL):", "");
      const value = (valueInput || "").trim();
      if (!value) {
        throw new Error("Canceled: DATABASE_URL is required.");
      }
      return dispatchCoreAction("connect_database", {
        value,
        target: "preview",
      });
    }
    if (type === "deploy_supabase_function") {
      const functionName = String(action?.name || "generate").trim() || "generate";
      const projectRef = String(status?.supabase?.projectRef || "").trim();
      if (projectRef) {
        return postJson("/api/do/execute", {
          instruction: `deploy supabase function ${functionName} --project-ref ${projectRef}`,
        });
      }
      return postJson("/api/do/execute", {
        instruction: `deploy supabase function ${functionName}`,
      });
    }
    if (type === "env_add") {
      const key = String(action?.key || "").trim().toUpperCase();
      if (!key) {
        throw new Error("Missing env key.");
      }
      const valueInput = window.prompt(`Value for ${key}:`, "");
      const value = valueInput || "";
      if (!value) {
        throw new Error(`Canceled: ${key} value is required.`);
      }
      return postJson("/api/env/add", {
        key,
        value,
        target: "preview",
      });
    }
    if (type === "run_repair") {
      return postJson("/api/repair/apply-redeploy");
    }
    if (type === "show_logs") {
      return postJson("/api/do/execute", { instruction: "view logs" });
    }
    throw new Error(`Unsupported plan action: ${type}`);
  }

  async function runOperationHandler(action) {
    const operation = normalizeLaunchOperation(action);
    const label = launchOperationLabel(operation);
    const entryId = createActivityEntry(operation, "queued", `${label} queued`);
    updateActivityEntry(entryId, "running", `${label} running`);

    try {
      const queued = await queueAction(action);
      if (queued?.skipped) {
        const skippedMessage = String(queued?.message || "Step skipped.");
        updateActivityEntry(entryId, "skipped", skippedMessage);
        return { jobIds: [], operation, skipped: true };
      }
      const jobIds = Array.isArray(queued?.jobIds)
        ? queued.jobIds
        : queued?.jobId
          ? [queued.jobId]
          : [];

      if (jobIds.length > 0) {
        updateActivityEntry(entryId, "running", `${label} running`, undefined, jobIds);
        const result = await waitForQueuedJobs(jobIds);
        if (!result.ok) {
          throw new Error(result.message || `${label} failed`);
        }
      }

      markLaunchStateSuccess(operation);
      updateActivityEntry(entryId, "success", `${label} completed`);
      return { jobIds, operation };
    } catch (error) {
      const message = error instanceof Error ? error.message : `${label} failed`;
      updateActivityEntry(entryId, "error", `${label} failed`, message);
      throw error;
    }
  }

  async function analyzeOperatorInput(text) {
    const normalized = String(text || "").trim();
    setExecutionPlan({ rawInput: text, actions: [], steps: [], analyzedAt: new Date().toISOString() });
    setProdConfirmChecked(false);
    if (!normalized) {
      return "Please paste AI chat text first.";
    }

    const data = await postJson("/api/ai/detect", { text });
    const actions = Array.isArray(data.actions) ? data.actions : [];
    const stack = data?.stack && typeof data.stack === "object" ? data.stack : null;
    if (stack) {
      const stackLines = [
        "Detected stack:",
        `framework: ${String(stack.framework ?? "null")}`,
        `deploy: ${String(stack.deploy ?? "null")}`,
        `database: ${String(stack.database ?? "null")}`,
        `backend: ${String(stack.backend ?? "null")}`,
      ];
      createActivityEntry("stack_detect", "success", stackLines.join("\n"));
    }
    setExecutionPlan({
      rawInput: text,
      actions,
      steps: createPlanSteps(actions),
      analyzedAt: new Date().toISOString(),
    });
    if (actions.length === 0) {
      return "No actions detected.";
    }
    return [
      "Execution Plan",
      ...actions.map((action, index) => `Step ${index + 1}: ${humanActionLabel(action)}`),
    ].join("\n");
  }

  async function executePlanActionsSequential(actions, options = {}) {
    const queuedJobIds = [];
    const lines = [];
    const completion = createCompletionSnapshot(launchState);
    const shouldTrackPlan = !options?.skipPlanStatus;
    const startIndex = Number.isInteger(options?.startIndex) ? Math.max(0, options.startIndex) : 0;

    const markCompleted = (operation) => {
      if (operation === "connect_database") completion.connect_database = true;
      if (operation === "deploy_backend_functions") completion.deploy_backend_functions = true;
      if (operation === "prepare_preview") completion.prepare_preview = true;
      if (operation === "make_app_live") completion.make_app_live = true;
    };

    const alreadyCompleted = (operation) => {
      if (operation === "connect_database") return completion.connect_database;
      if (operation === "deploy_backend_functions") return completion.deploy_backend_functions;
      if (operation === "prepare_preview") return completion.prepare_preview;
      if (operation === "make_app_live") return completion.make_app_live;
      return false;
    };

    for (let i = startIndex; i < actions.length; i += 1) {
      const action = actions[i];
      const label = formatExecutionAction(action);
      const operation = normalizeLaunchOperation(action);
      if (shouldTrackPlan) {
        setPlanStepStatus(i, "pending", null);
      }
      if (!options?.silentProgress) {
        setLaunchProgress(`Running: ${label}`);
      }
      lines.push(`Step ${i + 1}/${actions.length}: ${label}`);
      if (alreadyCompleted(operation)) {
        const backendNotRequired = operation === "deploy_backend_functions" && status?.supabase?.functionsRequired === false;
        if (backendNotRequired) {
          createActivityEntry(operation, "skipped", "No Supabase functions found in this project. Skipping backend deployment.");
        } else {
          createActivityEntry(operation, "success", `${launchOperationLabel(operation)} already completed`);
        }
        if (shouldTrackPlan) {
          setPlanStepStatus(i, "skipped", null);
        }
        lines.push(
          backendNotRequired
            ? "↷ skipped deploy backend functions (not required for this project)"
            : `↷ skipped ${label} (already complete)`,
        );
        continue;
      }
      if (shouldTrackPlan) {
        setPlanStepStatus(i, "running", null);
      }
      try {
        const result = await runOperationHandler(action);
        const jobIds = Array.isArray(result?.jobIds) ? result.jobIds : [];
        queuedJobIds.push(...jobIds);
        if (!result?.skipped) {
          markCompleted(result?.operation || operation);
        }
        if (shouldTrackPlan) {
          setPlanStepStatus(i, result?.skipped ? "skipped" : "success", null);
        }
        lines.push(result?.skipped ? `↷ skipped ${label}` : `✓ ${label}`);
        await loadOperations();
        await loadStatus();
        await loadSuggestions();
      } catch (error) {
        if (shouldTrackPlan) {
          const message = error instanceof Error ? error.message : `${label} failed`;
          setPlanStepStatus(i, "failed", message);
        }
        throw error;
      }
    }

    if (!options?.silentProgress) {
      setLaunchProgress("");
    }
    return {
      jobIds: queuedJobIds,
      output: lines.join("\n"),
    };
  }

  useEffect(() => {
    const root = document.getElementById("appBody");
    if (!root) {
      return;
    }

    async function handleClick(event) {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.id) {
        return;
      }

      const openDoctorSection = () => {
        const advanced = document.getElementById("advancedSection");
        if (advanced instanceof HTMLDetailsElement) {
          advanced.open = true;
        }
        const doctorEl = document.getElementById("doctor-section");
        if (doctorEl instanceof HTMLElement) {
          doctorEl.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      };

      try {
        // Timeline log expand/collapse toggle
        const timelineToggleId = target.dataset?.timelineToggle;
        if (timelineToggleId) {
          setExpandedTimelineIds((prev) => {
            const next = new Set(prev);
            if (next.has(timelineToggleId)) {
              next.delete(timelineToggleId);
            } else {
              next.add(timelineToggleId);
            }
            return next;
          });
          return;
        }

        const suggestion = target.dataset?.commandSuggestion;
        const suggestionKind = String(target.dataset?.suggestionKind || "");
        if (suggestionKind === "doctor_shortcut") {
          openDoctorSection();
          return;
        }
        if (suggestion) {
          const inputEl = document.getElementById("ai-analyze-input");
          if (inputEl instanceof HTMLInputElement) {
            inputEl.value = suggestion;
            inputEl.focus();
          }
          setExecutionPlan((prev) => ({ ...prev, rawInput: suggestion }));
          setCommandText(suggestion);
          setCommandFocused(false);
          return;
        }

        const copyText = String(target.dataset?.copyText || "");
        if (copyText) {
          await navigator.clipboard.writeText(copyText);
          setOutput(`Copied command: ${copyText}`);
          return;
        }

        const doctorActionId = String(target.dataset?.doctorActionId || "");
        if (doctorActionId) {
          await runAction(`doctor-fix-${doctorActionId}`, "Doctor fix", async () => {
            const data = await postJson("/api/doctor/fix", { actionId: doctorActionId });
            if (data?.report) {
              setDoctorReport(data.report);
            } else {
              await loadDoctorReport();
            }
            await loadStatus();
            return String(data?.message || "Fix completed");
          });
          return;
        }

        if (target.id === "openDoctorBtn") {
          openDoctorSection();
          return;
        }

        if (target.id === "commandCenterRunBtn") {
          await runAction("commandCenterRunBtn", "Run command", async () => {
            const inputEl = document.getElementById("command-center-input");
            const text = inputEl instanceof HTMLInputElement ? inputEl.value.trim() : "";
            setCommandText(text);
            if (!text) {
              return "Please enter a command first.";
            }

            const result = await postJson("/api/ai/import", { text });
            const parsed = Array.isArray(result.actions)
              ? result.actions.map((item) => formatExecutionAction(item))
              : [];
            setChatActions(parsed);
            setChatText(text);
            setChatEmptyMessage(parsed.length === 0 ? "No runnable actions detected." : "");
            await loadOperations();
            await loadStatus();
            return parsed.length > 0
              ? `Detected actions:\n${parsed.join("\n")}\n\nJobs queued: ${result.jobsQueued}`
              : "No runnable actions detected. Try: deploy preview, add env KEY=value, deploy supabase function NAME";
          });
          return;
        }

        const quickCommand = String(target.dataset?.operatorCommand || "").trim();
        if (quickCommand) {
          await runAction(target.id, "Analyze", async () => analyzeOperatorInput(quickCommand));
          return;
        }

        if (target.id === "aiAnalyzeBtn") {
          await runAction("aiAnalyzeBtn", "Analyze", async () => {
            const inputEl = document.getElementById("ai-analyze-input");
            const text = inputEl instanceof HTMLInputElement || inputEl instanceof HTMLTextAreaElement ? inputEl.value : "";
            return analyzeOperatorInput(text);
          });
          return;
        }

        const founderStepHandlers = {
          founderConnectDbBtn: () => ({ type: "connect_database" }),
          founderDeployFunctionsBtn: () => ({ type: "deploy_backend_functions" }),
          founderPreviewBtn: () => ({ type: "prepare_preview" }),
          founderLiveBtn: () => ({ type: "make_app_live" }),
        };
        const stepHandler = founderStepHandlers[target.id];
        if (stepHandler) {
          const instruction = String(target.dataset?.stepInstruction || "").trim();
          const confirmType = String(target.dataset?.stepConfirm || "").trim();
          await runAction(target.id, "Checklist action", async () => {
            if (!instruction) {
              return "Missing checklist instruction.";
            }
            if (confirmType === "production") {
              const approved = window.confirm("This will trigger production deployment. Continue?");
              if (!approved) {
                return "Canceled by user.";
              }
            }
            const planAction = stepHandler();
            await executePlanActionsSequential([planAction], { silentProgress: true });
            return [
              "Running checklist action",
              `Instruction: ${instruction}`,
              "",
              "Queued and completed successfully.",
            ].join("\n");
          });
          return;
        }

        if (target.id === "founderLaunchAppBtn") {
          const nextAction = getPrimaryNextActionState(doctorReport);
          await runAction("founderLaunchAppBtn", nextAction.buttonLabel, async () => {
            if (nextAction.mode === "setup_open") {
              openDoctorSection();
              setLaunchProgress("");
              return `${nextAction.buttonLabel}: review Doctor checks first.`;
            }
            if (nextAction.mode === "setup_fix") {
              const beforeReport = doctorReport && typeof doctorReport === "object" ? doctorReport : null;
              const autofixActions = getDoctorAutofixActions(beforeReport);
              if (autofixActions.length === 0) {
                openDoctorSection();
                setLaunchProgress("");
                return [
                  "No safe fix available",
                  "Review Doctor actions",
                ].join("\n");
              }

              const beforeIssues = Array.isArray(beforeReport?.issues) ? beforeReport.issues.length : 0;
              setLaunchProgress("Applying safe environment fixes...");
              let latestReport = beforeReport;
              for (const action of autofixActions) {
                const actionId = String(action?.id || "").trim();
                if (!actionId) {
                  continue;
                }
                const data = await postJson("/api/doctor/fix", { actionId });
                if (data?.report && typeof data.report === "object") {
                  latestReport = data.report;
                  setDoctorReport(data.report);
                }
              }

              await Promise.all([loadDoctorReport(), loadStatus(), loadSuggestions()]);
              setLaunchProgress("");

              const afterIssues = Array.isArray(latestReport?.issues) ? latestReport.issues.length : beforeIssues;
              const fixedCount = Math.max(0, beforeIssues - afterIssues);
              const manualRemaining = Array.isArray(latestReport?.actions)
                ? latestReport.actions.filter((item) => String(item?.type || "") === "manual").length
                : 0;
              const finalOverall = String(latestReport?.overall || "").toLowerCase();
              if (finalOverall === "ready" || (afterIssues === 0 && manualRemaining === 0)) {
                return [
                  "Environment fixed",
                  "All setup issues resolved",
                ].join("\n");
              }
              return [
                `${Math.max(1, autofixActions.length)} safe fix applied`,
                "Environment rechecked",
                manualRemaining > 0
                  ? "Manual action still needed"
                  : `${fixedCount} issue fixed`,
              ].join("\n");
            }

            const steps = getLaunchChecklist(launchState);
            const pending = steps.filter((step) => !step.done);
            if (pending.length === 0) {
              setLaunchProgress("");
              return "Your app is already fully launched.";
            }

            const needsProductionConfirm = pending.some((step) => step.requiresConfirm);
            if (needsProductionConfirm) {
              const approved = window.confirm("Final step includes production deploy. Continue?");
              if (!approved) {
                setLaunchProgress("");
                return "Canceled by user.";
              }
            }

            const initialStates = {};
            for (const step of steps) {
              initialStates[step.id] = step.done ? "completed" : "pending";
            }
            setLaunchStepStates(initialStates);

            for (const step of pending) {
              setLaunchStepStates((prev) => ({ ...prev, [step.id]: "running" }));
              setLaunchProgress(`Running: ${step.label}`);
              const stepAction = checklistActionFromStepId(step.id);
              if (!stepAction) {
                throw new Error(`Unsupported checklist step: ${step.id}`);
              }
              try {
                await executePlanActionsSequential([stepAction], { silentProgress: true });
                setLaunchStepStates((prev) => ({ ...prev, [step.id]: "completed" }));
              } catch (error) {
                setLaunchStepStates((prev) => ({ ...prev, [step.id]: "pending" }));
                setLaunchProgress(`Stopped: ${step.label}`);
                throw error;
              }
            }

            setLaunchProgress("Launch sequence complete.");
            setLaunchStepStates({});
            return "Launch sequence complete.";
          });
          return;
        }

        const shortcutMap = {
          shortcutLiveBtn: "deploy production",
          shortcutPreviewBtn: "deploy preview",
          shortcutDbBtn: "add env DATABASE_URL",
          shortcutFunctionsBtn: "deploy supabase function generate",
          shortcutFixBtn: "run repair",
        };
        const shortcutInstruction = shortcutMap[target.id];
        if (shortcutInstruction) {
          await runAction(target.id, "Analyze shortcut", async () => {
            return analyzeOperatorInput(shortcutInstruction);
          });
          return;
        }

        if (target.id === "aiRunPlanBtn") {
          await runAction("aiRunPlanBtn", "Run plan", async () => {
            const inputEl = document.getElementById("ai-analyze-input");
            const text = inputEl instanceof HTMLInputElement || inputEl instanceof HTMLTextAreaElement ? inputEl.value.trim() : "";
            if (!text) {
              return "Please paste AI chat text first.";
            }
            if (!Array.isArray(executionPlan.actions) || executionPlan.actions.length === 0) {
              return "No detected actions to run. Click Analyze first.";
            }

            const hasProdDeploy = actionsContainProduction(executionPlan.actions);
            if (hasProdDeploy && !prodConfirmChecked) {
              return "Please confirm production deployment first.";
            }

            setExecutionPlan((prev) => ({ ...prev, steps: createPlanSteps(prev.actions) }));
            const result = await executePlanActionsSequential(executionPlan.actions, { silentProgress: true });
            return [
              "Running plan",
              ...executionPlan.actions.map((action, index) => `${index + 1}. ${formatExecutionAction(action)}`),
              "",
              `Jobs queued: ${result.jobIds.length}`,
            ].join("\n");
          });
          return;
        }

        if (target.id === "aiAutoRunSafeBtn") {
          await runAction("aiAutoRunSafeBtn", "Auto-run safe actions", async () => {
            const text = executionPlan.rawInput.trim();
            if (!text) {
              return "Please paste AI chat text first.";
            }
            if (!Array.isArray(executionPlan.actions) || executionPlan.actions.length === 0) {
              return "No detected actions to run. Click Analyze first.";
            }
            const safeTypes = new Set(["prepare_preview", "show_logs"]);
            const safeOnly = executionPlan.actions.every((action) => safeTypes.has(String(action?.type)));
            if (!safeOnly) {
              return "Auto-run only supports safe plans (deploy preview, show logs).";
            }

            setExecutionPlan((prev) => ({ ...prev, steps: createPlanSteps(prev.actions) }));
            const result = await executePlanActionsSequential(executionPlan.actions, { silentProgress: true });
            return [
              "Running safe actions",
              ...executionPlan.actions.map((action, index) => `${index + 1}. ${formatExecutionAction(action)}`),
              "",
              `Jobs queued: ${result.jobIds.length}`,
            ].join("\n");
          });
          return;
        }

        const retryStepIndexRaw = target.dataset?.retryStepIndex;
        if (retryStepIndexRaw !== undefined) {
          const retryIndex = Number.parseInt(String(retryStepIndexRaw), 10);
          if (!Number.isInteger(retryIndex) || retryIndex < 0) {
            return;
          }
          const retryButtonId = `retryPlanStepBtn-${retryIndex}`;
          await runAction(retryButtonId, "Retry step", async () => {
            const steps = Array.isArray(executionPlan.steps) ? executionPlan.steps : [];
            const retryStep = steps[retryIndex];
            if (!retryStep) {
              return "Step not found.";
            }
            if (retryStep.status !== "failed") {
              return "Only failed steps can be retried.";
            }

            setPlanStepStatus(retryIndex, "running", null);
            try {
              await runOperationHandler(retryStep.action);
              setPlanStepStatus(retryIndex, "success", null);
              const resumeResult = await executePlanActionsSequential(executionPlan.actions, {
                silentProgress: true,
                startIndex: retryIndex + 1,
              });
              return [
                `Retried step ${retryIndex + 1}: ${retryStep.label}`,
                "Retry successful.",
                `Resumed remaining steps. Jobs queued: ${resumeResult.jobIds.length}`,
              ].join("\n");
            } catch (error) {
              const message = error instanceof Error ? error.message : `${retryStep.label} failed`;
              setPlanStepStatus(retryIndex, "failed", message);
              throw error;
            }
          });
          return;
        }

        if (target.id === "prodConfirmCheckbox") {
          const input = target;
          if (input instanceof HTMLInputElement) {
            setProdConfirmChecked(input.checked);
            setLaunchStateOverrides((prev) => ({ ...prev, deployToProduction: input.checked }));
          }
          return;
        }

        if (target.id === "heroFixBtn") {
          await runAction("heroFixBtn", "Fix with AI", async () => {
            const data = await postJson("/api/repair/apply-redeploy");
            await loadStatus();
            await loadSuggestions();
            return formatActionResult(data, "Job queued");
          });
          return;
        }

        if (target.id === "heroLogsBtn") {
          await runAction("heroLogsBtn", "View logs", async () => {
            const data = await postJson("/api/do/execute", { instruction: "view logs" });
            return formatActionResult(data, "Job queued");
          });
          return;
        }

        if (target.id === "previewPlanBtn") {
          const instructionEl = document.getElementById("instruction-input");
          const text = instructionEl instanceof HTMLTextAreaElement ? instructionEl.value.trim() : "";
          console.log("Instruction value:", text);
          if (!text) {
            setOutput("Please enter an instruction first.");
            return;
          }
          await runAction("previewPlanBtn", "Preview plan", async () => {
            setInstruction(text);
            const data = await postJson("/api/do/preview", { instruction: text });
            await loadSuggestions();
            return formatActionResult(data);
          });
          return;
        }

        if (target.id === "extractActionsBtn") {
          await runAction("extractActionsBtn", "Extract actions", async () => {
            const chatEl = document.getElementById("chat-import-input");
            const text = chatEl instanceof HTMLTextAreaElement ? chatEl.value : "";
            const normalized = text.trim();
            setChatText(text);
            if (!normalized) {
              setChatActions([]);
              setChatEmptyMessage("No runnable actions detected.");
              return "Please paste AI chat text first.";
            }

            const result = await postJson("/api/ai/detect", { text });
            const parsed = Array.isArray(result.actions)
              ? result.actions.map((item) => formatExecutionAction(item))
              : [];
            setChatActions(parsed);
            if (parsed.length === 0) {
              setChatEmptyMessage("No runnable actions detected.");
              return "No runnable actions detected.";
            }
            setChatEmptyMessage("");
            return [
              `Detected actions: ${result.actionsDetected ?? parsed.length}`,
              parsed.join("\n"),
            ].join("\n");
          });
          return;
        }

        if (target.id === "autoModeBtn") {
          await runAction("autoModeBtn", "Auto mode", async () => {
            setOutput("Running auto mode...");
            const data = await postJson("/api/auto/run");
            await loadStatus();
            await loadSuggestions();
            const executedLines = data.executed && data.executed.length > 0
              ? data.executed.map((item) => `- ${item}`).join("\n")
              : "- none";
            const skippedLines = data.skipped && data.skipped.length > 0
              ? data.skipped.map((item) => `- ${item}`).join("\n")
              : "- none";
            return [
              "Running auto mode...",
              "",
              "Executed:",
              executedLines,
              "",
              "Skipped:",
              skippedLines,
            ].join("\n");
          });
          return;
        }

        if (target.id === "executeInstructionBtn") {
          const instructionEl = document.getElementById("instruction-input");
          const text = instructionEl instanceof HTMLTextAreaElement ? instructionEl.value.trim() : "";
          console.log("Instruction value:", text);
          if (!text) {
            setOutput("Please enter an instruction first.");
            return;
          }
          await runAction("executeInstructionBtn", "Execute instruction", async () => {
            setInstruction(text);
            const data = await postJson("/api/do/execute", { instruction: text });
            await loadStatus();
            await loadSuggestions();
            return formatActionResult(data, "Job queued");
          });
          return;
        }

        if (target.id === "copyPromptBtn") {
          await runAction("copyPromptBtn", "Copy prompt", async () => {
            if (!status.repairPrompt) {
              throw new Error("No repair prompt found.");
            }
            await navigator.clipboard.writeText(status.repairPrompt);
            return "Copied repair prompt.";
          });
          return;
        }

        if (target.id === "pastePatchBtn") {
          await runAction("pastePatchBtn", "Paste patch", async () => {
            const data = await postJson("/api/repair/paste-patch");
            await loadStatus();
            await loadSuggestions();
            return formatActionResult(data);
          });
          return;
        }

        if (target.id === "applyRedeployBtn") {
          await runAction("applyRedeployBtn", "Apply patch + redeploy", async () => {
            const data = await postJson("/api/repair/apply-redeploy");
            await loadStatus();
            await loadSuggestions();
            return formatActionResult(data, "Job queued");
          });
          return;
        }

        if (target.id === "previewDeployBtn") {
          await runAction("previewDeployBtn", "Preview deploy", async () => {
            const data = await dispatchCoreAction("deploy_preview");
            await loadStatus();
            await loadSuggestions();
            return formatActionResult(data, "Job queued");
          });
          return;
        }

        if (target.id === "prodDeployBtn") {
          await runAction("prodDeployBtn", "Production deploy", async () => {
            const approved = window.confirm("This will trigger production deployment. Continue?");
            if (!approved) {
              return "Canceled by user.";
            }
            const data = await dispatchCoreAction("make_app_live", { confirm: true });
            await loadStatus();
            await loadSuggestions();
            return formatActionResult(data, "Job queued");
          });
          return;
        }

        if (target.id === "viewLogsBtn") {
          await runAction("viewLogsBtn", "View logs", async () => {
            const data = await postJson("/api/do/execute", { instruction: "view logs" });
            return formatActionResult(data, "Job queued");
          });
          return;
        }

        if (target.id === "addEnvBtn") {
          await runAction("addEnvBtn", "Add env", async () => {
            const key = document.getElementById("envKeyInput")?.value?.trim() || "";
            const value = document.getElementById("envValueInput")?.value || "";
            const data = await postJson("/api/env/add", { key, value, target: "preview" });
            const envValueInput = document.getElementById("envValueInput");
            if (envValueInput) {
              envValueInput.value = "";
            }
            await loadStatus();
            await loadSuggestions();
            return data.message || "Added env var.";
          });
          return;
        }

        if (target.id === "quickDeployPreviewBtn") {
          await runAction("quickDeployPreviewBtn", "Deploy preview", async () => {
            const data = await dispatchCoreAction("deploy_preview");
            await loadStatus();
            await loadSuggestions();
            return formatActionResult(data, "Job queued");
          });
          return;
        }

        if (target.id === "quickDeployProdBtn") {
          await runAction("quickDeployProdBtn", "Deploy production", async () => {
            const approved = window.confirm("This will trigger production deployment. Continue?");
            if (!approved) {
              return "Canceled by user.";
            }
            const data = await dispatchCoreAction("make_app_live", { confirm: true });
            await loadStatus();
            await loadSuggestions();
            return formatActionResult(data, "Job queued");
          });
          return;
        }

        if (target.id === "quickAddEnvBtn") {
          await runAction("quickAddEnvBtn", "Add environment variable", async () => {
            const keyInput = window.prompt("Environment variable key (e.g. OPENAI_API_KEY):", "");
            const key = (keyInput || "").trim();
            if (!key) {
              throw new Error("Canceled: env key is required.");
            }

            const valueInput = window.prompt(`Value for ${key}:`, "");
            const value = valueInput || "";
            if (!value) {
              throw new Error("Canceled: env value is required.");
            }

            const data = await postJson("/api/env/add", { key, value, target: "preview" });
            await loadStatus();
            await loadSuggestions();
            return data.message || "Added env var.";
          });
          return;
        }

        if (target.id === "quickSupabaseDeployBtn") {
          await runAction("quickSupabaseDeployBtn", "Deploy Supabase function", async () => {
            const functionNameInput = window.prompt("Supabase function name:", "");
            const functionName = (functionNameInput || "").trim();
            if (!functionName) {
              throw new Error("Canceled: function name is required.");
            }

            const projectRefInput = window.prompt("Supabase project ref:", "");
            const projectRef = (projectRefInput || "").trim();
            if (!projectRef) {
              throw new Error("Canceled: project ref is required.");
            }

            const instruction = `deploy supabase function ${functionName} --project-ref ${projectRef}`;
            const data = await postJson("/api/do/execute", { instruction });
            await loadStatus();
            await loadSuggestions();
            return formatActionResult(data, "Job queued");
          });
          return;
        }

        if (target.id === "quickViewLogsBtn") {
          await runAction("quickViewLogsBtn", "View logs", async () => {
            const data = await postJson("/api/do/execute", { instruction: "view logs" });
            return formatActionResult(data, "Job queued");
          });
          return;
        }

        if (target.id === "quickRepairBtn") {
          await runAction("quickRepairBtn", "Repair deployment", async () => {
            const data = await postJson("/api/repair/apply-redeploy");
            await loadStatus();
            await loadSuggestions();
            return formatActionResult(data, "Job queued");
          });
          return;
        }

        const suggestionId = target.dataset?.suggestionId;
        const suggestionAction = target.dataset?.suggestionAction;
        if (suggestionId && suggestionAction) {
          const normalized = String(suggestionAction).trim().toLowerCase();
          if (
            normalized === "deploy preview"
            || normalized === "deploy production"
            || normalized === "connect database"
            || normalized.startsWith("add env database_url")
            || normalized.startsWith("deploy backend")
            || normalized.startsWith("deploy supabase function")
          ) {
            const inputEl = document.getElementById("ai-analyze-input");
            if (inputEl instanceof HTMLInputElement) {
              inputEl.value = suggestionAction;
              inputEl.focus();
            }
            setExecutionPlan((prev) => ({ ...prev, rawInput: suggestionAction }));
            setOutput(`Suggestion loaded: ${suggestionAction}`);
            return;
          }
          await runAction(`suggestion-${suggestionId}`, "Suggested action", async () => {
            const data = await postJson("/api/do/execute", { instruction: suggestionAction });
            await loadStatus();
            await loadSuggestions();
            return formatActionResult(data, "Job queued");
          });
          return;
        }

        const macroId = target.dataset?.macroId;
        const macroLabel = target.dataset?.macroLabel || "Macro";
        const macroSteps = Number.parseInt(target.dataset?.macroSteps || "0", 10);
        if (macroId && target.id) {
          await runAction(`macro-${macroId}`, String(macroLabel), async () => {
            setOutput(`Running macro...\n${macroLabel}\nStep 1/${macroSteps > 0 ? macroSteps : "?"}`);
            const data = await postJson("/api/macro/run", { macroId });
            await loadStatus();
            await loadSuggestions();
            return formatActionResult(data, "Macro queued");
          });
          return;
        }
      } catch (error) {
        setOutput(error instanceof Error ? error.message : "Action failed");
      }
    }

    root.addEventListener("click", handleClick);
    return () => root.removeEventListener("click", handleClick);
  }, [status, launchState, loading, executionPlan, prodConfirmChecked]);

  const html = useMemo(() => {
    const availableMacros = ALL_MACROS.filter((macro) => macro.steps.every((step) => stepSupported(step, capabilities)));
    const hasJobs = Array.isArray(operations) && operations.length > 0;
    const heroState = detectHeroState(status, operations);
    const errorSummary = extractErrorSummary(status);
    const guidance = computeExecutionPlanGuidance(executionPlan.rawInput, executionPlan.actions, status);
    const timelineEntries = buildTimeline(activityLog, operations, executionPlan, prodConfirmChecked);
    const timelineOutcome = computeOutcome(timelineEntries);
    return [
      '<div class="max-w-6xl mx-auto p-4 space-y-6" id="appBody">',
      '<style>#appBody section, #appBody details{transition:box-shadow .2s ease, transform .2s ease} #appBody section:hover{box-shadow:0 18px 34px rgba(15,23,42,.06)}</style>',
      '<h1 class="text-2xl font-bold">deplo.app</h1>',
      '<p class="text-sm text-slate-600">Guided shipping for founders building with AI. Safe fixes are automatic, production actions stay in your control.</p>',
      renderAiChatExecutionPlanSection({
        loading,
        text: executionPlan.rawInput,
        steps: executionPlan.steps,
        guidance,
        prodConfirmChecked,
        suggestions,
        doctorReport,
      }),
      renderFounderSetupProgress(launchState, loading, launchProgress, launchStepStates, doctorReport),
      OperationTimeline({ entries: timelineEntries, outcome: timelineOutcome, expandedIds: expandedTimelineIds, doctorReport }),
      renderProjectLiveInfo(status, launchState, doctorReport),
      '<details id="advancedSection" class="rounded-2xl bg-slate-50/45 p-4 shadow-sm border border-slate-200/60">',
      '<summary class="cursor-pointer text-lg font-semibold text-slate-700">Advanced</summary>',
      '<div class="mt-4 space-y-4">',
      renderDetectedStack(status),
      StatusSection({ status }),
      `<div id="doctor-section">${DoctorSection({ doctor: doctorReport, loading })}</div>`,
      hasJobs
        ? `<details class="rounded-xl bg-slate-50 p-4 border border-slate-200"><summary class="cursor-pointer text-base font-semibold">Execution Queue (${operations.length})</summary><div class="mt-3">${ExecutionQueueSection({ operations })}</div></details>`
        : "",
      '<section class="rounded-xl bg-white/75 p-4 shadow-sm border border-slate-200/70">',
      '<h2 class="text-lg font-semibold mb-3">Output</h2>',
      `<pre id="outputPanel" class="bg-slate-950 text-slate-100 rounded-md p-2 text-xs overflow-auto max-h-72">${escapeHtml(output)}</pre>`,
      "</section>",
      AutoModeSection({ loading }),
      '<div class="grid gap-4 md:grid-cols-2">',
      MacrosSection({ loading, macros: availableMacros }),
      QuickActionsSection({ loading, capabilities }),
      "</div>",
      '<div class="grid gap-4 md:grid-cols-2">',
      RepairSection({ status, loading, capabilities }),
      EnvironmentSection({ status, loading, capabilities }),
      "</div>",
      '<div class="grid gap-4 md:grid-cols-2">',
      ChatImportSection({ loading, chatText, parsedActions: chatActions, emptyMessage: chatEmptyMessage }),
      InstructionSection({ instruction, loading }),
      "</div>",
      DeploymentSection({ loading, capabilities }),
      "</div>",
      "</details>",
      "</div>",
    ].join("");
  }, [
    status,
    launchState,
    capabilities,
    suggestions,
    doctorReport,
    operations,
    activityLog,
    chatText,
    chatActions,
    chatEmptyMessage,
    executionPlan,
    prodConfirmChecked,
    commandText,
    commandFocused,
    instruction,
    output,
    loading,
    resultBanner,
    launchProgress,
    launchStepStates,
    expandedTimelineIds,
  ]);

  return React.createElement("div", { dangerouslySetInnerHTML: { __html: html } });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

createRoot(document.getElementById("root")).render(React.createElement(App));

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
      subtitle: "We found something missing. Let's fix this first.",
      buttonLabel: hasAutofix ? "Fix this next" : "Review what's missing",
      loadingLabel: hasAutofix ? "Applying safe fixes..." : "Opening Doctor...",
    };
  }
  if (environment.severity === "warning") {
    return {
      mode: hasAutofix ? "setup_fix" : "setup_open",
      subtitle: "You're close. One small setup step is still needed.",
      buttonLabel: hasAutofix ? "Fix this next" : "Review what's missing",
      loadingLabel: hasAutofix ? "Applying safe fixes..." : "Opening Doctor...",
    };
  }
  return {
    mode: "shipping",
    subtitle: "Take one guided step and move closer to sharing.",
    buttonLabel: "Continue setup",
    loadingLabel: "Creating...",
  };
}

function makerStepOutcome(step) {
  const id = String(step?.id || "");
  if (id === "founderConnectDbBtn") return "Connect one missing account";
  if (id === "founderDeployFunctionsBtn") return "Set up key app features";
  if (id === "founderPreviewBtn") return "Create a test version";
  if (id === "founderLiveBtn") return "Share your app with people";
  return String(step?.label || "Next step");
}

function makerStepResult(step) {
  const id = String(step?.id || "");
  if (id === "founderConnectDbBtn") return "Your app is connected and can save data.";
  if (id === "founderDeployFunctionsBtn") return "Core app features are ready to run.";
  if (id === "founderPreviewBtn") return "A test version is ready to review.";
  if (id === "founderLiveBtn") return "Your app is ready to share with people.";
  return "You move one step closer to sharing.";
}

function inferProjectType(rawIdea) {
  const text = String(rawIdea || "").toLowerCase();
  if (!text) return "app";
  if (/\b(site|website|landing page|portfolio|page)\b/.test(text)) return "website";
  if (/\b(app|tool|tracker|booking|dashboard|portal)\b/.test(text)) return "app";
  return "complex";
}

function firstVersionSummary(projectType) {
  if (projectType === "website") {
    return [
      "A clear page draft with your core message and layout.",
      "A structure you can review quickly and adjust with plain language.",
      "A first shareable version focused on the main page experience.",
    ];
  }
  if (projectType === "app") {
    return [
      "A simple first flow people can try right away.",
      "Key screens and interactions focused on your main use case.",
      "A reviewable draft you can keep refining with requests.",
    ];
  }
  return [
    "A starter slice focused on your main flow first.",
    "A practical first version you can review before expanding scope.",
    "A clear path to iterate and then share when ready.",
  ];
}

function previewIncludedList(projectType, ideaText) {
  const idea = String(ideaText || "").trim();
  const shortIdea = idea ? idea.replace(/^make\s+/i, "").replace(/^build\s+/i, "").slice(0, 64) : "";
  const isBooking = /\b(book|booking|appointment|reserve|reservation)\b/i.test(idea);
  if (isBooking) {
    return [
      shortIdea ? `A first booking-page draft for "${shortIdea}"` : "A first booking-page draft",
      "A clear page layout with one visible booking call to action",
      "A reviewable first page structure you can edit in plain language",
    ];
  }
  if (projectType === "website") {
    return [
      shortIdea ? `A homepage draft for "${shortIdea}"` : "A homepage draft with clear structure",
      "A simple layout with key sections and one main call to action",
      "A reviewable first page you can refine before sharing",
    ];
  }
  if (projectType === "app") {
    return [
      shortIdea ? `A starter app draft for "${shortIdea}"` : "A starter app draft for your main use case",
      "Key screens arranged for a quick first walkthrough",
      "A reviewable first draft ready for plain-language changes",
    ];
  }
  return [
    shortIdea ? `A focused starter slice for "${shortIdea}"` : "A focused starter slice for the main workflow",
    "A concrete draft you can react to right away",
    "A clear base you can expand after review",
  ];
}

function renderFallbackDraftArtifact(projectType, ideaText) {
  const headline = String(ideaText || "").trim()
    ? String(ideaText).replace(/^make\s+/i, "").replace(/^build\s+/i, "").slice(0, 72)
    : "Your first draft";
  const isBooking = /\b(book|booking|appointment|reserve|reservation)\b/i.test(String(ideaText || ""));

  if (isBooking) {
    return `
      <div class="rounded-xl border border-slate-200 bg-white p-3">
        <div class="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <div class="flex items-center justify-between">
            <div class="text-sm font-semibold text-slate-800">${escapeHtml(headline)}</div>
            <div class="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-800">Book now</div>
          </div>
          <div class="mt-3 rounded-md border border-slate-200 bg-white p-3">
            <div class="h-3 w-36 rounded bg-slate-300/70"></div>
            <div class="mt-2 h-2.5 w-full rounded bg-slate-200/90"></div>
            <div class="mt-1.5 h-2.5 w-10/12 rounded bg-slate-200/90"></div>
            <div class="mt-3 grid grid-cols-2 gap-2">
              <div class="h-12 rounded border border-sky-200/70 bg-sky-50/80"></div>
              <div class="h-12 rounded border border-emerald-200/70 bg-emerald-50/80"></div>
            </div>
          </div>
          <div class="mt-3 grid grid-cols-3 gap-2">
            <div class="h-9 rounded border border-slate-200 bg-white"></div>
            <div class="h-9 rounded border border-slate-200 bg-white"></div>
            <div class="h-9 rounded border border-slate-200 bg-white"></div>
          </div>
          <div class="mt-3 rounded border border-indigo-200/80 bg-indigo-50/70 px-2.5 py-1.5 text-[11px] text-indigo-800">
            Draft mode: review layout, copy, and booking flow
          </div>
        </div>
      </div>
    `;
  }

  if (projectType === "website") {
    return `
      <div class="rounded-xl border border-slate-200 bg-white p-3">
        <div class="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
          <div class="text-sm font-semibold text-slate-800">${escapeHtml(headline)}</div>
          <div class="mt-2 h-2.5 w-40 rounded bg-slate-300/70"></div>
          <div class="mt-4 grid gap-2">
            <div class="h-16 rounded border border-sky-200/80 bg-sky-50/80"></div>
            <div class="h-16 rounded border border-emerald-200/80 bg-emerald-50/80"></div>
            <div class="h-16 rounded border border-slate-200/80 bg-white"></div>
          </div>
        </div>
      </div>
    `;
  }

  if (projectType === "app") {
    return `
      <div class="rounded-xl border border-slate-200 bg-white p-3">
        <div class="mx-auto w-52 rounded-2xl border border-slate-300 bg-slate-50 p-3 shadow-sm">
          <div class="text-xs text-slate-500">App draft</div>
          <div class="mt-1 text-sm font-semibold text-slate-800">${escapeHtml(headline)}</div>
          <div class="mt-3 space-y-2">
            <div class="h-10 rounded bg-sky-100/80 border border-sky-200/70"></div>
            <div class="h-10 rounded bg-emerald-100/80 border border-emerald-200/70"></div>
            <div class="h-10 rounded bg-white border border-slate-200/90"></div>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="rounded-xl border border-slate-200 bg-white p-3">
      <div class="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
        <div class="text-sm font-semibold text-slate-800">${escapeHtml(headline)}</div>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <div class="h-16 rounded border border-sky-200/80 bg-sky-50/80"></div>
          <div class="h-16 rounded border border-emerald-200/80 bg-emerald-50/80"></div>
          <div class="h-16 rounded border border-slate-200/80 bg-white"></div>
          <div class="h-16 rounded border border-slate-200/80 bg-white"></div>
        </div>
      </div>
    </div>
  `;
}

function renderFounderSetupProgress(launchState, loading, launchProgress, launchStepStates, doctorReport) {
  const steps = getLaunchChecklist(launchState);
  const nextAction = getPrimaryNextActionState(doctorReport);
  const environment = getEnvironmentStatusFromDoctor(doctorReport);
  const isSetupFirst = nextAction.mode !== "shipping";

  const allDone = steps.every((step) => step.done);
  const hasIncomplete = steps.some((step) => !step.done);
  const firstIncomplete = steps.find((step) => !step.done);
  const needsActionNow = hasIncomplete || isSetupFirst;
  const nextResult = isSetupFirst
    ? "Your app will be ready to review and share."
    : allDone
      ? "Everything needed for sharing is in place."
      : makerStepResult(firstIncomplete);
  const remainingSteps = steps.filter((step) => !step.done);
  const rows = steps
    .map((step) => {
      const liveState = launchStepStates?.[step.id];
      const displayState = liveState || (step.done ? "completed" : "pending");
      if (displayState === "completed") {
        return `<li class="py-1 text-sm text-emerald-800">✓ ${makerStepOutcome(step)}</li>`;
      }
      const indicator = displayState === "running"
        ? '<span class="inline-block mr-2 text-blue-700 animate-pulse">●</span>'
        : '<span class="inline-block mr-2 text-slate-500">○</span>';
      return `<li class="py-1 text-sm text-slate-700">${indicator}${makerStepOutcome(step)}</li>`;
    })
    .join("");

  const guidanceBanner = environment.severity === "blocked"
    ? `<div class="mt-4 rounded-2xl border border-rose-200 bg-rose-50/90 p-4">
      <div class="text-xs font-semibold tracking-wide text-rose-700">One thing to fix first</div>
      <p class="mt-1 text-sm text-rose-900">We found something blocking progress. We can guide the safe part right now.</p>
    </div>`
    : environment.severity === "warning"
      ? `<div class="mt-4 rounded-2xl border border-amber-200 bg-amber-50/90 p-4">
        <div class="text-xs font-semibold tracking-wide text-amber-700">Almost there</div>
        <p class="mt-1 text-sm text-amber-900">A small setup detail still needs your input.</p>
      </div>`
      : `<div class="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/90 p-4">
        <div class="text-xs font-semibold tracking-wide text-emerald-700">Ready to move forward</div>
        <p class="mt-1 text-sm text-emerald-900">We can safely prepare your next result now.</p>
      </div>`;

  return `
    <div class="rounded-2xl bg-gradient-to-b from-emerald-50/75 via-white/95 to-sky-50/50 p-6 shadow-soft border border-emerald-100/80 transition-all duration-200">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="text-3xl font-semibold text-slate-900">Your next step</h2>
          <p class="text-base text-slate-700 mt-1">${
            isSetupFirst
              ? "One thing is still missing before you can share this."
              : allDone
                ? "Your first version is ready to share."
                : `Do this now: ${escapeHtml(makerStepOutcome(firstIncomplete))}`
          }</p>
        </div>
        <span class="rounded-full px-3 py-1 text-xs font-medium ${isSetupFirst ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}">${isSetupFirst ? "Needs setup" : "On track"}</span>
      </div>
      ${isSetupFirst ? guidanceBanner : ""}
      ${needsActionNow
        ? `<div class="mt-4">
          <button id="founderLaunchAppBtn" ${loading?.founderLaunchAppBtn ? "disabled" : ""} class="rounded-full bg-emerald-700 text-white px-5 py-2.5 text-sm font-semibold shadow-medium hover:bg-emerald-800 hover:-translate-y-0.5 transition ${loading?.founderLaunchAppBtn ? "opacity-60 cursor-not-allowed" : ""}">${loading?.founderLaunchAppBtn ? nextAction.loadingLabel : nextAction.buttonLabel}</button>
        </div>`
        : ""}
      ${launchProgress
        ? `<p class="mt-3 text-sm text-slate-700">${escapeHtml(launchProgress)}</p>`
        : ""}
      ${remainingSteps.length > 0
        ? `<details class="mt-4 rounded-2xl border border-slate-200/70 bg-white/70 p-3">
            <summary class="cursor-pointer text-xs font-medium text-slate-600">Optional: view all steps (${remainingSteps.length} left)</summary>
            <ul class="mt-2 space-y-1.5 text-xs">${rows}</ul>
          </details>`
        : ""}
      ${allDone && !isSetupFirst ? '<p class="mt-3 text-sm font-medium text-emerald-700">Ready to share 🚀</p>' : ""}
    </div>
  `;
}

function renderMakerProgressSnapshot(launchState, doctorReport, activityLog) {
  const appLive = isProjectLive(launchState);
  const dbConnected = Boolean(launchState?.databaseConnected);
  const environment = getEnvironmentStatusFromDoctor(doctorReport);
  const shareReady = appLive && environment.severity === "ready";
  const recent = Array.isArray(activityLog) ? activityLog.slice(0, 2) : [];
  const recentLine = recent.length > 0
    ? String(recent[0]?.message || "Progress updated")
    : "We will show progress here as soon as you start.";
  const statusPill = (label, value, tone) => `
    <div class="rounded-full border px-3 py-2 shadow-sm ${tone}">
      <div class="text-[11px] tracking-wide text-slate-500">${label}</div>
      <div class="text-sm font-semibold">${escapeHtml(value)}</div>
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
    <div class="rounded-2xl bg-white/88 p-3.5 shadow-soft border border-slate-200/65">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-sm font-semibold text-slate-700">${shareReady ? "Share status" : "Before sharing"}</h2>
        <span class="text-xs text-slate-500">${shareReady ? "Ready" : "Not ready yet"}</span>
      </div>
      <div class="mt-2.5 flex flex-wrap gap-2 text-sm">
        ${statusPill("Version", appLive ? "Complete" : "Building", appTone)}
        ${statusPill("Connect", dbConnected ? "Done" : "Needed", dbTone)}
        ${statusPill("Share", shareReady ? "Ready" : environment.label, envTone)}
      </div>
      <div class="mt-2 text-xs text-slate-500">Latest: ${escapeHtml(recentLine)}</div>
    </div>
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

function renderAiChatExecutionPlanSection({ loading, text, steps }) {
  const analyzeBusy = Boolean(loading.aiAnalyzeBtn);
  const quickBusy = Boolean(loading.operatorQuickLaunchBtn)
    || Boolean(loading.operatorQuickBackendBtn)
    || Boolean(loading.operatorQuickPreviewBtn)
    || Boolean(loading.operatorQuickLiveBtn);
  const hasActions = Array.isArray(steps) && steps.length > 0;

  return `
    <div class="rounded-2xl bg-gradient-to-br from-sky-50/95 via-white to-emerald-50/55 p-7 shadow-medium border border-sky-100/80 transition-all duration-200">
      <div class="text-xs font-medium uppercase tracking-wide text-sky-700/80">Start here</div>
      <h2 class="mt-1 text-3xl font-semibold text-slate-900">What would you like to make?</h2>
      <p class="text-sm text-slate-600 mt-2">Describe your idea in one sentence. Deplo turns it into a guided path.</p>
      <div class="mt-3 flex flex-wrap gap-2.5">
        <button id="operatorQuickLaunchBtn" data-operator-command="launch SaaS" ${quickBusy ? "disabled" : ""} class="rounded-full border border-slate-200/80 bg-white/80 px-3.5 py-1.5 text-xs text-slate-700 hover:bg-white transition ${quickBusy ? "opacity-60 cursor-not-allowed" : ""}">Recipe app for my mom</button>
        <button id="operatorQuickBackendBtn" data-operator-command="deploy backend" ${quickBusy ? "disabled" : ""} class="rounded-full border border-slate-200/80 bg-white/80 px-3.5 py-1.5 text-xs text-slate-700 hover:bg-white transition ${quickBusy ? "opacity-60 cursor-not-allowed" : ""}">Booking page for my workshop</button>
        <button id="operatorQuickPreviewBtn" data-operator-command="deploy preview" ${quickBusy ? "disabled" : ""} class="rounded-full border border-slate-200/80 bg-white/80 px-3.5 py-1.5 text-xs text-slate-700 hover:bg-white transition ${quickBusy ? "opacity-60 cursor-not-allowed" : ""}">Dog care app</button>
        <button id="operatorQuickLiveBtn" data-operator-command="make app live" ${quickBusy ? "disabled" : ""} class="rounded-full border border-slate-200/80 bg-white/80 px-3.5 py-1.5 text-xs text-slate-700 hover:bg-white transition ${quickBusy ? "opacity-60 cursor-not-allowed" : ""}">Website for my classes</button>
      </div>
      <input id="ai-analyze-input" class="mt-4 rounded-2xl border border-slate-200/80 bg-white/90 text-sm shadow-inner focus:bg-white focus:border-slate-300" style="font-size:16px;padding:13px;width:440px;max-width:100%;" placeholder="Make a booking page for my brother's workshop" value="${escapeHtml(text || "")}" />
      <div class="mt-2 text-xs text-slate-500">Most people start with one sentence. You can change everything later.</div>
      <div class="mt-2 text-xs text-slate-500">You do not need technical words. Deplo handles safe parts and asks before sensitive ones.</div>
      <div class="mt-4">
        <button id="aiAnalyzeBtn" ${analyzeBusy ? "disabled" : ""} class="rounded-full bg-emerald-700 text-white px-5 py-2.5 text-sm font-semibold shadow-medium hover:bg-emerald-800 hover:-translate-y-0.5 transition ${analyzeBusy ? "opacity-60 cursor-not-allowed" : ""}">${analyzeBusy ? "Starting..." : "Start with this idea"}</button>
      </div>
      ${hasActions
        ? `<p class="mt-3 text-sm text-slate-600">Great. We turned your idea into a guided path.</p>`
        : ""}
    </div>
  `;
}

function renderMakerPostClickFlow({
  started,
  analyzing,
  executionPlan,
  status,
  launchState,
  launchStepStates,
  launchProgress,
  doctorReport,
  loading,
}) {
  if (!started) {
    return "";
  }

  const hasPlan = Array.isArray(executionPlan?.actions) && executionPlan.actions.length > 0;
  const stepStates = launchStepStates && typeof launchStepStates === "object" ? launchStepStates : {};
  const isRunningLaunch = Boolean(launchProgress) || Object.values(stepStates).some((value) => value === "running");
  const readyForReview = Boolean(launchState?.previewReady || launchState?.appLive);
  const steps = getLaunchChecklist(launchState);
  const firstIncomplete = steps.find((step) => !step.done);
  const nextAction = getPrimaryNextActionState(doctorReport);
  const ideaText = String(executionPlan?.rawInput || "");
  const projectType = inferProjectType(ideaText);
  const summaryLines = firstVersionSummary(projectType);
  const firstVersionUrl = String(status?.vercel?.lastDeployUrl || "").trim();
  const canOpenFirstVersion = Boolean(firstVersionUrl);
  const needsInput = Boolean(firstIncomplete) && nextAction.mode !== "shipping";

  const phase = (label, state, detail) => {
    const tone = state === "done"
      ? "text-emerald-800 bg-emerald-50 border-emerald-200"
      : state === "running"
        ? "text-sky-800 bg-sky-50 border-sky-200"
        : "text-slate-700 bg-white/85 border-slate-200";
    const marker = state === "done" ? "✓" : state === "running" ? "●" : "○";
    return `<div class="rounded-xl border px-3 py-2.5 ${tone}">
      <div class="text-sm font-medium">${marker} ${escapeHtml(label)}</div>
      <div class="mt-1 text-xs opacity-80">${escapeHtml(detail)}</div>
    </div>`;
  };

  const flowRows = [
    phase("We got your idea", "done", "You are in guided creation now."),
    phase(
      "We're preparing your first version",
      analyzing || (!hasPlan && started) ? "running" : "done",
      analyzing ? "This takes a moment." : "A reviewable first result is on the way.",
    ),
    phase(
      "One thing may need your approval",
      "pending",
      isRunningLaunch ? "Safe parts are already being handled." : "We'll ask before sensitive changes.",
    ),
  ].join("");

  const nextResult = readyForReview
    ? "Your first version is ready to review."
    : "Next, you'll review your first version.";
  const nextMove = firstIncomplete ? makerStepOutcome(firstIncomplete) : "Review your first version";
  const showLaunchButton = Boolean(firstIncomplete);

  return `
    <div class="mt-5 rounded-2xl border border-emerald-100/90 bg-white/90 p-4 shadow-soft">
      <h3 class="text-base font-semibold text-slate-900">Your first version</h3>
      <p class="mt-1 text-sm text-slate-600">You can change anything.</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button id="openFirstVersionBtn" class="rounded-full bg-emerald-700 text-white px-4 py-2 text-sm font-semibold shadow-medium hover:bg-emerald-800 hover:-translate-y-0.5 transition">Open first version</button>
        <button id="requestChangesBtn" class="rounded-full border border-slate-300/80 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">Request changes</button>
      </div>
      <div class="mt-3 grid gap-2 md:grid-cols-3">${flowRows}</div>
      <div class="mt-3 rounded-xl border border-slate-200 bg-white/90 px-3 py-2.5">
        <div class="text-sm font-medium text-slate-800">What we made</div>
        <ul class="mt-1 space-y-1 text-xs text-slate-600">
          ${summaryLines.map((line) => `<li>• ${escapeHtml(line)}</li>`).join("")}
        </ul>
      </div>
      ${needsInput
        ? `<div class="mt-3 rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-2.5">
          <div class="text-sm font-medium text-amber-900">Needs your input</div>
          <div class="mt-1 text-xs text-amber-800">${escapeHtml(makerStepOutcome(firstIncomplete))}</div>
        </div>`
        : ""}
      <div class="mt-3 rounded-xl border border-slate-200 bg-white/90 px-3 py-2.5">
        <div class="text-sm font-medium text-slate-800">Next up: ${escapeHtml(nextMove)}</div>
        <div class="mt-1 text-xs text-slate-600">One clear move is enough. We handle safe parts and ask before sensitive ones.</div>
        ${showLaunchButton
          ? `<button id="founderLaunchAppBtn" ${loading?.founderLaunchAppBtn ? "disabled" : ""} class="mt-2 rounded-full bg-emerald-700 text-white px-4 py-2 text-sm font-semibold shadow-medium hover:bg-emerald-800 hover:-translate-y-0.5 transition ${loading?.founderLaunchAppBtn ? "opacity-60 cursor-not-allowed" : ""}">${loading?.founderLaunchAppBtn ? nextAction.loadingLabel : nextAction.buttonLabel}</button>`
          : ""}
      </div>
      ${launchProgress ? `<p class="mt-2 text-sm text-slate-700">${escapeHtml(launchProgress)}</p>` : ""}
      <div class="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/90 px-3 py-2 text-sm text-emerald-900">
        ${escapeHtml(nextResult)} ${canOpenFirstVersion ? "If this already looks right, you can share when ready." : "Once ready, you'll be able to review and share."}
      </div>
    </div>
  `;
}

function renderFirstVersionContent({ status, executionPlan, launchState, doctorReport, appliedChangeRequest = "" }) {
  const ideaText = String(executionPlan?.rawInput || "");
  const projectType = inferProjectType(ideaText);
  const included = previewIncludedList(projectType, ideaText);
  const hasAppliedUpdate = String(appliedChangeRequest || "").trim().length > 0;
  const appliedUpdateText = String(appliedChangeRequest || "").trim();
  const firstVersionUrl = String(status?.vercel?.lastDeployUrl || "").trim();
  const hasLivePreview = Boolean(firstVersionUrl);
  const needsInput = getPrimaryNextActionState(doctorReport).mode !== "shipping";
  const shareReady = Boolean(launchState?.appLive);
  const readinessMessage = needsInput
    ? "One detail still needs your input before sharing."
    : shareReady
      ? "This version is ready to share when you are ready."
      : "Review this version first, then share when it feels right.";
  const readinessTone = needsInput
    ? "border-amber-200 bg-amber-50/90 text-amber-900"
    : "border-emerald-200 bg-emerald-50/90 text-emerald-900";
  const previewTitle = projectType === "website"
    ? "Homepage draft"
    : projectType === "app"
      ? "App starter draft"
      : "Starter draft";

  return `
    <section class="rounded-[32px] border border-slate-200/75 bg-white/82 p-5 shadow-medium space-y-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="text-2xl font-semibold text-slate-900">Your first version</h2>
          <p class="mt-1 text-sm text-slate-600">You can review this draft and request changes in plain language.</p>
        </div>
        <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">${projectType === "website" ? "Website draft" : projectType === "app" ? "App draft" : "Starter draft"}</span>
      </div>

      <div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/60 p-4">
        <div class="flex items-center justify-between gap-2">
          <div class="text-sm font-medium text-slate-800">Draft preview</div>
          <div class="text-xs ${hasAppliedUpdate ? "text-emerald-700 font-medium" : "text-slate-500"}">${hasAppliedUpdate ? "Updated version" : escapeHtml(previewTitle)}</div>
        </div>
        ${hasLivePreview
          ? `<div class="mt-2 overflow-hidden rounded-xl border border-slate-200">
              <iframe src="${escapeHtml(firstVersionUrl)}" title="First version preview" class="h-80 w-full bg-white"></iframe>
            </div>`
          : `<div class="mt-2">
              ${renderFallbackDraftArtifact(projectType, ideaText)}
              <p class="mt-3 text-sm text-slate-600">Your visual draft is being assembled. You can already request changes based on this starter version.</p>
            </div>`}
        ${hasAppliedUpdate
          ? `<div class="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-sm text-emerald-900">
              Updated from your request: ${escapeHtml(appliedUpdateText)}
            </div>`
          : ""}
        <div class="mt-3 grid gap-2 md:grid-cols-3 text-xs text-slate-600">
          <div class="rounded-lg border border-slate-200 bg-white/90 px-2.5 py-2">Review: layout and flow</div>
          <div class="rounded-lg border border-slate-200 bg-white/90 px-2.5 py-2">Change: text, sections, behavior</div>
          <div class="rounded-lg border border-slate-200 bg-white/90 px-2.5 py-2">Share: when this feels right</div>
        </div>
      </div>

      <div class="rounded-2xl border border-slate-200 bg-white p-4">
        <div class="text-sm font-medium text-slate-800">What we made</div>
        <ul class="mt-2 space-y-1 text-sm text-slate-600">
          ${hasAppliedUpdate ? `<li>• Updated based on your request: ${escapeHtml(appliedUpdateText)}</li>` : ""}
          ${included.map((line) => `<li>• ${escapeHtml(line)}</li>`).join("")}
        </ul>
      </div>

      <div class="rounded-xl px-3 py-2 text-sm ${readinessTone}">
        ${readinessMessage}
      </div>

      <div class="flex flex-wrap gap-2.5">
        <button id="requestChangesFromPreviewBtn" class="rounded-full border border-slate-300/80 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">Request changes</button>
        <button id="closeFirstVersionPreviewBtn" class="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition">Back to setup</button>
      </div>
    </section>
  `;
}

function renderWhatHappensNextCard() {
  return `
    <div class="rounded-2xl bg-sky-50/70 p-4 shadow-soft border border-sky-100/80">
      <h2 class="text-lg font-semibold">What Deplo does first</h2>
      <p class="mt-1 text-sm text-slate-600">From your idea to a first version, with calm guidance at each step.</p>
      <div class="mt-3 rounded-xl border border-sky-100 bg-white/85 p-3">
        <div class="flex flex-col gap-2 text-sm text-slate-700 md:flex-row md:items-center md:gap-3">
          <span class="rounded-full bg-sky-100 px-3 py-1 text-sky-900">First version</span>
          <span class="hidden md:inline text-slate-400">→</span>
          <span class="rounded-full bg-emerald-100 px-3 py-1 text-emerald-900">Safe fixes</span>
          <span class="hidden md:inline text-slate-400">→</span>
          <span class="rounded-full bg-amber-100 px-3 py-1 text-amber-900">Your approval</span>
        </div>
      </div>
    </div>
  `;
}

function renderMakerDashboard({
  loading,
  executionPlan,
  status,
  launchState,
  launchProgress,
  launchStepStates,
  doctorReport,
  activityLog,
  makerStarted,
}) {
  const postClickActive = Boolean(makerStarted);
  const inFlowBlock = postClickActive
    ? renderMakerPostClickFlow({
      started: makerStarted,
      analyzing: Boolean(loading.aiAnalyzeBtn),
      executionPlan,
      launchState,
      status,
      launchStepStates,
      launchProgress,
      doctorReport,
      loading,
    })
    : renderWhatHappensNextCard();
  return [
    '<div class="max-w-5xl mx-auto p-4 space-y-4" id="appBody">',
    '<style>#appBody section{transition:box-shadow .2s ease, transform .2s ease} #appBody section:hover{box-shadow:0 18px 34px rgba(15,23,42,.06)}</style>',
    '<section class="rounded-[32px] border border-slate-200/75 bg-white/78 p-4 shadow-medium space-y-4">',
    renderAiChatExecutionPlanSection({
      loading,
      text: executionPlan.rawInput,
      steps: executionPlan.steps,
    }),
    inFlowBlock,
    '<div class="border-t border-slate-200/70"></div>',
    "</section>",
    postClickActive ? "" : renderFounderSetupProgress(launchState, loading, launchProgress, launchStepStates, doctorReport),
    '<div class="flex justify-center py-1">',
    '<button id="openFirstVersionBtn" class="rounded-full bg-emerald-700 text-white px-5 py-2.5 text-sm font-semibold shadow-medium hover:bg-emerald-800 hover:-translate-y-0.5 transition">Open first version →</button>',
    '</div>',
    '<section class="rounded-[28px] border border-slate-200/70 bg-white/75 p-4 shadow-soft">',
    renderMakerProgressSnapshot(launchState, doctorReport, activityLog),
    "</section>",
    '<section class="rounded-xl border border-slate-200/60 bg-white/60 p-3 shadow-sm">',
    '<div class="flex items-center justify-between gap-3">',
    '<p class="text-sm text-slate-500">Need deeper controls?</p>',
    '<button id="openExpertToolsBtn" class="rounded-full border border-slate-300/80 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">Open expert tools</button>',
    "</div>",
    "</section>",
    "</div>",
  ].join("");
}

function renderFirstVersionScreen({ status, executionPlan, launchState, doctorReport, appliedChangeRequest = "" }) {
  return [
    '<div class="max-w-5xl mx-auto p-4 space-y-4" id="appBody">',
    renderFirstVersionContent({ status, executionPlan, launchState, doctorReport, appliedChangeRequest }),
    "</div>",
  ].join("");
}

function renderChangeRequestScreen({ validationMessage = "" }) {
  return [
    '<div class="max-w-3xl mx-auto p-4 space-y-4" id="appBody">',
    '<section class="rounded-[32px] border border-slate-200/75 bg-white/82 p-6 shadow-medium">',
    '<h2 class="text-2xl font-semibold text-slate-900">Request changes</h2>',
    '<p class="mt-2 text-sm text-slate-600">Describe what you want to change in plain language. Deplo will update the draft and you can keep iterating.</p>',
    '<div class="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-600">',
    '<div>Try:</div>',
    '<div class="mt-1">• Make the button bigger</div>',
    '<div>• Add a short description of the workshop</div>',
    '<div>• Use softer colors</div>',
    '<div>• Add a booking form</div>',
    "</div>",
    '<textarea id="changeRequestInput" class="mt-4 w-full rounded-2xl border border-slate-200/80 bg-white p-3 text-sm text-slate-800 focus:border-slate-300" rows="6" placeholder="Describe the change you want..."></textarea>',
    validationMessage
      ? `<p class="mt-2 text-sm text-rose-700">${escapeHtml(validationMessage)}</p>`
      : "",
    '<div class="mt-4 flex flex-wrap gap-2.5">',
    '<button id="submitChangeRequestBtn" class="rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-medium hover:bg-emerald-800 hover:-translate-y-0.5 transition">Update draft</button>',
    '<button id="cancelChangeRequestBtn" class="rounded-full border border-slate-300/80 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">Back</button>',
    "</div>",
    "</section>",
    "</div>",
  ].join("");
}

function renderUpdatingDraftScreen({ requestSummary = "" }) {
  const verbatim = String(requestSummary || "").trim();
  return [
    '<div class="max-w-3xl mx-auto p-4 space-y-4" id="appBody">',
    '<section class="rounded-[32px] border border-slate-200/75 bg-white/82 p-6 shadow-medium text-center">',
    '<h2 class="text-2xl font-semibold text-slate-900">Updating your draft</h2>',
    '<p class="mt-2 text-sm text-slate-600">Deplo is applying your request.</p>',
    verbatim
      ? `<div class="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-left text-sm text-slate-700"><span class="font-medium">Your request:</span> ${escapeHtml(verbatim)}</div>`
      : "",
    verbatim
      ? `<pre class="mt-2 overflow-auto rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-700">${escapeHtml(verbatim)}</pre>`
      : "",
    '<div class="mt-4 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-800">',
    '<span class="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-500"></span>',
    '<span>Change request received</span>',
    '</div>',
    '<div class="mt-5">',
    '<button id="backToFirstVersionAfterUpdateBtn" class="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition">See updated version</button>',
    '</div>',
    '</section>',
    '</div>',
  ].join("");
}

function expertViewHtml({
  timelineEntries,
  timelineOutcome,
  expandedTimelineIds,
  doctorReport,
  status,
  hasJobs,
  operations,
  output,
  loading,
  availableMacros,
  capabilities,
  chatText,
  chatActions,
  chatEmptyMessage,
  instruction,
}) {
  return [
    '<div class="max-w-6xl mx-auto p-4 space-y-6" id="appBody">',
    '<style>#appBody section, #appBody details{transition:box-shadow .2s ease, transform .2s ease} #appBody section:hover{box-shadow:0 18px 34px rgba(15,23,42,.06)}</style>',
    '<section class="rounded-2xl bg-slate-900 text-slate-50 p-4 shadow-medium border border-slate-700/70">',
    '<div class="flex flex-wrap items-center justify-between gap-3">',
    '<div>',
    '<h1 class="text-xl font-semibold">Expert tools</h1>',
    '<p class="text-sm text-slate-300">Technical controls, diagnostics, and operator workflows.</p>',
    "</div>",
    '<button id="closeExpertToolsBtn" class="rounded-full border border-slate-500/70 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700 transition">Back to maker view</button>',
    "</div>",
    "</section>",
    '<div class="space-y-4">',
    OperationTimeline({ entries: timelineEntries, outcome: timelineOutcome, expandedIds: expandedTimelineIds, doctorReport }),
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
    "</div>",
  ].join("");
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

function readChangeRequestText() {
  const textArea = document.getElementById("changeRequestInput");
  if (!(textArea instanceof HTMLTextAreaElement)) {
    return "";
  }
  return String(textArea.value || "").trim();
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
  const [expertMode, setExpertMode] = useState(false);
  const [makerStarted, setMakerStarted] = useState(false);
  const [makerScreen, setMakerScreen] = useState("dashboard");
  const [changeRequestBackScreen, setChangeRequestBackScreen] = useState("first-version");
  const [changeRequestValidation, setChangeRequestValidation] = useState("");
  const [lastSubmittedChangeRequest, setLastSubmittedChangeRequest] = useState("");
  const [lastAppliedChangeRequest, setLastAppliedChangeRequest] = useState("");
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
        setExpertMode(true);
        window.setTimeout(() => {
          const doctorEl = document.getElementById("doctor-section");
          if (doctorEl instanceof HTMLElement) {
            doctorEl.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 80);
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
          setMakerScreen("dashboard");
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

        if (target.id === "openExpertToolsBtn") {
          setExpertMode(true);
          return;
        }

        if (target.id === "openFirstVersionBtn") {
          setMakerScreen("first-version");
          return;
        }

        if (target.id === "requestChangesBtn") {
          setChangeRequestBackScreen("dashboard");
          setChangeRequestValidation("");
          setMakerScreen("request-changes");
          return;
        }

        if (target.id === "requestChangesFromPreviewBtn") {
          setChangeRequestBackScreen("first-version");
          setChangeRequestValidation("");
          setMakerScreen("request-changes");
          return;
        }

        if (target.id === "openFirstVersionExternalBtn") {
          const firstVersionUrl = String(status?.vercel?.lastDeployUrl || "").trim();
          if (firstVersionUrl) {
            window.open(firstVersionUrl, "_blank", "noopener,noreferrer");
          }
          return;
        }

        if (target.id === "closeFirstVersionPreviewBtn") {
          setMakerScreen("dashboard");
          return;
        }

        if (target.id === "cancelChangeRequestBtn") {
          setChangeRequestValidation("");
          setMakerScreen(changeRequestBackScreen === "dashboard" ? "dashboard" : "first-version");
          return;
        }

        if (target.id === "submitChangeRequestBtn" || target.closest("#submitChangeRequestBtn")) {
          const requestText = readChangeRequestText();
          if (!requestText) {
            setChangeRequestValidation("Write one change you want first.");
            return;
          }
          setChangeRequestValidation("");
          setLastSubmittedChangeRequest(requestText);
          setLastAppliedChangeRequest("");
          setMakerStarted(true);
          setMakerScreen("updating-draft");
          setOutput("Change request added.");
          return;
        }

        if (target.id === "backToFirstVersionAfterUpdateBtn") {
          setLastAppliedChangeRequest(lastSubmittedChangeRequest);
          setMakerScreen("first-version");
          return;
        }

        if (target.id === "backToDashboardBtn") {
          setMakerScreen("dashboard");
          return;
        }

        if (target.id === "closeExpertToolsBtn") {
          setExpertMode(false);
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
          setMakerStarted(true);
          setMakerScreen("dashboard");
          await runAction(target.id, "Analyze", async () => analyzeOperatorInput(quickCommand));
          return;
        }

        if (target.id === "aiAnalyzeBtn") {
          setMakerStarted(true);
          setMakerScreen("dashboard");
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
    const timelineEntries = buildTimeline(activityLog, operations, executionPlan, prodConfirmChecked);
    const timelineOutcome = computeOutcome(timelineEntries);
    if (expertMode) {
      return expertViewHtml({
        timelineEntries,
        timelineOutcome,
        expandedTimelineIds,
        doctorReport,
        status,
        hasJobs,
        operations,
        output,
        loading,
        availableMacros,
        capabilities,
        chatText,
        chatActions,
        chatEmptyMessage,
        instruction,
      });
    }
    if (makerScreen === "first-version") {
      return renderFirstVersionScreen({
        status,
        executionPlan,
        launchState,
        doctorReport,
        appliedChangeRequest: lastAppliedChangeRequest,
      });
    }
    if (makerScreen === "request-changes") {
      return renderChangeRequestScreen({ validationMessage: changeRequestValidation });
    }
    if (makerScreen === "updating-draft") {
      return renderUpdatingDraftScreen({ requestSummary: lastSubmittedChangeRequest });
    }
    return renderMakerDashboard({
      loading,
      executionPlan,
      status,
      launchState,
      launchProgress,
      launchStepStates,
      doctorReport,
      activityLog,
      makerStarted,
    });
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
    expertMode,
    makerStarted,
    makerScreen,
    changeRequestBackScreen,
    changeRequestValidation,
    lastSubmittedChangeRequest,
    lastAppliedChangeRequest,
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

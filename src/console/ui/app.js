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

// Keep source selection available as an optional path, not a default lock.
const FORCE_SOURCE_SELECTION = false;

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
  if (operation === "connect_database") return "Database connected";
  if (operation === "deploy_backend_functions") return "Backend functions deployed";
  if (operation === "prepare_preview") return "Preview deployed";
  if (operation === "make_app_live") return "Production deploy complete";
  if (operation === "show_logs") return "Deploy logs";
  if (operation === "run_repair") return "Deploy repair";
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
  if (type === "prepare_preview") return "Deploy a preview version you can test";
  if (type === "make_app_live") return "Deploy to production for real users";
  if (type === "connect_database") return "Connect database so the app can store data";
  if (type === "deploy_backend_functions") return "Deploy backend functions";
  if (type === "env_add") return "Add environment variable for service connection";
  if (type === "deploy_supabase_function") return "Deploy Supabase edge function";
  if (type === "show_logs") return "Show deploy logs";
  if (type === "run_repair") return "Diagnose and fix deploy errors";
  return "Run this setup step";
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
    subtitle: "Take one guided step and move closer to shipping.",
    buttonLabel: "Continue setup",
    loadingLabel: "Creating...",
  };
}

function makerStepOutcome(step) {
  const id = String(step?.id || "");
  if (id === "founderConnectDbBtn") return "Connect database";
  if (id === "founderDeployFunctionsBtn") return "Deploy backend functions";
  if (id === "founderPreviewBtn") return "Deploy preview";
  if (id === "founderLiveBtn") return "Ship to production";
  return String(step?.label || "Next step");
}

function makerStepResult(step) {
  const id = String(step?.id || "");
  if (id === "founderConnectDbBtn") return "Database is connected and configured.";
  if (id === "founderDeployFunctionsBtn") return "Backend functions are deployed and running.";
  if (id === "founderPreviewBtn") return "Preview deploy is live and ready to test.";
  if (id === "founderLiveBtn") return "Your project is live in production.";
  return "One step closer to shipping.";
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
      "Project checked and environment configured.",
      "Deployed to a live preview URL you can test.",
      "Ready for iteration — describe changes in plain language.",
    ];
  }
  if (projectType === "app") {
    return [
      "Dependencies checked and services connected.",
      "Deployed to a live preview URL you can test.",
      "Fix issues or request changes, then ship to production.",
    ];
  }
  return [
    "Project scanned and setup issues resolved.",
    "Deployed to a live preview URL you can verify.",
    "Iterate with change requests, then deploy to production.",
  ];
}

function previewIncludedList(projectType, ideaText) {
  const idea = String(ideaText || "").trim();
  const shortIdea = idea ? idea.replace(/^import\s+/i, "").replace(/^deploy\s+/i, "").replace(/^make\s+/i, "").replace(/^build\s+/i, "").slice(0, 64) : "";
  const isBooking = /\b(book|booking|appointment|reserve|reservation)\b/i.test(idea);
  if (isBooking) {
    return [
      shortIdea ? `Deployed: "${shortIdea}"` : "Project deployed to preview",
      "Environment configured and services connected",
      "Ready for testing and iteration",
    ];
  }
  if (projectType === "website") {
    return [
      shortIdea ? `Deployed: "${shortIdea}"` : "Site deployed to preview URL",
      "Environment and build configuration verified",
      "Ready for review and production deploy",
    ];
  }
  if (projectType === "app") {
    return [
      shortIdea ? `Deployed: "${shortIdea}"` : "App deployed to preview URL",
      "Dependencies installed and services connected",
      "Ready for testing, then ship to production",
    ];
  }
  return [
    shortIdea ? `Deployed: "${shortIdea}"` : "Project deployed to preview URL",
    "Setup verified and configuration applied",
    "Ready for review and production deploy",
  ];
}

function renderFallbackDraftArtifact(projectType, ideaText) {
  const headline = String(ideaText || "").trim()
    ? String(ideaText).replace(/^make\s+/i, "").replace(/^build\s+/i, "").slice(0, 72)
    : "Your project";
  const shimmerBar = (w) => `<div class="h-3 ${w} rounded-full bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 animate-pulse"></div>`;
  const sideModule = projectType === "app"
    ? `<div class="rounded-lg border border-emerald-200/70 bg-emerald-50/70 p-3 space-y-2">
        <div class="h-2.5 w-24 rounded-full bg-emerald-200/80 animate-pulse"></div>
        <div class="h-9 rounded-md bg-white border border-emerald-200/70 animate-pulse"></div>
      </div>`
    : `<div class="rounded-lg border border-sky-200/70 bg-sky-50/70 p-3 space-y-2">
        <div class="h-2.5 w-20 rounded-full bg-sky-200/80 animate-pulse"></div>
        <div class="h-9 rounded-md bg-white border border-sky-200/70 animate-pulse"></div>
      </div>`;

  return `
    <div class="relative min-h-[280px] rounded-xl border border-slate-200 bg-white p-4 overflow-hidden">
      <div class="rounded-lg border border-slate-200 bg-slate-50/70">
        <div class="flex items-center justify-between border-b border-slate-200 px-3 py-2">
          <div class="text-xs font-medium text-slate-500">Deploy preview</div>
          <div class="h-2 w-14 rounded-full bg-slate-200 animate-pulse"></div>
        </div>
        <div class="grid gap-3 p-3 md:grid-cols-[1fr_200px]">
          <div class="space-y-3">
            <div class="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
              <div class="text-xs text-slate-400 truncate">${escapeHtml(headline)}</div>
              ${shimmerBar("w-1/2")}
              ${shimmerBar("w-full")}
              ${shimmerBar("w-10/12")}
              <div class="h-10 rounded-md border border-emerald-200 bg-emerald-50/70 animate-pulse"></div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div class="h-16 rounded-lg border border-slate-200 bg-white animate-pulse"></div>
              <div class="h-16 rounded-lg border border-slate-200 bg-white animate-pulse"></div>
            </div>
          </div>
          ${sideModule}
        </div>
      </div>
      <div class="absolute inset-0 flex items-center justify-center">
        <div class="rounded-full bg-white/90 border border-slate-200 px-4 py-2 text-sm text-slate-600 shadow-sm flex items-center gap-2">
          <span class="h-2 w-2 rounded-full bg-sky-500 animate-pulse"></span>
          Deploying your project…
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
    ? "Your project will be ready to deploy."
    : allDone
      ? "All setup steps are complete. Ready to ship."
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

  const guidanceLine = environment.severity === "blocked"
    ? `<p class="mt-2 text-sm text-rose-800">One step needs your input before we continue.</p>`
    : environment.severity === "warning"
      ? `<p class="mt-2 text-sm text-amber-800">Almost there — one small detail still needs you.</p>`
      : "";

  return `
    <div class="rounded-2xl bg-white/80 p-5 border border-slate-200/70">
      <h2 class="text-lg font-semibold text-slate-900">${
        isSetupFirst
          ? "Setup needed before deploy"
          : allDone
            ? "Ready to deploy"
            : escapeHtml(makerStepOutcome(firstIncomplete))
      }</h2>
      ${isSetupFirst ? guidanceLine : ""}
      ${needsActionNow
        ? `<div class="mt-3">
          <button id="founderLaunchAppBtn" ${loading?.founderLaunchAppBtn ? "disabled" : ""} class="rounded-full bg-emerald-700 text-white px-5 py-2.5 text-sm font-semibold hover:bg-emerald-800 transition ${loading?.founderLaunchAppBtn ? "opacity-60 cursor-not-allowed" : ""}">${loading?.founderLaunchAppBtn ? nextAction.loadingLabel : nextAction.buttonLabel}</button>
        </div>`
        : ""}
      ${launchProgress
        ? `<p class="mt-2 text-sm text-slate-700">${escapeHtml(launchProgress)}</p>`
        : ""}
      ${remainingSteps.length > 0
        ? `<details class="mt-3 rounded-xl border border-slate-200/70 bg-white/70 p-3">
            <summary class="cursor-pointer text-xs font-medium text-slate-500">View all steps (${remainingSteps.length} left)</summary>
            <ul class="mt-2 space-y-1.5 text-xs">${rows}</ul>
          </details>`
        : ""}
      ${allDone && !isSetupFirst ? '<p class="mt-2 text-sm font-medium text-emerald-700">Ready to deploy</p>' : ""}
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
    if (raw === "node-backend") return "Node backend";
    if (raw === "static") return "Static site";
  }
  if (kind === "deploy") {
    if (raw === "vercel") return "Vercel";
    if (raw === "netlify") return "Netlify";
    if (raw === "cloudflare") return "Cloudflare";
  }
  if (kind === "database") {
    if (raw === "supabase") return "Supabase";
  }
  if (kind === "backend") {
    if (raw === "supabase-functions") return "Supabase functions";
  }
  return "Not detected";
}

function getInspectionFindings(status) {
  const direct = status?.inspectionFindings;
  if (direct && typeof direct === "object") {
    return direct;
  }
  const nested = status?.stack?.inspectionFindings;
  if (nested && typeof nested === "object") {
    return nested;
  }
  return null;
}

function renderInspectionFindingsSummary(status, sourceMode = "local") {
  const findings = getInspectionFindings(status);
  if (!findings) return "";
  const allGroups = [
    ...(Array.isArray(findings.stack) ? findings.stack : []),
    ...(Array.isArray(findings.providerHints) ? findings.providerHints : []),
    ...(Array.isArray(findings.serviceHints) ? findings.serviceHints : []),
    ...(Array.isArray(findings.operationalRequirements) ? findings.operationalRequirements : []),
  ];
  if (allGroups.length === 0) return "";

  const toFounderLine = (item) => {
    const label = String(item?.label || "").trim();
    const value = String(item?.value || "").trim();
    if (!value) return "";
    if (/framework/i.test(label)) return `This looks like ${value}.`;
    if (/deploy provider/i.test(label)) return `Deploy setup points to ${value}.`;
    if (/database|service/i.test(label)) return `Deplo found ${value} setup clues.`;
    if (/likely requirement/i.test(label)) return value;
    return value;
  };

  const confirmed = allGroups
    .filter((item) => String(item?.confidence || "") === "confirmed")
    .map(toFounderLine)
    .filter(Boolean)
    .slice(0, 3);
  const likely = allGroups
    .filter((item) => String(item?.confidence || "") === "likely")
    .map(toFounderLine)
    .filter(Boolean)
    .slice(0, 3);
  const notVerified = [
    ...(Array.isArray(findings.uncertainties) ? findings.uncertainties.map((item) => String(item?.value || "").trim()) : []),
  ].filter(Boolean).slice(0, 3);

  if (sourceMode === "github") {
    const githubBoundary = String(findings?.sourceLimitations?.githubOnly?.value || "GitHub-only mode cannot fully verify runtime readiness.");
    if (!notVerified.includes(githubBoundary)) {
      notVerified.unshift(githubBoundary);
    }
  }

  const section = (title, tone, lines) => {
    if (!Array.isArray(lines) || lines.length === 0) return "";
    return `
      <div class="rounded-lg border border-slate-200 bg-white px-3 py-3">
        <div class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}">${title}</div>
        <ul class="mt-2 space-y-1 text-sm text-slate-700">
          ${lines.map((line) => `<li>• ${escapeHtml(line)}</li>`).join("")}
        </ul>
      </div>
    `;
  };

  return `
    <section class="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 space-y-2">
      <div class="text-[11px] uppercase tracking-[0.12em] font-semibold text-slate-500">What Deplo found</div>
      ${section("Confirmed", "bg-emerald-100 text-emerald-800 border border-emerald-200", confirmed)}
      ${section("Likely", "bg-amber-100 text-amber-800 border border-amber-200", likely)}
      ${section("Not verified yet", "bg-slate-100 text-slate-700 border border-slate-200", notVerified)}
    </section>
  `;
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
        <h2 class="text-base font-semibold ${titleClass}">One step needs your input</h2>
        <span class="${badgeClass}">${badgeText}</span>
      </div>
      <ul class="mt-2 space-y-1 text-sm ${bodyClass}">${issueRows}</ul>
    </section>
  `;
}

function hasDetectedLocalProject(status) {
  const root = String(status?.project?.root || "").trim();
  const branch = String(status?.git?.branch || "").trim();
  const framework = String(status?.stack?.framework || "").trim();
  return Boolean(root || branch || framework);
}

function isGithubRepoUrl(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return /^https?:\/\/(?:www\.)?github\.com\/[^/\s]+\/[^/\s#?]+/i.test(text);
}

function parseGithubRepoIdentity(value) {
  const text = String(value || "").trim();
  const match = text.match(/^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  if (!match) {
    return { owner: "", repo: "", fullName: "", url: text };
  }
  const owner = String(match[1] || "").trim();
  const repo = String(match[2] || "").replace(/\.git$/i, "").trim();
  return {
    owner,
    repo,
    fullName: owner && repo ? `${owner}/${repo}` : repo || owner,
    url: text,
  };
}

function normalizeFounderBlockerText(message) {
  const raw = String(message || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower.includes("supabase login")) {
    return "Deplo still needs access to your database.";
  }
  if (lower.includes("supabase") && (lower.includes("auth") || lower.includes("access") || lower.includes("connection"))) {
    return "A database connection still needs to be set up.";
  }
  return raw;
}

function toRecommendedInputLine(text) {
  const raw = String(text || "").trim();
  if (!raw) return "One recommended setup step remains.";
  if (classifyInputSeverity(raw) === "recommended") {
    return `Recommended: ${raw}`;
  }
  return raw;
}

function classifyInputSeverity(message) {
  const lower = String(message || "").toLowerCase();
  if (!lower) return "required";
  if (
    lower.includes("may ")
    || lower.includes("if ")
    || lower.includes("optional")
    || lower.includes("recommended")
    || lower.includes("could ")
    || lower.includes("might ")
  ) {
    return "recommended";
  }
  return "required";
}

function inferRemainingInputActionLabel(doctorReport) {
  const issues = Array.isArray(doctorReport?.issues) ? doctorReport.issues : [];
  const topIssue = normalizeFounderBlockerText(String(issues[0]?.message || "").trim());
  const lower = topIssue.toLowerCase();
  if (lower.includes("database") || lower.includes("supabase")) return "Fix remaining database access";
  if (lower.includes("env")) return "Add remaining settings";
  if (lower.includes("auth")) return "Fix remaining access setup";
  if (lower.includes("deploy")) return "Fix remaining deploy setup";
  if (topIssue) return "Fix remaining setup input";
  return "Review remaining input";
}

function renderOnboardingScreen(status, localProjectDetectedOverride = null) {
  const localProjectDetected = typeof localProjectDetectedOverride === "boolean"
    ? localProjectDetectedOverride
    : hasDetectedLocalProject(status);
  const projectName = resolveProjectName(status);
  const showProjectName = isUserFacingProjectName(projectName);
  return `
    <div class="max-w-2xl mx-auto space-y-6">
      <div class="text-center space-y-2 pt-4">
        <h1 class="text-2xl font-semibold text-slate-900">Where is your project?</h1>
        <p class="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">Choose how Deplo should start.</p>
      </div>

      <div class="space-y-3">
        <article ${localProjectDetected ? 'data-onboarding-action="startScanBtn" role="button" tabindex="0"' : ""} class="w-full rounded-2xl border ${localProjectDetected ? "border-emerald-200 bg-emerald-50/70 hover:border-emerald-300 hover:shadow-md group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300" : "border-slate-200 bg-slate-50/60 opacity-90"} p-5 text-left shadow-sm transition">
          <div class="flex items-start gap-4">
            <div class="flex-shrink-0 mt-0.5 h-10 w-10 rounded-xl ${localProjectDetected ? "bg-white border border-emerald-200 text-emerald-700" : "bg-white border border-slate-200 text-slate-400"} flex items-center justify-center text-lg">→</div>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <div class="text-base font-semibold ${localProjectDetected ? "text-slate-900 group-hover:text-emerald-800" : "text-slate-700"} transition">Use current folder</div>
                ${localProjectDetected ? '<span class="rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">Detected here</span>' : ""}
              </div>
              <p class="mt-1 text-sm ${localProjectDetected ? "text-slate-600" : "text-slate-500"} leading-relaxed">
                ${localProjectDetected
      ? (showProjectName ? `${escapeHtml(projectName)} is ready.` : "Project detected in this folder.")
      : "No local project detected yet."}
              </p>
              <div class="mt-3">
                <button id="startScanBtn" ${localProjectDetected ? "" : "disabled"} class="rounded-full ${localProjectDetected ? "bg-emerald-700 text-white hover:bg-emerald-800" : "border border-slate-300 bg-white text-slate-400 cursor-not-allowed"} px-4 py-2 text-xs font-semibold transition">Use current folder</button>
              </div>
            </div>
          </div>
        </article>

        <article data-onboarding-action="startGithubBtn" role="button" tabindex="0" class="w-full rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-slate-300 hover:shadow-md transition group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300">
          <div class="flex items-start gap-4">
            <div class="flex-shrink-0 mt-0.5 h-10 w-10 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-600 text-lg">
              <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            </div>
            <div class="min-w-0">
              <div class="text-base font-semibold text-slate-900 group-hover:text-slate-700 transition">Import from GitHub</div>
              <p class="mt-1 text-sm text-slate-500 leading-relaxed">Paste a repo URL to continue.</p>
              <div class="mt-3">
                <button id="startGithubBtn" class="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">Import from GitHub</button>
              </div>
            </div>
          </div>
        </article>

        <article data-onboarding-action="startSampleBtn" role="button" tabindex="0" class="w-full rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-slate-300 hover:shadow-md transition group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300">
          <div class="flex items-start gap-4">
            <div class="flex-shrink-0 mt-0.5 h-10 w-10 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500 text-lg">◇</div>
            <div class="min-w-0">
              <div class="text-base font-semibold text-slate-900 group-hover:text-slate-700 transition">Try a sample project</div>
              <p class="mt-1 text-sm text-slate-500 leading-relaxed">See a simulated Deplo flow.</p>
              <div class="mt-3">
                <button id="startSampleBtn" class="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">Try a sample project</button>
              </div>
            </div>
          </div>
        </article>
      </div>
    </div>
  `;
}

function diagnosisCheckIcon(status) {
  if (status === "ok") return '<span class="text-emerald-600">✓</span>';
  if (status === "warn") return '<span class="text-amber-600">⚠</span>';
  if (status === "blocker") return '<span class="text-rose-600">✗</span>';
  return '<span class="text-slate-400">○</span>';
}

function diagnosisCheckRowClass(status) {
  if (status === "ok") return "border-emerald-100 bg-emerald-50/50";
  if (status === "warn") return "border-amber-100 bg-amber-50/50";
  if (status === "blocker") return "border-rose-100 bg-rose-50/50";
  return "border-slate-100 bg-slate-50/50";
}

function resolveDiagnosisCopyFromProof({
  proof,
  isScanning,
  hasAutofix,
  topIssue,
  firstMissingStep,
  okChecks,
  totalChecks,
}) {
  if (isScanning) {
    return {
      statusTone: "border-sky-200 bg-sky-50 text-sky-800",
      statusLabel: "Checking",
      statusLine: "Deplo is checking this project now.",
      deploFoundLine: "Deplo is inspecting project structure, setup, and deploy readiness.",
      readyLine: "Checking your project structure and required connections.",
      blockerTitle: "Current focus",
      blockerLine: "Checking deployment setup, data connection, and required settings.",
      deploCanDo: "As soon as checks finish, Deplo will recommend one clear next step.",
      needsInput: "No input needed yet.",
      expectedOutcome: "When checks finish, Deplo will show what to do next.",
    };
  }

  const baseBlocker = topIssue
    || (firstMissingStep ? `${makerStepOutcome(firstMissingStep)} is still required.` : "No blocker detected.");
  const recommendedBlockerLine = toRecommendedInputLine(baseBlocker, proof?.remainingInputSeverity);
  const readyChecksLine = totalChecks > 0
    ? `${okChecks} of ${totalChecks} checks are already in place.`
    : "Core project checks are available.";

  const variants = {
    no_proof_yet: {
      statusTone: proof?.hasBlockingInput ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-800",
      statusLabel: "Not yet proven",
      statusLine: "No deploy proof URL is available yet.",
      deploFoundLine: proof?.hasBlockingInput
        ? "Deplo found one setup issue before proof can be confirmed."
        : "Deplo finished checks and can move to deploy proof next.",
      readyLine: readyChecksLine,
      blockerTitle: proof?.hasBlockingInput ? "What still needs input" : "Current focus",
      blockerLine: proof?.hasBlockingInput ? recommendedBlockerLine : "Deploy proof is the next step.",
      deploCanDo: proof?.hasBlockingInput
        ? (hasAutofix ? "Deplo can apply a safe fix and then recheck proof." : "Deplo can guide the required setup and then continue.")
        : "Deplo can prepare deploy proof next.",
      needsInput: proof?.hasBlockingInput
        ? (proof?.remainingInputSeverity === "recommended"
            ? "One recommended setup step remains."
            : "One required setup step remains.")
        : "No blocker input is required right now.",
      expectedOutcome: proof?.hasBlockingInput
        ? "After this, Deplo can continue toward deploy proof."
        : "After this, you'll get a preview URL for review.",
    },
    preview_ready: {
      statusTone: "border-sky-200 bg-sky-50 text-sky-900",
      statusLabel: "Preview",
      statusLine: "A preview is available and ready for review.",
      deploFoundLine: "Deplo verified a preview-ready state for this project.",
      readyLine: readyChecksLine,
      blockerTitle: "What still needs input",
      blockerLine: "No required setup input right now.",
      deploCanDo: "Deplo can keep iterating, then redeploy when you're ready.",
      needsInput: "No blocking input is needed right now.",
      expectedOutcome: "Review the preview, request changes, or move toward live readiness.",
    },
    preview_needs_input: {
      statusTone: "border-amber-200 bg-amber-50 text-amber-900",
      statusLabel: "Preview · Needs one input",
      statusLine: "Preview is available, with one remaining setup detail.",
      deploFoundLine: "Deplo confirmed preview proof, with one remaining setup detail.",
      readyLine: readyChecksLine,
      blockerTitle: "One thing still needs your input",
      blockerLine: recommendedBlockerLine,
      deploCanDo: hasAutofix
        ? "Deplo can apply a safe fix and then recheck preview readiness."
        : "Deplo can guide the remaining setup and then continue.",
      needsInput: proof?.remainingInputSeverity === "recommended"
        ? "One recommended setup step remains for fuller access."
        : "One required setup step remains before full readiness.",
      expectedOutcome: "After this, Deplo can redeploy and confirm full readiness.",
    },
    live_needs_input: {
      statusTone: "border-amber-200 bg-amber-50 text-amber-900",
      statusLabel: "Live · Needs one input",
      statusLine: "Your app is live, with one remaining setup detail.",
      deploFoundLine: "Deplo confirmed a live deploy URL for this project.",
      readyLine: readyChecksLine,
      blockerTitle: "One thing still needs your input",
      blockerLine: recommendedBlockerLine,
      deploCanDo: hasAutofix
        ? "Deplo can apply a safe fix and then recheck full readiness."
        : "Deplo can guide the final setup step while keeping the app live.",
      needsInput: proof?.remainingInputSeverity === "recommended"
        ? "One recommended setup step remains for full access."
        : "One required setup step remains for full readiness.",
      expectedOutcome: "After this, your live app will be fully configured.",
    },
    live_stable: {
      statusTone: "border-emerald-200 bg-emerald-50 text-emerald-900",
      statusLabel: "Live",
      statusLine: "Your app is live and operationally ready.",
      deploFoundLine: "Deplo confirmed live deploy proof and setup readiness.",
      readyLine: readyChecksLine,
      blockerTitle: "What still needs input",
      blockerLine: "No required setup input right now.",
      deploCanDo: "Deplo can support iterative fixes and redeploys as you keep building.",
      needsInput: "No blocking input is needed right now.",
      expectedOutcome: "Open your live app, keep improving it, and redeploy when needed.",
    },
  };

  return variants[String(proof?.variant || "no_proof_yet")] || variants.no_proof_yet;
}

function resolveFounderPriority({ proof, isScanning }) {
  if (isScanning) {
    return {
      label: "In progress",
      tone: "bg-sky-100 text-sky-800 border border-sky-200",
      guidance: "Deplo is checking this project now.",
    };
  }
  if (!proof?.hasBlockingInput) {
    return {
      label: "Optional / later",
      tone: "bg-emerald-100 text-emerald-800 border border-emerald-200",
      guidance: "No urgent setup issue is blocking progress right now.",
    };
  }
  const isLiveApp = proof?.variant === "live_needs_input" || proof?.variant === "live_stable";
  if (proof?.remainingInputSeverity === "recommended" || isLiveApp) {
    return {
      label: isLiveApp ? "Recommended" : "Recommended next",
      tone: "bg-amber-100 text-amber-800 border border-amber-200",
      guidance: isLiveApp
        ? "Your app is live. One setup detail remains for full readiness."
        : "One recommended setup step remains for fuller readiness.",
    };
  }
  return {
    label: "Must fix now",
    tone: "bg-rose-100 text-rose-800 border border-rose-200",
    guidance: "One required setup step is blocking full readiness.",
  };
}

function resolveFounderMissionControlModel({ proof, copy, priority, isScanning }) {
  const variant = String(proof?.variant || "no_proof_yet");
  const heroHeadline = isScanning
    ? "Deplo is checking your app now"
    : variant === "live_stable"
      ? "Your app is live"
      : variant === "live_needs_input"
        ? "Your app is live, with one setup step remaining"
        : variant === "preview_ready"
          ? "Your app is ready for preview review"
          : variant === "preview_needs_input"
            ? "Your app has a preview, with one setup step remaining"
            : "Deplo has not proven this app yet";
  const heroSummary = String(copy?.statusLine || "").trim() || String(proof?.founderMessage || "").trim();
  const whatMattersNow = String(copy?.blockerLine || "").trim() || "No blocker detected.";
  const deploCanDo = String(copy?.deploCanDo || "").trim() || "Deplo can guide the next step.";
  const needsInput = String(copy?.needsInput || "").trim() || "Follow the next recommended action.";
  const nextPayoff = String(copy?.expectedOutcome || "").trim() || "Deplo will verify the result after this step.";
  const nextActionLine = isScanning
    ? "Wait for the check to finish."
    : (variant === "live_needs_input" && String(proof?.primaryAction?.id || "") === "openFirstVersionExternalBtn")
      ? "Open your live app now, then fix the remaining setup step."
      : proof?.primaryAction?.label
        ? `${String(proof.primaryAction.label)}.`
        : needsInput;
  return {
    heroHeadline,
    heroSummary,
    priorityLabel: String(priority?.label || "Recommended next"),
    priorityTone: String(priority?.tone || "bg-slate-100 text-slate-700 border border-slate-200"),
    priorityGuidance: String(priority?.guidance || "Follow the next recommended action."),
    whatMattersNow,
    deploCanDo,
    needsInput: nextActionLine,
    nextPayoff,
  };
}

function toFounderIssueTitle(raw, context = {}) {
  const text = normalizeFounderBlockerText(String(raw || "").trim());
  if (!text) return "";
  const lowered = text.toLowerCase();
  if (context.sourceMode === "github") {
    return "Deplo needs local access to fully check whether this app can run.";
  }
  if (lowered.includes("supabase login") || lowered.includes("supabase")) {
    return "Database access still needs confirmation.";
  }
  if (lowered.includes("environment") || lowered.includes("env var")) {
    return "A required environment variable is still missing.";
  }
  if (lowered.includes("vercel login") || lowered.includes("login expired") || lowered.includes("not logged into vercel")) {
    return "Deploy platform access needs refresh.";
  }
  return text;
}

function renderIssueSeverityBadge(severity) {
  const map = {
    must_fix_now: { label: "Must fix now", tone: "bg-rose-100 text-rose-800 border border-rose-200" },
    recommended_next: { label: "Recommended next", tone: "bg-amber-100 text-amber-800 border border-amber-200" },
    optional_later: { label: "Optional / later", tone: "bg-emerald-100 text-emerald-800 border border-emerald-200" },
  };
  const resolved = map[String(severity || "recommended_next")] || map.recommended_next;
  return `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${resolved.tone}">${resolved.label}</span>`;
}

function renderIssueOwnerLine(owner) {
  const labels = {
    deplo: "Owner: Deplo",
    user: "Owner: You",
    shared: "Owner: Shared",
  };
  return labels[String(owner || "shared")] || labels.shared;
}

function renderIssueActionabilityLine(actionability) {
  const labels = {
    auto_fixable: "Deplo can do this now.",
    confirm_to_run: "Deplo can run this after your confirmation.",
    user_input_needed: "Deplo needs one thing from you.",
    cannot_verify_yet: "Deplo cannot fully verify this yet.",
    auto_fix: "Deplo can do this now.",
    guided: "Deplo can guide this step by step.",
    requires_input: "Deplo needs one thing from you.",
  };
  return labels[String(actionability || "guided")] || labels.guided;
}

function renderIssueVerificationState(state) {
  const map = {
    not_checked: { label: "Not checked", tone: "bg-slate-100 text-slate-700 border border-slate-200" },
    ready_to_run: { label: "Ready to run", tone: "bg-sky-100 text-sky-800 border border-sky-200" },
    needs_input: { label: "Needs your input", tone: "bg-amber-100 text-amber-800 border border-amber-200" },
    running: { label: "Running", tone: "bg-sky-100 text-sky-800 border border-sky-200" },
    fixed: { label: "Fixed", tone: "bg-emerald-100 text-emerald-800 border border-emerald-200" },
    verified: { label: "Verified", tone: "bg-emerald-100 text-emerald-800 border border-emerald-200" },
    could_not_verify_yet: { label: "Could not verify yet", tone: "bg-slate-100 text-slate-700 border border-slate-200" },
  };
  const resolved = map[String(state || "not_checked")] || map.not_checked;
  return `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${resolved.tone}">${resolved.label}</span>`;
}

function renderActionStateChip(state) {
  const map = {
    detected: { label: "Detected", tone: "bg-slate-100 text-slate-700 border border-slate-200" },
    ready: { label: "Ready", tone: "bg-sky-100 text-sky-800 border border-sky-200" },
    ready_to_run: { label: "Ready", tone: "bg-sky-100 text-sky-800 border border-sky-200" },
    needs_confirmation: { label: "Needs confirmation", tone: "bg-amber-100 text-amber-800 border border-amber-200" },
    needs_input: { label: "Needs your input", tone: "bg-amber-100 text-amber-800 border border-amber-200" },
    running: { label: "Running", tone: "bg-sky-100 text-sky-800 border border-sky-200" },
    done_waiting_for_verification: { label: "Done, verifying", tone: "bg-sky-100 text-sky-800 border border-sky-200" },
    done: { label: "Done", tone: "bg-emerald-100 text-emerald-800 border border-emerald-200" },
    verified: { label: "Verified", tone: "bg-emerald-100 text-emerald-800 border border-emerald-200" },
    failed: { label: "Failed", tone: "bg-rose-100 text-rose-800 border border-rose-200" },
    blocked: { label: "Blocked", tone: "bg-rose-100 text-rose-800 border border-rose-200" },
    cannot_verify_yet: { label: "Cannot verify yet", tone: "bg-slate-100 text-slate-700 border border-slate-200" },
    cannot_continue_yet: { label: "Cannot continue yet", tone: "bg-slate-100 text-slate-700 border border-slate-200" },
    not_checked: { label: "Not checked", tone: "bg-slate-100 text-slate-700 border border-slate-200" },
  };
  const resolved = map[String(state || "not_checked")] || map.not_checked;
  return `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${resolved.tone}">${resolved.label}</span>`;
}

function renderActionBoundaryLine(actionability, owner) {
  const actionabilityLine = {
    auto_fixable: "Deplo can do this now.",
    confirm_then_run: "Deplo can run this after your confirmation.",
    confirm_to_run: "Deplo can run this after your confirmation.",
    user_input_needed: "Deplo needs one thing from you first.",
    cannot_verify_yet: "Deplo cannot verify this from the current source yet.",
    auto_fix: "Deplo can do this now.",
    requires_input: "Deplo needs one thing from you first.",
    guided: "Deplo can guide this step by step.",
  }[String(actionability || "guided")] || "Deplo can guide this step by step.";
  const ownerLine = renderIssueOwnerLine(owner);
  return `${ownerLine} · ${actionabilityLine}`;
}

function renderVerificationLine(verificationPlan, verificationResult, state) {
  const plan = String(verificationPlan || "").trim() || "Deplo verifies the result after this step.";
  const result = String(verificationResult || "").trim();
  const prefix = state === "verified"
    ? "Verification"
    : state === "partially_verified"
      ? "Partially verified"
      : state === "not_verified"
        ? "Not verified yet"
        : state === "verification_failed"
          ? "Verification failed"
    : state === "failed"
      ? "Verification failed"
      : state === "running"
        ? "Verification in progress"
        : "Verification plan";
  return `${prefix}: ${result || plan}`;
}

function resolveResumeLabel(action = {}, continuity = null) {
  const actionability = String(action?.actionability || "");
  const runMode = String(action?.runMode || "");
  const verificationStatus = String(action?.verificationStatus || "");
  const target = String(action?.verificationTarget || action?.target || "");
  const executionState = String(action?.executionState || action?.state || "");
  const waitingOnUser = Boolean(continuity?.waitingOnUser);
  const waitingOnVerification = Boolean(continuity?.waitingOnVerification);

  if (runMode === "deplo_can_run_after_confirmation") return "Approve and continue";
  if (runMode === "deplo_cannot_continue_yet") return "Add input, then continue";
  if (runMode === "user_must_do_manual_step") return "Continue recovery with Deplo";
  if (runMode === "deplo_can_verify_after_manual_step") return "Verify with Deplo";
  if (runMode === "deplo_can_run_now") return "Run check with Deplo";

  if (verificationStatus === "verification_failed" || executionState === "failed" || executionState === "blocked") {
    return "Re-check after fix";
  }
  if (waitingOnVerification || executionState === "done_waiting_for_verification" || verificationStatus === "partially_verified" || target === "live_url") {
    return "Resume verification";
  }
  if (
    waitingOnUser
    || executionState === "needs_input"
    || executionState === "needs_confirmation"
    || executionState === "cannot_continue_yet"
    || actionability === "user_input_needed"
    || actionability === "cannot_verify_yet"
  ) {
    return "Continue after input";
  }
  return "Continue with Deplo";
}

function resolveOperatorCtaPresentation(actionUnit = {}, continuity = null, evidence = null) {
  const runMode = String(actionUnit?.runMode || "");
  const verificationStatus = String(actionUnit?.verificationStatus || evidence?.status || "");
  const fallbackLabel = resolveResumeLabel(actionUnit, continuity);
  const verificationPlan = String(actionUnit?.verificationPlan || "").trim();
  const expectedOutcome = String(actionUnit?.expectedOutcome || "").trim();
  const target = String(actionUnit?.providerContext?.verificationTarget || actionUnit?.target || "");

  const supportByRunMode = {
    deplo_can_run_now: verificationPlan || "Deplo will run this check and update the result.",
    deplo_can_run_after_confirmation: verificationPlan || "Confirm and Deplo will continue this operation.",
    user_must_do_manual_step: "Complete this manual step, then Deplo will continue automatically.",
    deplo_can_verify_after_manual_step: verificationPlan || "Deplo will verify this right after you continue.",
    deplo_cannot_continue_yet: "Deplo cannot continue until required access or input is provided.",
  };
  const supportByTarget = target === "live_url"
    ? "Deplo will verify whether the live app is reachable."
    : target === "deploy_status"
      ? "Deplo will re-check deploy access and update the result."
      : target === "database_features"
        ? "Deplo will verify database-backed features after this step."
        : "Deplo will continue setup and verify runtime state.";

  const approvalState = runMode === "deplo_can_run_after_confirmation"
    ? "awaiting_approval"
    : runMode === "deplo_can_run_now"
      ? "ready_to_run"
      : runMode === "deplo_cannot_continue_yet"
        ? "blocked_on_input"
        : "none";

  const primaryLabel = String(actionUnit?.operatorPrimaryLabel || actionUnit?.primaryAction?.label || fallbackLabel || "Continue with Deplo");
  const supportLine = String(actionUnit?.operatorSupportLine || supportByRunMode[runMode] || supportByTarget || expectedOutcome);
  const tone = (runMode === "deplo_can_run_now" || runMode === "deplo_can_run_after_confirmation" || runMode === "deplo_can_verify_after_manual_step")
    ? "operator_primary"
    : "operator_secondary";
  const retryLabel = verificationStatus === "verification_failed" ? "Retry with Deplo" : primaryLabel;

  return {
    primaryLabel: retryLabel,
    supportLine,
    tone,
    approvalState,
  };
}

function normalizeRecoveryInstruction({ instruction = "", command = "" }) {
  const trimmedCommand = String(command || "").trim();
  if (trimmedCommand) {
    return `Run \`${trimmedCommand}\` in your terminal, then click Continue below.`;
  }
  const text = String(instruction || "").trim();
  return text || "Complete this setup step, then continue with Deplo.";
}

function resolveMissingInputType(rawText, sourceMode, hasConnectedRepo = false) {
  const lower = String(rawText || "").toLowerCase();
  if (sourceMode === "github" && hasConnectedRepo) return "local_access_required";
  if (lower.includes("env") || lower.includes("environment") || lower.includes("key")) return "environment_variable";
  if (lower.includes("supabase") || lower.includes("database")) return "database_connection";
  if (lower.includes("vercel") || lower.includes("login") || lower.includes("auth") || lower.includes("access")) return "provider_access";
  if (lower.includes("deploy") || lower.includes("production") || lower.includes("confirm")) return "deploy_confirmation";
  if (lower.includes("project ref") || lower.includes("identifier") || lower.includes("repo")) return "service_identifier";
  return "service_identifier";
}

function resolveProviderOperationContext({ inspectionFindings, proof, doctorReport, projectSource }) {
  const sourceMode = String(projectSource?.mode || "local");
  const providerHints = Array.isArray(inspectionFindings?.providerHints) ? inspectionFindings.providerHints : [];
  const serviceHints = Array.isArray(inspectionFindings?.serviceHints) ? inspectionFindings.serviceHints : [];
  const requirements = Array.isArray(inspectionFindings?.operationalRequirements) ? inspectionFindings.operationalRequirements : [];
  const issues = Array.isArray(doctorReport?.issues) ? doctorReport.issues : [];
  const issueText = String(issues[0]?.message || "").toLowerCase();

  const pickByKeyword = (items, keyword, fallback = "not_verified") => {
    const hit = items.find((item) => String(item?.value || "").toLowerCase().includes(keyword));
    return {
      found: Boolean(hit),
      confidence: String(hit?.confidence || fallback),
      evidence: Array.isArray(hit?.evidence) ? hit.evidence.filter(Boolean) : [],
    };
  };

  const vercel = pickByKeyword(providerHints, "vercel");
  const netlify = pickByKeyword(providerHints, "netlify");
  const cloudflare = pickByKeyword(providerHints, "cloudflare");
  const supabase = pickByKeyword(serviceHints, "supabase");
  const prisma = pickByKeyword(serviceHints, "prisma");
  const drizzle = pickByKeyword(serviceHints, "drizzle");

  const deployProvider = vercel.found
    ? "vercel"
    : netlify.found
      ? "netlify"
      : cloudflare.found
        ? "cloudflare"
        : "unknown";
  const deployProviderConfidence = deployProvider === "vercel"
    ? vercel.confidence
    : deployProvider === "netlify"
      ? netlify.confidence
      : deployProvider === "cloudflare"
        ? cloudflare.confidence
        : "not_verified";
  const serviceProvider = supabase.found
    ? "supabase"
    : prisma.found
      ? "prisma"
      : drizzle.found
        ? "drizzle"
        : "unknown";
  const serviceProviderConfidence = serviceProvider === "supabase"
    ? supabase.confidence
    : serviceProvider === "prisma"
      ? prisma.confidence
      : serviceProvider === "drizzle"
        ? drizzle.confidence
        : "not_verified";

  const hasEnvRequirement = requirements.some((item) => /environment|env/i.test(String(item?.value || "")));
  const hasDeployRequirement = requirements.some((item) => /deploy/i.test(String(item?.value || "")));
  const hasRuntimeRequirement = requirements.some((item) => /runtime|build/i.test(String(item?.value || "")));
  const proofVariant = String(proof?.variant || "no_proof_yet");

  let accessNeeds = "runtime_verify";
  if (sourceMode === "github") accessNeeds = "local_access";
  else if (/login|auth|access|vercel/i.test(issueText)) accessNeeds = "deploy_access";
  else if (/database|supabase|prisma|drizzle/i.test(issueText)) accessNeeds = "database_access";
  else if (/env|environment|key/i.test(issueText) || hasEnvRequirement) accessNeeds = "env_input";
  else if (hasDeployRequirement) accessNeeds = "deploy_access";
  else if (hasRuntimeRequirement) accessNeeds = "runtime_verify";

  const verificationTarget = proofVariant.startsWith("live_")
    ? "live_url"
    : accessNeeds === "database_access"
      ? "database_features"
      : accessNeeds === "deploy_access"
        ? "deploy_status"
        : "runtime_readiness";

  const providerEvidence = [
    ...(deployProvider === "vercel" ? vercel.evidence : []),
    ...(deployProvider === "netlify" ? netlify.evidence : []),
    ...(deployProvider === "cloudflare" ? cloudflare.evidence : []),
    ...(serviceProvider === "supabase" ? supabase.evidence : []),
    ...(serviceProvider === "prisma" ? prisma.evidence : []),
    ...(serviceProvider === "drizzle" ? drizzle.evidence : []),
  ];

  return {
    deployProvider,
    deployProviderConfidence,
    serviceProvider,
    serviceProviderConfidence,
    accessNeeds,
    verificationTarget,
    providerEvidence: providerEvidence.filter(Boolean),
  };
}

function resolveFounderRecoveryUnits({ actions, doctorReport, proof, projectSource, loading, evidenceUnits }) {
  const units = Array.isArray(actions)
    ? actions.filter((action) => action && action.missingInput && typeof action.missingInput === "object")
    : [];
  const manualDoctorActions = Array.isArray(doctorReport?.actions)
    ? doctorReport.actions.filter((item) => String(item?.type || "") === "manual")
    : [];
  const evidenceByTarget = new Map(
    (Array.isArray(evidenceUnits) ? evidenceUnits : []).map((item) => [String(item?.target || ""), item]),
  );
  const pickManualAction = (actionUnit) => {
    if (manualDoctorActions.length === 0) return null;
    const missing = actionUnit?.missingInput || {};
    const hay = `${String(missing.title || "")} ${String(missing.explanation || "")} ${String(actionUnit?.title || "")}`.toLowerCase();
    const best = manualDoctorActions.find((item) => {
      const text = `${String(item?.label || "")} ${String(item?.description || "")} ${String(item?.command || "")}`.toLowerCase();
      if (!text) return false;
      if (/vercel/.test(hay) && /vercel/.test(text)) return true;
      if (/supabase|database/.test(hay) && /supabase|database/.test(text)) return true;
      if (/env|environment|key/.test(hay) && /env|environment|key/.test(text)) return true;
      if (/local|inspect|scan/.test(hay) && /local|inspect|scan/.test(text)) return true;
      return false;
    });
    return best || manualDoctorActions[0] || null;
  };
  const toMode = (actionUnit, manualAction) => {
    const actionability = String(actionUnit?.actionability || "");
    if (actionability === "auto_fixable") return "autofix";
    if (actionability === "confirm_to_run") return "confirm_then_run";
    if (actionability === "cannot_verify_yet") return "cannot_continue_yet";
    if (manualAction?.command || actionability === "user_input_needed") return "manual";
    return "manual";
  };
  return units.map((actionUnit) => {
    const missing = actionUnit.missingInput || {};
    const manualAction = pickManualAction(actionUnit);
    const target = String(actionUnit?.providerContext?.verificationTarget || "runtime_readiness");
    const evidence = evidenceByTarget.get(target) || null;
    const resolutionMode = toMode(actionUnit, manualAction);
    const recoveryCommand = String(missing.recoveryCommand || manualAction?.command || "").trim();
    const recoveryInstruction = normalizeRecoveryInstruction({
      instruction: String(missing.recoveryInstruction || manualAction?.description || manualAction?.label || missing.explanation || "Complete this setup step, then continue."),
      command: recoveryCommand,
    });
    const continueLabel = String(missing?.continueAction?.label || actionUnit?.resumeActionLabel || resolveResumeLabel(actionUnit));
    const continueAction = missing.continueAction && missing.continueAction.id
      ? { ...missing.continueAction, label: continueLabel }
      : actionUnit.nextStepIfIncomplete && actionUnit.nextStepIfIncomplete.id
        ? { ...actionUnit.nextStepIfIncomplete, label: continueLabel }
        : null;
    return {
      id: String(actionUnit?.id || "recovery-unit"),
      title: String(missing.title || actionUnit?.title || "Input needed"),
      severity: String(missing.severity || "recommended"),
      owner: String(missing.owner || actionUnit?.owner || "shared"),
      actionability: String(actionUnit?.actionability || "user_input_needed"),
      whatYouNeedToDo: String(missing.title || actionUnit?.title || "Complete required setup"),
      howToResolve: {
        instruction: recoveryInstruction,
        command: recoveryCommand,
      },
      resolutionMode,
      captureAction: missing.captureAction || actionUnit.primaryAction || null,
      continueAction,
      afterResolution: String(missing.whatDeploCanDoAfter || actionUnit.expectedOutcome || "Deplo will continue from this step."),
      verificationAfter: String(actionUnit.verificationPlan || evidence?.evidenceSummary || "Deplo verifies this after the step."),
      blockedUntil: String(missing.whyItMatters || actionUnit.blockedReason || ""),
      doctorActionRef: manualAction
        ? {
            id: String(manualAction?.id || ""),
            label: String(manualAction?.label || manualAction?.description || ""),
            command: String(manualAction?.command || ""),
          }
        : null,
      recoveryCommandCopyable: Boolean(recoveryCommand),
      verificationState: String(missing.verificationState || actionUnit?.state || "needs_input"),
      providerContextLine: String(missing.providerContextLine || ""),
    };
  });
}

function renderMissingInputFlow({ actions, recoveryUnits = null, loading, expanded = false }) {
  const units = Array.isArray(recoveryUnits)
    ? recoveryUnits
    : (Array.isArray(actions)
      ? actions
          .filter((action) => action && action.missingInput && typeof action.missingInput === "object")
          .map((action) => ({ ...action, missingInput: action.missingInput }))
      : []);
  if (units.length === 0) return "";

  const severityOrder = ["required", "recommended", "optional"];
  const grouped = {
    required: units.filter((item) => String(item?.severity || item?.missingInput?.severity || "") === "required"),
    recommended: units.filter((item) => String(item?.severity || item?.missingInput?.severity || "") === "recommended"),
    optional: units.filter((item) => String(item?.severity || item?.missingInput?.severity || "") === "optional"),
  };
  const labels = {
    required: "Required now",
    recommended: "Recommended next",
    optional: "Optional later",
  };
  const tones = {
    required: "bg-rose-100 text-rose-800 border border-rose-200",
    recommended: "bg-amber-100 text-amber-800 border border-amber-200",
    optional: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  };

  const groupsHtml = severityOrder.map((level) => {
    const list = grouped[level];
    if (!list || list.length === 0) return "";
    return `
      <section class="rounded-lg border border-slate-200 bg-white px-3 py-3 space-y-2">
        <div class="text-[11px] uppercase tracking-[0.12em] font-semibold text-slate-500">${labels[level]}</div>
        ${list.map((item) => {
          const missing = item.missingInput || {};
          const captureAction = item.captureAction || missing.captureAction || item.primaryAction;
          const continueAction = item.continueAction || missing.continueAction || item.secondaryAction;
          const captureBusy = Boolean(captureAction?.id && loading?.[captureAction.id]);
          const continueBusy = Boolean(continueAction?.id && loading?.[continueAction.id]);
          const verificationState = String(item.verificationState || missing.verificationState || item.state || "needs_input");
          const whatYouNeedToDo = String(item.whatYouNeedToDo || missing.title || item.title || "Input needed");
          const recoveryCommand = String(item?.howToResolve?.command || missing.recoveryCommand || "").trim();
          const recoveryInstruction = normalizeRecoveryInstruction({
            instruction: String(item?.howToResolve?.instruction || missing.recoveryInstruction || missing.explanation || "Complete this setup step."),
            command: recoveryCommand,
          });
          const resolutionMode = String(item.resolutionMode || missing.recoveryMode || "");
          const resolutionModeLine = resolutionMode === "autofix"
            ? "Deplo can do this automatically."
            : resolutionMode === "confirm_then_run"
              ? "Deplo can run this after your confirmation."
              : resolutionMode === "cannot_continue_yet"
                ? "Deplo cannot continue until this is resolved."
                : "You need to do this manually, then Deplo can continue.";
          const captureOperator = resolveOperatorCtaPresentation({
            runMode: resolutionMode === "autofix"
              ? "deplo_can_run_now"
              : resolutionMode === "confirm_then_run"
                ? "deplo_can_run_after_confirmation"
                : resolutionMode === "cannot_continue_yet"
                  ? "deplo_cannot_continue_yet"
                  : "user_must_do_manual_step",
            primaryAction: captureAction,
            verificationPlan: String(item.verificationAfter || item.verificationPlan || ""),
            expectedOutcome: String(item.afterResolution || ""),
          });
          const continueOperator = resolveOperatorCtaPresentation({
            runMode: resolutionMode === "manual"
              ? "deplo_can_verify_after_manual_step"
              : resolutionMode === "cannot_continue_yet"
                ? "deplo_cannot_continue_yet"
                : "deplo_can_run_now",
            primaryAction: continueAction,
            verificationPlan: String(item.verificationAfter || item.verificationPlan || ""),
            expectedOutcome: String(item.afterResolution || ""),
          });
          return `
            <article class="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3 space-y-2">
              <div class="flex flex-wrap items-center gap-2">
                <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tones[level]}">${labels[level]}</span>
                ${renderActionStateChip(verificationState)}
              </div>
              <h3 class="text-sm font-semibold text-slate-900" style="text-transform:capitalize">${escapeHtml(whatYouNeedToDo)}</h3>
              <p class="text-xs text-slate-600">${escapeHtml(renderIssueActionabilityLine(item.actionability))}</p>
              <p class="text-xs text-slate-600"><span class="font-medium text-slate-700">What you need to do:</span> ${escapeHtml(recoveryInstruction)}</p>
              ${recoveryCommand ? `<div class="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 flex items-center gap-2">
                  <code class="font-mono break-all">${escapeHtml(recoveryCommand)}</code>
                  <button data-copy-text="${escapeHtml(recoveryCommand)}" class="ml-auto rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50">Copy</button>
                </div>` : ""}
              <details class="rounded-md border border-slate-200 bg-white px-2.5 py-2">
                <summary class="cursor-pointer text-[11px] font-medium text-slate-600">More about this step</summary>
                <div class="mt-1.5 space-y-1.5">
                  <p class="text-xs text-slate-600">${escapeHtml(resolutionModeLine)}</p>
                  <p class="text-xs text-slate-600"><span class="font-medium text-slate-700">What Deplo does after:</span> ${escapeHtml(String(item.afterResolution || missing.whatDeploCanDoAfter || item.expectedOutcome || "Deplo continues and verifies the result."))}</p>
                  <p class="text-xs text-slate-600"><span class="font-medium text-slate-700">How Deplo verifies:</span> ${escapeHtml(String(item.verificationAfter || item.verificationPlan || "Deplo verifies this step after you continue."))}</p>
                </div>
              </details>
              ${expanded && item.detail ? `<p class="text-xs text-slate-500">${escapeHtml(String(item.detail))}</p>` : ""}
              <div class="flex flex-wrap gap-2">
                ${captureAction?.id ? `<button id="${escapeHtml(captureAction.id)}" ${captureBusy ? "disabled" : ""} class="rounded-full bg-emerald-700 text-white px-3.5 py-2 text-xs font-semibold hover:bg-emerald-800 transition ${captureBusy ? "opacity-60 cursor-not-allowed" : ""}">${captureBusy ? "Working…" : escapeHtml(String(captureOperator.primaryLabel || captureAction.label || "Resolve this step"))}</button>` : ""}
                ${continueAction?.id ? `<button id="${escapeHtml(continueAction.id)}" ${continueBusy ? "disabled" : ""} class="rounded-full border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition ${continueBusy ? "opacity-60 cursor-not-allowed" : ""}">${continueBusy ? "Working…" : escapeHtml(String(continueOperator.primaryLabel || continueAction.label || "Continue after input"))}</button>` : ""}
              </div>
            </article>
          `;
        }).join("")}
      </section>
    `;
  }).join("");

  return `
    <section class="rounded-xl border border-slate-200 bg-white px-4 py-3 space-y-3">
      <div class="text-[11px] uppercase tracking-[0.12em] font-semibold text-slate-500">What Deplo needs from you</div>
      ${groupsHtml}
    </section>
  `;
}

function inferExecutionState(unit) {
  const state = String(unit?.state || "detected");
  const actionability = String(unit?.actionability || "guided");
  if (state === "running") return "running";
  if (state === "verified") return "verified";
  if (state === "failed") return "failed";
  if (state === "blocked") return "blocked";
  if (state === "cannot_verify_yet") return "cannot_continue_yet";
  if (state === "needs_input") return "needs_input";
  if (state === "done") return "done_waiting_for_verification";
  if (state === "detected" || state === "ready" || state === "ready_to_run") {
    if (actionability === "confirm_to_run") return "needs_confirmation";
    return "ready_to_run";
  }
  return "ready_to_run";
}

function buildExecutionMetadataForUnit(unit, { activityLog, resultBanner }) {
  const executionState = inferExecutionState(unit);
  const owner = String(unit?.owner || "shared");
  const isDeploActingNow = executionState === "running" && (owner === "deplo" || owner === "shared");
  const deploNowLine = isDeploActingNow
    ? (String(unit?.verificationPlan || "").trim() || "Deplo is running this action and preparing verification.")
    : executionState === "cannot_continue_yet"
      ? "Deplo is waiting for access before it can continue."
      : executionState === "done_waiting_for_verification"
        ? "Deplo finished the action and is verifying the result."
        : "";

  const requiresHandoff = executionState === "needs_input" || executionState === "needs_confirmation" || executionState === "cannot_continue_yet";
  const handoff = requiresHandoff
    ? {
        requiredInput: String(unit?.missingInput?.title || unit?.title || "Input needed"),
        why: String(unit?.missingInput?.whyItMatters || unit?.whyThisMatters || "This unlocks the next operational step."),
        resumePlan: String(unit?.missingInput?.whatDeploCanDoAfter || unit?.expectedOutcome || "Deplo will continue and verify after this step."),
      }
    : null;

  const recent = Array.isArray(activityLog) ? activityLog : [];
  const lastSuccess = recent.find((entry) => String(entry?.status || "") === "success");
  const waitingOn = requiresHandoff ? String(handoff?.requiredInput || "") : "";
  const nextAfterThis = String(unit?.expectedOutcome || "").trim();
  const recentProgress = {
    lastCompleted: lastSuccess ? String(lastSuccess.message || "").trim() : "",
    waitingOn,
    nextAfterThis,
  };

  const bannerText = String(resultBanner?.message || "").trim();
  const hasFailure = executionState === "failed" || executionState === "blocked";
  const failureContext = hasFailure
    ? {
        failedStep: String(unit?.title || "Current action"),
        isRecoverable: true,
        ownerNext: owner === "deplo" ? "Deplo" : owner === "user" ? "You" : "Shared",
        nextRecoveryAction: unit?.primaryAction || unit?.secondaryAction || null,
        summary: bannerText || String(unit?.verificationStateText || "This action could not be verified yet."),
      }
    : null;

  const canResumeNow = executionState === "ready_to_run" || executionState === "running" || executionState === "done_waiting_for_verification";
  const resumeReason = executionState === "running"
    ? "Deplo is in progress and can continue automatically."
    : requiresHandoff
      ? "Deplo can resume after your required input."
      : executionState === "done_waiting_for_verification"
        ? "Action completed. Resume to finish verification."
        : "Ready to continue.";
  const blockedReason = executionState === "cannot_continue_yet"
    ? String(unit?.missingInput?.whyItMatters || "Required access is still missing.")
    : executionState === "blocked"
      ? "This action is blocked until the recovery step runs."
      : "";

  return {
    executionState,
    isDeploActingNow,
    deploNowLine,
    handoff,
    recentProgress,
    failureContext,
    resumeReason,
    canResumeNow,
    blockedReason,
  };
}

function renderOperationExecutionCenter({ actions, loading, activityLog = [], resultBanner = null }) {
  const units = Array.isArray(actions) ? actions : [];
  if (units.length === 0) return "";
  const enriched = units.map((unit) => ({
    ...unit,
    ...buildExecutionMetadataForUnit(unit, { activityLog, resultBanner }),
  }));
  const running = enriched.find((unit) => unit.executionState === "running");
  const waiting = enriched.filter((unit) => unit.executionState === "needs_input" || unit.executionState === "needs_confirmation");
  const blocked = enriched.find((unit) => unit.executionState === "failed" || unit.executionState === "blocked" || unit.executionState === "cannot_continue_yet");
  // When nothing is running/blocked/failed, the Missing Input card already handles
  // the waiting-on-input state. Suppress the execution center to avoid redundancy.
  if (!running && !blocked && waiting.length > 0) return "";
  const nowUnit = running
    || waiting[0]
    || enriched.find((unit) => unit.executionState === "ready_to_run")
    || enriched[0];
  const primaryBusy = Boolean(nowUnit?.primaryAction?.id && loading?.[nowUnit.primaryAction.id]);
  const recent = nowUnit?.recentProgress || {};
  const operatorCta = resolveOperatorCtaPresentation(nowUnit);
  const primaryLabel = String(operatorCta.primaryLabel || nowUnit?.primaryAction?.label || resolveResumeLabel(nowUnit));
  const supportLine = String(operatorCta.supportLine || "");
  const approvalState = String(nowUnit?.approvalState || operatorCta.approvalState || "none");
  const approvalBadge = approvalState === "awaiting_approval"
    ? '<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-amber-100 text-amber-800 border border-amber-200">Awaiting approval</span>'
    : approvalState === "ready_to_run"
      ? '<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-sky-100 text-sky-800 border border-sky-200">Deplo ready to run</span>'
      : "";

  return `
    <section class="rounded-xl border border-slate-200 bg-white px-4 py-3 space-y-3">
      <div class="text-[11px] uppercase tracking-[0.12em] font-semibold text-slate-500">Operation execution center</div>
      ${nowUnit ? `
        <article class="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3 space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            ${renderActionStateChip(nowUnit.executionState)}
            ${renderIssueSeverityBadge(nowUnit.priority)}
            ${approvalBadge}
          </div>
          <h3 class="text-sm font-semibold text-slate-900">${escapeHtml(String(nowUnit.title || "Current operation"))}</h3>
          ${nowUnit.isDeploActingNow ? `<p class="text-xs text-sky-700">Deplo is doing now: ${escapeHtml(String(nowUnit.deploNowLine || "Running action"))}</p>` : ""}
          ${!nowUnit.isDeploActingNow && nowUnit.deploNowLine ? `<p class="text-xs text-slate-600">${escapeHtml(String(nowUnit.deploNowLine))}</p>` : ""}
          <p class="text-xs text-slate-600">${escapeHtml(renderIssueActionabilityLine(nowUnit.actionability))}</p>
          ${nowUnit?.resumeReason ? `<p class="text-xs text-slate-500">${escapeHtml(String(nowUnit.resumeReason))}</p>` : ""}
          ${supportLine ? `<p class="text-xs text-slate-600">${escapeHtml(supportLine)}</p>` : ""}
          <p class="text-sm text-slate-700">${escapeHtml(String(nowUnit.expectedOutcome || ""))}</p>
          <p class="text-xs text-slate-500">${escapeHtml(renderVerificationLine(nowUnit.verificationPlan, nowUnit.verificationStateText, nowUnit.executionState))}</p>
          <div class="flex flex-wrap gap-2">
            ${nowUnit?.primaryAction?.id ? `<button id="${escapeHtml(nowUnit.primaryAction.id)}" ${primaryBusy ? "disabled" : ""} class="rounded-full bg-emerald-700 text-white px-3.5 py-2 text-xs font-semibold hover:bg-emerald-800 transition ${primaryBusy ? "opacity-60 cursor-not-allowed" : ""}">${primaryBusy ? "Working…" : escapeHtml(primaryLabel)}</button>` : ""}
            ${nowUnit?.secondaryAction?.id ? `<button id="${escapeHtml(nowUnit.secondaryAction.id)}" class="rounded-full border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition">${escapeHtml(String(nowUnit.secondaryAction.label || "Secondary action"))}</button>` : ""}
          </div>
        </article>
      ` : ""}
      ${waiting.length > 0 ? `
        <div class="rounded-lg border border-slate-200 bg-white px-3 py-3 space-y-2">
          <div class="text-xs font-semibold text-slate-700">Waiting on you</div>
          ${waiting.slice(0, 2).map((item) => `
            <div class="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-700 space-y-1">
              <div><span class="font-medium">Needed:</span> ${escapeHtml(String(item?.handoff?.requiredInput || item.title || "Input"))}</div>
              <div><span class="font-medium">Why:</span> ${escapeHtml(String(item?.handoff?.why || ""))}</div>
              <div><span class="font-medium">Then Deplo will:</span> ${escapeHtml(String(item?.handoff?.resumePlan || item.expectedOutcome || ""))}</div>
            </div>
          `).join("")}
        </div>
      ` : ""}
      <div class="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3 space-y-1">
        <div class="text-xs font-semibold text-slate-700">Recent progress</div>
        <p class="text-xs text-slate-600">${escapeHtml(recent.lastCompleted ? `Last completed: ${recent.lastCompleted}` : "Last completed: none yet")}</p>
        <p class="text-xs text-slate-600">${escapeHtml(recent.waitingOn ? `Waiting on: ${recent.waitingOn}` : "Waiting on: nothing right now")}</p>
        <p class="text-xs text-slate-600">${escapeHtml(recent.nextAfterThis ? `Next after this: ${recent.nextAfterThis}` : "Next after this: continue with Deplo")}</p>
      </div>
      ${blocked?.failureContext ? `
        <div class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 space-y-1">
          <div class="text-xs font-semibold text-rose-800">Failure / blocked</div>
          <p class="text-xs text-rose-700">What failed: ${escapeHtml(String(blocked.failureContext.failedStep || "Current operation"))}</p>
          <p class="text-xs text-rose-700">Recoverable: ${blocked.failureContext.isRecoverable ? "yes" : "no"} · Owner next: ${escapeHtml(String(blocked.failureContext.ownerNext || "Shared"))}</p>
          <p class="text-xs text-rose-700">${escapeHtml(String(blocked.failureContext.summary || ""))}</p>
          ${blocked?.failureContext?.nextRecoveryAction?.id ? `<button id="${escapeHtml(blocked.failureContext.nextRecoveryAction.id)}" class="rounded-full border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 transition">${escapeHtml(String(blocked.failureContext.nextRecoveryAction.label || "Recover"))}</button>` : ""}
        </div>
      ` : ""}
    </section>
  `;
}

function resolveOperatorSessionContinuity({
  actions,
  evidenceUnits,
  activityLog,
  resultBanner,
  loading,
  makerScreen,
  projectSource,
}) {
  const units = Array.isArray(actions) ? actions : [];
  const evidence = Array.isArray(evidenceUnits) ? evidenceUnits : [];
  const entries = Array.isArray(activityLog) ? activityLog : [];
  const enriched = units.map((unit) => ({
    ...unit,
    ...buildExecutionMetadataForUnit(unit, { activityLog: entries, resultBanner }),
  }));
  const sourceMode = String(projectSource?.mode || "local");
  const activeAction = enriched.find((unit) => unit.executionState === "running")
    || enriched.find((unit) => unit.executionState === "ready_to_run")
    || enriched[0]
    || null;
  const waitingOnUser = enriched.find((unit) =>
    unit.executionState === "needs_input"
    || unit.executionState === "needs_confirmation"
    || unit.executionState === "cannot_continue_yet",
  ) || null;
  const waitingOnVerification = enriched.find((unit) => unit.executionState === "done_waiting_for_verification")
    || null;
  const lastSuccessEntry = entries.find((entry) => String(entry?.status || "") === "success") || null;
  const lastCompletedAction = lastSuccessEntry
    ? String(lastSuccessEntry.message || "").trim()
    : (enriched.find((unit) => unit.executionState === "verified")?.title || "");
  const lastProgressEntry = entries[0] || null;
  const lastProgressUpdate = {
    at: String(lastProgressEntry?.timestamp || "").trim() || null,
    label: String(lastProgressEntry?.message || "").trim() || "",
  };
  const bannerType = String(resultBanner?.type || "");
  const lastKnownOutcome = bannerType === "error"
    ? "failed"
    : waitingOnUser
      ? "waiting_on_user"
      : waitingOnVerification
        ? "waiting_on_verification"
        : activeAction?.executionState === "running"
          ? "in_progress"
          : "ready_to_resume";

  let resumableNextStep = null;
  if (waitingOnUser?.primaryAction?.id) {
    resumableNextStep = {
      ...waitingOnUser.primaryAction,
      label: resolveResumeLabel(waitingOnUser, { waitingOnUser }),
    };
  } else if (waitingOnVerification?.primaryAction?.id) {
    resumableNextStep = {
      ...waitingOnVerification.primaryAction,
      label: resolveResumeLabel(waitingOnVerification, { waitingOnVerification }),
    };
  } else if (activeAction?.primaryAction?.id) {
    resumableNextStep = {
      ...activeAction.primaryAction,
      label: resolveResumeLabel(activeAction, { waitingOnUser, waitingOnVerification }),
    };
  } else {
    const firstIncompleteEvidence = evidence.find((item) => String(item?.status || "") !== "verified" && item?.nextStepIfIncomplete?.id);
    if (firstIncompleteEvidence?.nextStepIfIncomplete?.id) {
      resumableNextStep = {
        id: firstIncompleteEvidence.nextStepIfIncomplete.id,
        label: resolveResumeLabel({
          verificationStatus: firstIncompleteEvidence.status,
          target: firstIncompleteEvidence.target,
        }, { waitingOnVerification: true }),
      };
    }
  }

  let whereNow = "Deplo is ready for the next operator step.";
  if (sourceMode === "github" && waitingOnUser) {
    whereNow = "Deplo is waiting for local project context before it can continue verification.";
  } else if (waitingOnUser) {
    whereNow = `Deplo is waiting for your input: ${String(waitingOnUser?.handoff?.requiredInput || waitingOnUser?.title || "required setup detail")}.`;
  } else if (waitingOnVerification) {
    whereNow = "Deplo finished the action and is waiting to complete verification.";
  } else if (activeAction?.executionState === "running") {
    whereNow = `Deplo is running: ${String(activeAction?.title || "current action")}.`;
  }

  const liveEvidence = evidence.find((item) => String(item?.target || "") === "live_url_reachability");
  const runtimeEvidence = evidence.find((item) => String(item?.target || "") === "runtime_readiness");
  let whatChanged = "";
  if (lastProgressEntry && String(lastProgressEntry.status || "") === "success" && String(lastProgressEntry.operation || "") === "verify_live") {
    whatChanged = "Live URL verified since your last step.";
  } else if (lastProgressEntry && String(lastProgressEntry.status || "") === "error") {
    whatChanged = `${String(lastProgressEntry.message || "Last action failed.")} Deplo is ready to resume recovery.`;
  } else if (waitingOnUser?.handoff?.requiredInput) {
    whatChanged = `Still waiting on ${String(waitingOnUser.handoff.requiredInput)}.`;
  } else if (String(runtimeEvidence?.status || "") !== "verified" && lastSuccessEntry && String(lastSuccessEntry.operation || "") === "run_repair") {
    whatChanged = "Runtime is still not verified after the last fix.";
  } else if (String(liveEvidence?.status || "") === "partially_verified") {
    whatChanged = "Live signal is present, but verification is still incomplete.";
  }

  return {
    activeAction,
    lastCompletedAction,
    waitingOnUser,
    waitingOnVerification,
    lastKnownOutcome,
    resumableNextStep,
    lastProgressUpdate,
    whereNow,
    whatChanged,
    canResumeNow: Boolean(resumableNextStep?.id),
  };
}

function renderOperatorSessionContinuity({ continuity, loading = {}, compact = false }) {
  if (!continuity || typeof continuity !== "object") return "";
  const next = continuity?.resumableNextStep && continuity.resumableNextStep.id ? continuity.resumableNextStep : null;
  const nextBusy = Boolean(next?.id && loading?.[next.id]);
  const waitingLine = continuity?.waitingOnUser
    ? String(continuity.waitingOnUser?.handoff?.requiredInput || continuity.waitingOnUser?.title || "your input")
    : continuity?.waitingOnVerification
      ? "verification to complete"
      : "nothing right now";
  const outcomeLabel = continuity.lastKnownOutcome === "failed"
    ? "Needs recovery"
    : continuity.lastKnownOutcome === "waiting_on_user"
      ? "Waiting on you"
      : continuity.lastKnownOutcome === "waiting_on_verification"
        ? "Waiting on verification"
        : continuity.lastKnownOutcome === "in_progress"
          ? "In progress"
          : "Ready to resume";
  return `
    <section class="rounded-xl border border-slate-200 bg-white px-4 py-3 space-y-2.5">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[11px] uppercase tracking-[0.12em] font-semibold text-slate-500">Session continuity</span>
        <span class="inline-flex items-center rounded-full bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 text-[11px] font-medium">${escapeHtml(outcomeLabel)}</span>
      </div>
      <p class="text-sm text-slate-800">${escapeHtml(String(continuity.whereNow || "Deplo is ready to continue."))}</p>
      ${!compact ? `<p class="text-xs text-slate-600">Last completed: ${escapeHtml(String(continuity.lastCompletedAction || "No completed steps yet"))}</p>` : ""}
      <p class="text-xs text-slate-600">Waiting on: ${escapeHtml(waitingLine)}</p>
      ${continuity?.lastProgressUpdate?.label ? `<p class="text-xs text-slate-500">Last update: ${escapeHtml(String(continuity.lastProgressUpdate.label))}</p>` : ""}
      ${continuity?.whatChanged ? `<p class="text-xs text-slate-500">What changed: ${escapeHtml(String(continuity.whatChanged))}</p>` : ""}
      ${next?.id ? `<button id="${escapeHtml(next.id)}" ${nextBusy ? "disabled" : ""} class="rounded-full bg-emerald-700 text-white px-3.5 py-2 text-xs font-semibold hover:bg-emerald-800 transition ${nextBusy ? "opacity-60 cursor-not-allowed" : ""}">${nextBusy ? "Working…" : escapeHtml(String(next.label || "Continue with Deplo"))}</button>` : ""}
    </section>
  `;
}

function resolveFounderActionUnits({
  proof,
  doctorReport,
  loading,
  makerScreen,
  projectSource,
  inspectionFindings = null,
  fixProgressStep,
  resultBanner,
  hasConnectedRepo = false,
  activityLog = [],
  verificationEvidenceUnits = [],
}) {
  const sourceMode = String(projectSource?.mode || "local");
  const issues = Array.isArray(doctorReport?.issues) ? doctorReport.issues : [];
  const hasAutofix = getDoctorAutofixActions(doctorReport).length > 0;
  const hasManual = Array.isArray(doctorReport?.actions)
    ? doctorReport.actions.some((action) => String(action?.type || "") === "manual")
    : false;
  const runningFix = Boolean(loading?.runFixNowBtn || loading?.fixNextBtn);
  const runningScan = Boolean(loading?.aiAnalyzeBtn);
  const runningVerify = Boolean(loading?.verifyLiveAppBtn);
  const bannerMessage = String(resultBanner?.message || "").toLowerCase();
  const lookedFailed = bannerMessage.includes("failed") || bannerMessage.includes("error");
  const lookedVerified = bannerMessage.includes("ready for review") || bannerMessage.includes("resolved") || bannerMessage.includes("ready");
  const lastActivity = Array.isArray(activityLog) && activityLog.length > 0 ? activityLog[0] : null;
  const activityFailed = String(lastActivity?.status || "") === "error";
  const activityRunning = String(lastActivity?.status || "") === "running";
  const proofVariant = String(proof?.variant || "no_proof_yet");
  const isLiveVariant = proofVariant === "live_needs_input" || proofVariant === "live_stable";
  const proofHasBlocking = Boolean(proof?.hasBlockingInput);
  const providerHints = Array.isArray(inspectionFindings?.providerHints) ? inspectionFindings.providerHints : [];
  const serviceHints = Array.isArray(inspectionFindings?.serviceHints) ? inspectionFindings.serviceHints : [];
  const requirementHints = Array.isArray(inspectionFindings?.operationalRequirements) ? inspectionFindings.operationalRequirements : [];
  const hasLikelyEnvRequirement = requirementHints.some((item) => /environment|env/i.test(String(item?.value || "")));
  const hasVercelHint = providerHints.some((item) => String(item?.value || "").toLowerCase().includes("vercel"));
  const hasSupabaseHint = serviceHints.some((item) => String(item?.value || "").toLowerCase().includes("supabase"));
  const providerContext = resolveProviderOperationContext({ inspectionFindings, proof, doctorReport, projectSource });
  const deployProviderLabel = providerContext.deployProvider === "vercel"
    ? "Vercel"
    : providerContext.deployProvider === "netlify"
      ? "Netlify"
      : providerContext.deployProvider === "cloudflare"
        ? "Cloudflare"
        : "deploy platform";
  const serviceProviderLabel = providerContext.serviceProvider === "supabase"
    ? "Supabase"
    : providerContext.serviceProvider === "prisma"
      ? "Prisma"
      : providerContext.serviceProvider === "drizzle"
        ? "Drizzle"
        : "database service";
  const verificationTargetLabel = providerContext.verificationTarget === "live_url"
    ? "live URL availability"
    : providerContext.verificationTarget === "deploy_status"
      ? "deploy status"
      : providerContext.verificationTarget === "database_features"
        ? "database-backed features"
        : "runtime readiness";
  const providerContextLine = `${deployProviderLabel} · ${serviceProviderLabel} · verification: ${verificationTargetLabel}`;
  const evidenceByTarget = new Map(
    (Array.isArray(verificationEvidenceUnits) ? verificationEvidenceUnits : [])
      .map((item) => [String(item?.target || ""), item]),
  );
  const evidenceForTarget = (target) => evidenceByTarget.get(String(target || "")) || null;
  const evidenceForPrimaryTarget = evidenceForTarget(providerContext.verificationTarget);
  const evidenceToVerificationText = (evidence, fallbackText = "") => {
    if (!evidence) return fallbackText;
    const status = String(evidence.status || "");
    const summary = String(evidence.evidenceSummary || "").trim();
    const recency = String(evidence.recencyLabel || "").trim();
    if (status === "verified") {
      return summary || "Verification passed.";
    }
    if (status === "verification_failed") {
      return summary || "Verification failed.";
    }
    if (status === "partially_verified") {
      return `${summary || "Partially verified."}${recency ? ` ${recency}.` : ""}`.trim();
    }
    if (status === "cannot_verify_yet") {
      return summary || "Cannot verify yet from current access.";
    }
    return summary || fallbackText;
  };

  const inferRunMode = (unit) => {
    const actionability = String(unit?.actionability || "");
    const executionMode = String(unit?.executionMode || "");
    const state = String(unit?.state || "");
    if (actionability === "auto_fixable" || executionMode === "auto_verify") return "deplo_can_run_now";
    if (actionability === "confirm_to_run" || executionMode === "confirm_then_run") return "deplo_can_run_after_confirmation";
    if (actionability === "cannot_verify_yet" || state === "cannot_verify_yet") return "deplo_cannot_continue_yet";
    if (executionMode === "requires_input" || actionability === "user_input_needed" || state === "needs_input") return "user_must_do_manual_step";
    if (executionMode === "guide_only" && String(unit?.verificationTarget || unit?.providerContext?.verificationTarget || "") !== "") return "deplo_can_verify_after_manual_step";
    return "deplo_can_run_now";
  };

  const withDefaults = (unit) => ({
    id: String(unit?.id || "action"),
    title: String(unit?.title || "Action needed"),
    summary: String(unit?.summary || ""),
    priority: String(unit?.priority || "recommended_next"),
    owner: String(unit?.owner || "shared"),
    actionability: String(unit?.actionability || "guided"),
    state: String(unit?.state || "detected"),
    expectedOutcome: String(unit?.expectedOutcome || "After this, Deplo will verify the result."),
    verificationPlan: String(unit?.verificationPlan || "Deplo verifies the result after this step."),
    verificationStateText: String(unit?.verificationStateText || ""),
    verificationEvidenceId: String(unit?.verificationEvidenceId || ""),
    verificationStatus: String(unit?.verificationStatus || ""),
    confidenceLevel: String(unit?.confidenceLevel || "low"),
    nextStepIfIncomplete: unit?.nextStepIfIncomplete || null,
    resumeHint: String(unit?.resumeHint || ""),
    resumeActionLabel: String(unit?.resumeActionLabel || ""),
    blockedReason: String(unit?.blockedReason || ""),
    runMode: String(unit?.runMode || inferRunMode(unit)),
    blockingScope: String(unit?.blockingScope || "recommended_only"),
    sourceScope: String(unit?.sourceScope || (sourceMode === "github" ? "local_required" : "deploy_required")),
    providerContext: unit?.providerContext && typeof unit.providerContext === "object"
      ? unit.providerContext
      : {
          deployProvider: providerContext.deployProvider,
          serviceProvider: providerContext.serviceProvider,
          verificationTarget: providerContext.verificationTarget,
          confidence: {
            deploy: providerContext.deployProviderConfidence,
            service: providerContext.serviceProviderConfidence,
          },
          evidence: providerContext.providerEvidence,
        },
    whyThisMatters: String(unit?.whyThisMatters || ""),
    executionMode: String(unit?.executionMode || (
      unit?.actionability === "auto_fixable"
        ? "auto_verify"
        : unit?.actionability === "confirm_to_run"
          ? "confirm_then_run"
          : unit?.actionability === "user_input_needed"
            ? "requires_input"
            : "guide_only"
    )),
    primaryAction: unit?.primaryAction || null,
    secondaryAction: unit?.secondaryAction || null,
    missingInput: unit?.missingInput && typeof unit.missingInput === "object"
      ? {
          recoveryCommand: String(unit.missingInput.recoveryCommand || ""),
          recoveryInstruction: normalizeRecoveryInstruction({
            instruction: String(unit.missingInput.recoveryInstruction || ""),
            command: String(unit.missingInput.recoveryCommand || ""),
          }),
          title: String(unit.missingInput.title || ""),
          explanation: String(unit.missingInput.explanation || ""),
          severity: String(unit.missingInput.severity || "recommended"),
          owner: String(unit.missingInput.owner || String(unit?.owner || "shared")),
          inputType: String(unit.missingInput.inputType || "service_identifier"),
          whyItMatters: String(unit.missingInput.whyItMatters || ""),
          whatDeploCanDoAfter: String(unit.missingInput.whatDeploCanDoAfter || ""),
          providerContextLine: String(unit.missingInput.providerContextLine || ""),
          blocks: String(unit.missingInput.blocks || String(unit?.blockingScope || "recommended_only")),
          verificationState: String(unit.missingInput.verificationState || String(unit?.state || "needs_input")),
          recoveryCommandCopyable: Boolean(unit.missingInput.recoveryCommandCopyable),
          recoveryMode: String(unit.missingInput.recoveryMode || ""),
          captureAction: unit.missingInput.captureAction || unit?.primaryAction || null,
          continueAction: unit.missingInput.continueAction || unit?.secondaryAction || null,
        }
      : null,
    detail: String(unit?.detail || ""),
  });
  const withOperatorPresentation = (unit) => {
    const operator = resolveOperatorCtaPresentation(unit, null, null);
    return {
      ...unit,
      operatorPrimaryLabel: String(unit?.operatorPrimaryLabel || operator.primaryLabel || ""),
      operatorSupportLine: String(unit?.operatorSupportLine || operator.supportLine || ""),
      approvalState: String(unit?.approvalState || operator.approvalState || "none"),
    };
  };

  if (sourceMode === "github") {
    const githubEvidence = evidenceForTarget("runtime_readiness");
    return [withOperatorPresentation(withDefaults({
      id: "github-verify-locally",
      title: hasConnectedRepo
        ? "Capture local project context"
        : "Deplo still needs a connected GitHub repository URL.",
      summary: hasConnectedRepo
        ? `GitHub source is connected. ${deployProviderLabel} and runtime checks still need local context for full verification.`
        : "Connect a GitHub repository source to continue.",
      priority: hasConnectedRepo ? "recommended_next" : "must_fix_now",
      owner: hasConnectedRepo ? "shared" : "user",
      actionability: hasConnectedRepo ? "cannot_verify_yet" : "user_input_needed",
      runMode: hasConnectedRepo ? "deplo_cannot_continue_yet" : "user_must_do_manual_step",
      primaryAction: hasConnectedRepo
        ? { id: "startScanBtn", label: "Capture local project context" }
        : { id: "aiAnalyzeBtn", label: "Check imported repo" },
      secondaryAction: hasConnectedRepo ? { id: "aiAnalyzeBtn", label: "Retry GitHub inspection" } : null,
      state: hasConnectedRepo ? "cannot_verify_yet" : (runningScan ? "running" : "needs_input"),
      expectedOutcome: hasConnectedRepo
        ? `After this, Deplo can verify ${verificationTargetLabel} and recommend the next provider-specific step.`
        : "After this, Deplo can capture source context and continue.",
      verificationPlan: hasConnectedRepo
        ? `Deplo verifies ${verificationTargetLabel} after local check.`
        : "Deplo verifies repository context after import.",
      verificationStateText: evidenceToVerificationText(
        githubEvidence,
        hasConnectedRepo
          ? "Cannot verify fully from current source."
          : (runningScan ? "Checking repository source now." : "Repository context not verified yet."),
      ),
      verificationEvidenceId: String(githubEvidence?.id || ""),
      verificationStatus: String(githubEvidence?.status || "cannot_verify_yet"),
      confidenceLevel: String(githubEvidence?.confidenceLevel || "low"),
      nextStepIfIncomplete: githubEvidence?.nextStepIfIncomplete || null,
      blockingScope: hasConnectedRepo ? "blocks_full_readiness" : "informational",
      sourceScope: hasConnectedRepo ? "local_required" : "github_only",
      detail: hasConnectedRepo
        ? "Current source can store repo context, but cannot fully verify runtime readiness."
        : "No connected repository source found.",
      missingInput: hasConnectedRepo
        ? {
            title: "Capture local project context",
            explanation: `GitHub source is connected, but Deplo still needs local access for full ${deployProviderLabel} and runtime verification.`,
            severity: "recommended",
            owner: "shared",
            inputType: "local_access_required",
            whyItMatters: `Without local access, Deplo cannot confirm ${verificationTargetLabel}.`,
            whatDeploCanDoAfter: `Deplo can run provider-aware checks and recommend the best next step.`,
            providerContextLine,
            blocks: "blocks_full_readiness",
            verificationState: "cannot_verify_yet",
            recoveryInstruction: "Open your local project in this workspace so Deplo can run full checks.",
            recoveryCommand: "",
            recoveryCommandCopyable: false,
            recoveryMode: "cannot_continue_yet",
            captureAction: { id: "startScanBtn", label: "Capture local project context" },
            continueAction: { id: "aiAnalyzeBtn", label: "Retry GitHub inspection" },
          }
        : {
            title: "Add your GitHub repository URL",
            explanation: "Deplo needs your repository URL to connect this project source.",
            severity: "required",
            owner: "user",
            inputType: "service_identifier",
            whyItMatters: "Without a connected source, Deplo cannot continue this GitHub flow.",
            whatDeploCanDoAfter: "Deplo can capture repo context and continue with guided steps.",
            blocks: "specific_feature",
            verificationState: runningScan ? "running" : "needs_input",
            recoveryInstruction: "Paste the full GitHub repository URL and run the check again.",
            recoveryCommand: "",
            recoveryCommandCopyable: false,
            recoveryMode: "manual",
            captureAction: { id: "aiAnalyzeBtn", label: "Check imported repo" },
            continueAction: null,
          },
    }))];
  }

  const baseIssue = toFounderIssueTitle(String(issues[0]?.message || "").trim(), { sourceMode })
    || "One setup detail still needs attention.";
  const priority = proofHasBlocking
    ? (proof?.remainingInputSeverity === "recommended" || isLiveVariant ? "recommended_next" : "must_fix_now")
    : "optional_later";
  const owner = hasAutofix ? "deplo" : hasManual ? "shared" : "user";
  const actionability = hasAutofix
    ? "auto_fixable"
    : hasManual
      ? "user_input_needed"
      : "confirm_to_run";
  let state = "ready";
  if (!doctorReport) {
    state = runningScan ? "running" : "detected";
  } else if (runningFix || runningVerify || activityRunning || (makerScreen === "fixFlow" && fixProgressStep > 0 && fixProgressStep < 4)) {
    state = "running";
  } else if (lookedFailed || activityFailed) {
    state = "failed";
  } else if (proofHasBlocking && actionability === "user_input_needed" && !hasAutofix) {
    state = "needs_input";
  } else if (!proofHasBlocking && (lookedVerified || proof?.hasProof)) {
    state = proof?.hasProof ? "verified" : "done";
  } else if (!proofHasBlocking && doctorReport) {
    state = "done";
  }
  const blockingScope = !proofHasBlocking
    ? "recommended_only"
    : (isLiveVariant || proof?.remainingInputSeverity === "recommended")
      ? "blocks_full_readiness"
      : "blocks_live";
  const sourceScope = proof?.hasProof ? "deploy_required" : "env_required";
  const rawIssue = String(issues[0]?.message || "").trim();
  let missingInputType = resolveMissingInputType(rawIssue || baseIssue, sourceMode);
  if (missingInputType === "service_identifier" || missingInputType === "provider_access") {
    if (hasSupabaseHint) {
      missingInputType = "database_connection";
    } else if (hasLikelyEnvRequirement) {
      missingInputType = "environment_variable";
    } else if (hasVercelHint) {
      missingInputType = "provider_access";
    }
  }
  const missingSeverity = priority === "must_fix_now" ? "required" : (priority === "recommended_next" ? "recommended" : "optional");
  const missingTitle = missingInputType === "database_connection"
    ? (providerContext.serviceProvider === "supabase" ? "Supabase access still needs confirmation" : "Database access still needs confirmation")
    : missingInputType === "environment_variable"
      ? "Environment input is still incomplete"
    : missingInputType === "provider_access"
        ? `${deployProviderLabel} access needs refresh`
        : missingInputType === "deploy_confirmation"
          ? `${deployProviderLabel} deploy status is not confirmed yet`
          : "Required project input is still missing";
  const missingExplanation = missingInputType === "database_connection"
    ? `${serviceProviderLabel} access is not fully confirmed yet.`
    : missingInputType === "environment_variable"
      ? "One required app setting is still missing."
    : missingInputType === "provider_access"
        ? `Deplo needs ${deployProviderLabel} access to continue safely.`
        : missingInputType === "deploy_confirmation"
          ? `Deplo needs ${deployProviderLabel} project verification before continuing.`
        : "One required project detail is still missing.";
  const confidenceForMissing = missingInputType === "environment_variable" && hasLikelyEnvRequirement
    ? "likely"
    : missingInputType === "database_connection" && hasSupabaseHint
      ? "confirmed"
      : missingInputType === "provider_access" && hasVercelHint
        ? "likely"
        : "not_verified";
  const confidenceLine = confidenceForMissing === "confirmed"
    ? "Confirmed from project inspection."
    : confidenceForMissing === "likely"
      ? "Likely from project inspection."
      : "Not fully verified yet.";
  const missingWhy = blockingScope === "blocks_live"
    ? "This blocks live readiness right now."
    : blockingScope === "blocks_full_readiness"
      ? "Your app can run, but full readiness is still limited."
      : "This keeps Deplo from completing the full operational check.";
  const captureAction = actionability === "user_input_needed"
    ? {
        id: "reviewMissingBtn",
        label: missingInputType === "provider_access"
          ? `Confirm ${deployProviderLabel} access`
          : missingInputType === "database_connection"
            ? `Confirm ${serviceProviderLabel} access`
            : "Add required input",
      }
    : (missingInputType === "environment_variable"
      ? { id: "quickAddEnvBtn", label: "Add missing environment variable" }
      : missingInputType === "provider_access"
        ? { id: "verifyLiveAppBtn", label: `Verify ${deployProviderLabel} project status` }
        : { id: "runFixNowBtn", label: hasAutofix ? "Run fix" : "Continue with Deplo" });
  const primaryEvidence = evidenceForPrimaryTarget || evidenceForTarget("runtime_readiness");
  const continueAction = {
    id: providerContext.verificationTarget === "live_url" ? "verifyLiveAppBtn" : "runFixNowBtn",
    label: resolveResumeLabel({
      actionability,
      verificationStatus: String(primaryEvidence?.status || ""),
      verificationTarget: providerContext.verificationTarget,
      state,
    }),
  };

  const providerRecoveryCommand = missingInputType === "provider_access" && /vercel/i.test(deployProviderLabel)
    ? "vercel login"
    : "";
  const providerRecoveryInstruction = normalizeRecoveryInstruction({
    instruction: missingInputType === "provider_access"
      ? "Refresh deploy platform access, then continue with Deplo."
      : missingInputType === "environment_variable"
        ? "Add the missing environment variable in your deploy platform settings."
        : "Complete the required setup step, then continue with Deplo.",
    command: providerRecoveryCommand,
  });

  const units = [withDefaults({
    id: "local-fix-verify",
    title: baseIssue,
    summary: proofHasBlocking
      ? `Deplo found one ${deployProviderLabel}-aware next step to keep this project moving.`
      : "Core setup looks good. Keep verification current as you ship updates.",
    priority,
    owner,
    actionability,
    runMode: actionability === "auto_fixable"
      ? "deplo_can_run_now"
      : actionability === "confirm_to_run"
        ? "deplo_can_run_after_confirmation"
        : actionability === "cannot_verify_yet"
          ? "deplo_cannot_continue_yet"
          : "user_must_do_manual_step",
    state,
    primaryAction: captureAction,
    secondaryAction: { id: "reviewMissingBtn", label: "Review what's missing" },
    expectedOutcome: isLiveVariant
      ? `After this, Deplo can verify ${verificationTargetLabel} for your live app.`
      : proofHasBlocking
        ? `After this, Deplo can continue with ${deployProviderLabel} verification and deployment readiness checks.`
        : "After this, Deplo can keep this project verified.",
    verificationPlan: proof?.hasProof
      ? `Deplo checks ${verificationTargetLabel} after this step.`
      : `Deplo checks ${verificationTargetLabel} and runtime readiness after this step.`,
    verificationStateText: state === "running"
      ? "Verification will run after the action."
      : evidenceToVerificationText(
        primaryEvidence,
        state === "verified"
          ? "Verification passed."
          : state === "failed"
            ? "Verification did not pass yet."
            : "",
      ),
    verificationEvidenceId: String(primaryEvidence?.id || ""),
    verificationStatus: String(primaryEvidence?.status || (state === "failed" ? "verification_failed" : state === "verified" ? "verified" : "not_verified")),
    confidenceLevel: String(primaryEvidence?.confidenceLevel || (state === "verified" ? "high" : "medium")),
    nextStepIfIncomplete: primaryEvidence?.nextStepIfIncomplete || continueAction,
    resumeHint: state === "running"
      ? "Action in progress. Deplo can continue automatically."
      : state === "needs_input"
        ? "Waiting for your input to resume."
        : "Ready to resume from the latest step.",
    resumeActionLabel: resolveResumeLabel({
      actionability,
      runMode: actionability === "auto_fixable"
        ? "deplo_can_run_now"
        : actionability === "confirm_to_run"
          ? "deplo_can_run_after_confirmation"
          : "user_must_do_manual_step",
      verificationStatus: String(primaryEvidence?.status || ""),
      verificationTarget: providerContext.verificationTarget,
      state,
    }),
    blockedReason: state === "needs_input"
      ? String(missingTitle || "Required input is missing.")
      : "",
    blockingScope,
    sourceScope,
    whyThisMatters: `This unlocks ${verificationTargetLabel} checks for ${deployProviderLabel}${serviceProviderLabel !== "database service" ? ` and ${serviceProviderLabel}` : ""}.`,
    executionMode: actionability === "auto_fixable"
      ? "auto_verify"
      : actionability === "confirm_to_run"
        ? "confirm_then_run"
        : actionability === "user_input_needed"
          ? "requires_input"
          : "guide_only",
    detail: rawIssue,
    missingInput: proofHasBlocking
      ? {
          title: missingTitle,
          explanation: missingExplanation,
          severity: missingSeverity,
          owner,
          inputType: missingInputType,
          whyItMatters: `${missingWhy} ${confidenceLine}`.trim(),
          whatDeploCanDoAfter: isLiveVariant
            ? `Deplo can confirm ${verificationTargetLabel} and re-check live health.`
            : `Deplo can continue provider-aware fixes and verify ${verificationTargetLabel}.`,
          providerContextLine,
          blocks: blockingScope,
          verificationState: state,
          recoveryInstruction: providerRecoveryInstruction,
          recoveryCommand: providerRecoveryCommand,
          recoveryCommandCopyable: Boolean(providerRecoveryCommand),
          recoveryMode: actionability === "auto_fixable"
            ? "autofix"
            : actionability === "confirm_to_run"
              ? "confirm_then_run"
              : actionability === "cannot_verify_yet"
                ? "cannot_continue_yet"
                : "manual",
          captureAction,
          continueAction,
        }
      : null,
  })];

  if (proof?.hasProof && proof?.url) {
    units.push(withDefaults({
      id: "open-proof-url",
      title: proof.variant === "live_stable" || proof.variant === "live_needs_input"
        ? "Open your live app"
        : "Open your preview",
      summary: "Use the live or preview URL while Deplo keeps readiness checks visible.",
      priority: "recommended_next",
      owner: "user",
      actionability: "confirm_to_run",
      runMode: "deplo_can_verify_after_manual_step",
      state: "ready",
      expectedOutcome: `After this, you can validate app behavior and Deplo can re-check ${verificationTargetLabel}.`,
      verificationPlan: `Deplo can re-check ${verificationTargetLabel} after you review the app.`,
      verificationStateText: "",
      verificationEvidenceId: "evidence-live-url",
      verificationStatus: "not_verified",
      confidenceLevel: "medium",
      nextStepIfIncomplete: { id: "verifyLiveAppBtn", label: "Verify live app" },
      resumeHint: "Resume verification after checking the live app.",
      resumeActionLabel: resolveResumeLabel({
        runMode: "deplo_can_verify_after_manual_step",
        verificationStatus: "partially_verified",
        verificationTarget: "live_url",
        state: "ready",
      }),
      blockingScope: "informational",
      sourceScope: "deploy_required",
      whyThisMatters: "This confirms user-visible behavior before the next operational step.",
      executionMode: "guide_only",
      primaryAction: { id: "openFirstVersionExternalBtn", label: proof.variant === "live_stable" || proof.variant === "live_needs_input" ? "Open live app" : "Open preview" },
      secondaryAction: proofHasBlocking ? { id: "fixNextBtn", label: "Fix this next" } : null,
      detail: proof.url,
    }));
  }

  return units.map((unit) => withOperatorPresentation(unit));
}

function renderFounderActionCard(actionUnit, loading) {
  if (!actionUnit || typeof actionUnit !== "object") return "";
  const busy = Boolean(actionUnit?.primaryAction?.id && loading?.[actionUnit.primaryAction.id]);
  const providerContext = actionUnit?.providerContext && typeof actionUnit.providerContext === "object"
    ? actionUnit.providerContext
    : null;
  const deployProvider = String(providerContext?.deployProvider || "unknown");
  const serviceProvider = String(providerContext?.serviceProvider || "unknown");
  const verificationTarget = String(providerContext?.verificationTarget || "runtime_readiness");
  const providerLine = providerContext
    ? `${deployProvider === "unknown" ? "deploy platform" : deployProvider} · ${serviceProvider === "unknown" ? "service not verified" : serviceProvider} · verifies ${verificationTarget.replaceAll("_", " ")}`
    : "";
  const executionMode = String(actionUnit?.executionMode || "");
  const operatorCta = resolveOperatorCtaPresentation(actionUnit);
  const primaryLabel = String(operatorCta.primaryLabel || actionUnit?.primaryAction?.label || "Continue with Deplo");
  const supportLine = String(operatorCta.supportLine || actionUnit?.operatorSupportLine || "");
  const approvalState = String(actionUnit?.approvalState || operatorCta.approvalState || "none");
  const approvalBadge = approvalState === "awaiting_approval"
    ? '<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-amber-100 text-amber-800 border border-amber-200">Awaiting approval</span>'
    : approvalState === "ready_to_run"
      ? '<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-sky-100 text-sky-800 border border-sky-200">Deplo ready to run</span>'
      : approvalState === "blocked_on_input"
        ? '<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">Waiting on input</span>'
        : "";
  return `
    <article class="rounded-xl border border-slate-200 bg-white px-4 py-3 space-y-2.5">
      <div class="flex flex-wrap items-center gap-2">
        ${renderIssueSeverityBadge(actionUnit.priority)}
        ${renderActionStateChip(actionUnit.state)}
        ${approvalBadge}
      </div>
      <h3 class="text-sm font-semibold text-slate-900">${escapeHtml(String(actionUnit.title || "Issue"))}</h3>
      ${actionUnit.summary ? `<p class="text-xs text-slate-600">${escapeHtml(String(actionUnit.summary))}</p>` : ""}
      ${providerLine ? `<p class="text-[11px] text-slate-500">${escapeHtml(providerLine)}</p>` : ""}
      <p class="text-xs text-slate-600">${escapeHtml(renderActionBoundaryLine(actionUnit.actionability, actionUnit.owner))}</p>
      ${actionUnit.whyThisMatters ? `<p class="text-xs text-slate-600"><span class="font-medium text-slate-700">Why this matters:</span> ${escapeHtml(String(actionUnit.whyThisMatters))}</p>` : ""}
      <p class="text-sm text-slate-700">${escapeHtml(String(actionUnit.expectedOutcome || ""))}</p>
      ${supportLine ? `<p class="text-xs text-slate-600">${escapeHtml(supportLine)}</p>` : ""}
      <p class="text-xs text-slate-500">${escapeHtml(renderVerificationLine(actionUnit.verificationPlan, actionUnit.verificationStateText, actionUnit.state))}</p>
      ${actionUnit?.confidenceLevel ? `<p class="text-[11px] text-slate-500">${escapeHtml(toConfidenceLabel(actionUnit.confidenceLevel))}</p>` : ""}
      ${executionMode ? `<p class="text-[11px] text-slate-500">Execution mode: ${escapeHtml(executionMode.replaceAll("_", " "))}</p>` : ""}
      <div class="flex flex-wrap gap-2">
        ${actionUnit?.primaryAction?.id ? `<button id="${escapeHtml(actionUnit.primaryAction.id)}" ${busy ? "disabled" : ""} class="rounded-full bg-emerald-700 text-white px-3.5 py-2 text-xs font-semibold hover:bg-emerald-800 transition ${busy ? "opacity-60 cursor-not-allowed" : ""}">${busy ? "Working…" : escapeHtml(primaryLabel)}</button>` : ""}
        ${actionUnit?.secondaryAction?.id ? `<button id="${escapeHtml(actionUnit.secondaryAction.id)}" class="rounded-full border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition">${escapeHtml(String(actionUnit.secondaryAction.label || "Secondary action"))}</button>` : ""}
      </div>
      ${actionUnit?.detail ? `<p class="text-xs text-slate-500">${escapeHtml(String(actionUnit.detail))}</p>` : ""}
    </article>
  `;
}

function resolveFounderIssuesModel({ proof, doctorReport, projectSource, loading, makerScreen = "localDiagnosis", inspectionFindings = null, fixProgressStep = 0, resultBanner = null, activityLog = [], hasConnectedRepo = false, verificationEvidenceUnits = [] }) {
  const actions = resolveFounderActionUnits({
    proof,
    doctorReport,
    loading,
    makerScreen,
    projectSource,
    inspectionFindings,
    fixProgressStep,
    resultBanner,
    hasConnectedRepo,
    activityLog,
    verificationEvidenceUnits,
  });
  return Array.isArray(actions)
    ? actions.filter((action) => action?.id !== "open-proof-url")
    : [];
}

function renderFounderIssueGroups({ issues, loading }) {
  const list = Array.isArray(issues) ? issues : [];
  if (list.length === 0) return "";
  const busy = {
    fixNextBtn: Boolean(loading?.fixNextBtn),
    runFixNowBtn: Boolean(loading?.runFixNowBtn),
    aiAnalyzeBtn: Boolean(loading?.aiAnalyzeBtn),
    deployNowBtn: Boolean(loading?.deployNowBtn),
    startScanBtn: Boolean(loading?.startScanBtn),
  };
  const grouped = {
    must_fix_now: list.filter((issue) => issue.priority === "must_fix_now"),
    recommended_next: list.filter((issue) => issue.priority === "recommended_next"),
    optional_later: list.filter((issue) => issue.priority === "optional_later"),
  };
  const groupOrder = [
    { key: "must_fix_now", label: "Must fix now" },
    { key: "recommended_next", label: "Recommended next" },
    { key: "optional_later", label: "Optional / later" },
  ];
  return groupOrder.map((group) => {
    const items = grouped[group.key];
    if (!items || items.length === 0) return "";
    return `
      <section class="rounded-xl border border-slate-200 bg-white px-4 py-3 space-y-2.5">
        <div class="text-[11px] uppercase tracking-[0.12em] font-semibold text-slate-500">${group.label}</div>
        ${items.map((issue) => {
          const primaryBusy = issue?.primaryAction?.id ? Boolean(busy[issue.primaryAction.id]) : false;
          return `
            <article class="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3 space-y-2">
              <div class="flex flex-wrap items-center gap-2">
                ${renderIssueSeverityBadge(issue.priority)}
                ${renderActionStateChip(issue.state)}
              </div>
              <h3 class="text-sm font-semibold text-slate-900">${escapeHtml(String(issue.title || "Issue"))}</h3>
              ${issue.summary ? `<p class="text-xs text-slate-600">${escapeHtml(String(issue.summary))}</p>` : ""}
              <p class="text-xs text-slate-600">${escapeHtml(renderIssueOwnerLine(issue.owner))} · ${escapeHtml(renderIssueActionabilityLine(issue.actionability))}</p>
              <p class="text-sm text-slate-700">${escapeHtml(String(issue.expectedOutcome || ""))}</p>
              <p class="text-xs text-slate-500">${escapeHtml(renderVerificationLine(issue.verificationPlan, issue.verificationStateText, issue.state))}</p>
              <div class="flex flex-wrap gap-2">
                ${issue?.primaryAction?.id ? `<button id="${escapeHtml(issue.primaryAction.id)}" ${primaryBusy ? "disabled" : ""} class="rounded-full bg-emerald-700 text-white px-3.5 py-2 text-xs font-semibold hover:bg-emerald-800 transition ${primaryBusy ? "opacity-60 cursor-not-allowed" : ""}">${primaryBusy ? "Working…" : escapeHtml(String(issue.primaryAction.label || "Continue"))}</button>` : ""}
                ${issue?.secondaryAction?.id ? `<button id="${escapeHtml(issue.secondaryAction.id)}" class="rounded-full border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition">${escapeHtml(String(issue.secondaryAction.label || "Secondary action"))}</button>` : ""}
              </div>
            </article>
          `;
        }).join("")}
      </section>
    `;
  }).join("");
}

function renderNextActionRail({ actions, loading }) {
  const list = Array.isArray(actions) ? actions : [];
  if (list.length === 0) return "";
  const rank = { must_fix_now: 0, recommended_next: 1, optional_later: 2 };
  const sorted = [...list].sort((a, b) => {
    const ra = rank[String(a?.priority || "recommended_next")] ?? 9;
    const rb = rank[String(b?.priority || "recommended_next")] ?? 9;
    if (ra !== rb) return ra - rb;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
  const primary = sorted[0];
  const secondary = sorted.slice(1, 3);
  return `
    <section class="rounded-xl border border-slate-200 bg-white px-4 py-3 space-y-3">
      <div class="text-[11px] uppercase tracking-[0.12em] font-semibold text-slate-500">Next action rail</div>
      ${renderFounderActionCard(primary, loading)}
      ${secondary.length > 0
        ? `<details class="rounded-lg border border-slate-200 bg-slate-50/70">
            <summary class="cursor-pointer px-3 py-2 text-xs font-medium text-slate-600">More actions (${secondary.length})</summary>
            <div class="px-3 pb-3 space-y-2">
              ${secondary.map((action) => renderFounderActionCard(action, loading)).join("")}
            </div>
          </details>`
        : ""}
    </section>
  `;
}

function renderProjectDiagnosis({ status, doctorReport, loading, launchState, inputText = "", makerScreen = "localDiagnosis", projectSource = { mode: "local" }, fixProgressStep = 0, resultBanner = null, activityLog = [] }) {
  const projectName = resolveProjectName(status);
  const showProjectName = isUserFacingProjectName(projectName);
  const branch = status?.git?.branch ? String(status.git.branch) : null;
  const framework = status?.stack?.framework ? toStackLabel("framework", status.stack.framework) : null;
  const deployTarget = status?.stack?.deploy ? toStackLabel("deploy", status.stack.deploy) : null;
  const lastDeployUrl = String(status?.vercel?.lastDeployUrl || "").trim();
  const hasExistingDeploy = Boolean(lastDeployUrl);
  const lastDeployRecency = formatDeployRecency(status?.vercel?.lastDeployAt);
  const proof = resolveDeployProofState({
    projectSource: { mode: "local" },
    launchState,
    status,
    doctorReport,
  });
  const inspectionFindings = getInspectionFindings(status);

  const report = doctorReport && typeof doctorReport === "object" ? doctorReport : null;
  const checks = report && Array.isArray(report.checks) ? report.checks : [];
  const issues = report && Array.isArray(report.issues) ? report.issues : [];
  const isScanning = !report;
  const hasAutofix = getDoctorAutofixActions(doctorReport).length > 0;
  const doctorActions = report && Array.isArray(report.actions) ? report.actions : [];
  const checklist = getLaunchChecklist(launchState);
  const firstMissingStep = checklist.find((step) => !step.done);
  const topIssue = issues[0] && typeof issues[0] === "object"
    ? normalizeFounderBlockerText(String(issues[0].message || "").trim())
    : "";
  const okChecks = checks.filter((check) => String(check?.status || "") === "ok").length;
  const totalChecks = checks.length;
  const copy = resolveDiagnosisCopyFromProof({
    proof,
    isScanning,
    hasAutofix,
    topIssue,
    firstMissingStep,
    okChecks,
    totalChecks,
  });
  const priority = resolveFounderPriority({ proof, isScanning });
  const mission = resolveFounderMissionControlModel({ proof, copy, priority, isScanning });
  const verificationEvidenceUnits = resolveVerificationEvidenceUnits({
    proof,
    doctorReport,
    status,
    launchState,
    activityLog,
    resultBanner,
    projectSource,
    loading,
  });
  const founderActions = resolveFounderActionUnits({
    proof,
    doctorReport,
    loading,
    makerScreen,
    projectSource,
    inspectionFindings,
    fixProgressStep,
    resultBanner,
    activityLog,
    verificationEvidenceUnits,
  });
  const verificationEvidence = resolveVerificationEvidenceUnits({
    proof,
    doctorReport,
    status,
    launchState,
    activityLog,
    resultBanner,
    projectSource,
    loading,
    actions: founderActions,
  });
  const founderIssues = resolveFounderIssuesModel({
    proof,
    doctorReport,
    projectSource,
    loading,
    makerScreen,
    inspectionFindings,
    fixProgressStep,
    resultBanner,
    activityLog,
    verificationEvidenceUnits: verificationEvidence,
  });
  const recoveryUnits = resolveFounderRecoveryUnits({
    actions: founderActions,
    doctorReport,
    proof,
    projectSource,
    loading,
    evidenceUnits: verificationEvidence,
  });
  const sessionContinuity = resolveOperatorSessionContinuity({
    actions: founderActions,
    evidenceUnits: verificationEvidence,
    activityLog,
    resultBanner,
    loading,
    makerScreen,
    projectSource,
  });
  const nextActionRail = renderNextActionRail({ actions: founderActions, loading });
  const missingInputFlow = renderMissingInputFlow({ actions: founderActions, recoveryUnits, loading, expanded: false });
  const issueGroupsHtml = renderFounderIssueGroups({ issues: founderIssues, loading });
  const executionCenter = renderOperationExecutionCenter({ actions: founderActions, loading, activityLog, resultBanner });
  const liveHealth = resolveLiveHealthState({
    proof,
    status,
    launchState,
    doctorReport,
    activityLog,
    resultBanner,
    projectSource,
    loading,
    evidenceUnits: verificationEvidence,
  });
  const watchMode = resolveWatchModeState({
    proof,
    liveHealth,
    evidenceUnits: verificationEvidence,
    continuity: sessionContinuity,
    status,
    activityLog,
    loading,
    projectSource,
  });
  const topRecoveryUnit = Array.isArray(recoveryUnits)
    ? recoveryUnits.find((unit) => unit?.captureAction?.id && String(unit?.severity || "") !== "optional")
    : null;
  const topRecoveryAction = topRecoveryUnit?.captureAction && topRecoveryUnit.captureAction.id
    ? topRecoveryUnit.captureAction
    : null;
  const ctaDedupeIds = new Set(["fixNextBtn", "runFixNowBtn", "verifyLiveAppBtn", "reviewMissingBtn"]);
  const shouldRouteHeroToRecovery = Boolean(
    topRecoveryAction?.id
    && proof?.primaryAction?.id
    && ctaDedupeIds.has(String(proof.primaryAction.id))
    && ctaDedupeIds.has(String(topRecoveryAction.id))
    && String(proof.primaryAction.id) !== "openFirstVersionExternalBtn",
  );
  const heroPrimaryAction = shouldRouteHeroToRecovery
    ? { id: "reviewMissingBtn", label: "Go to recovery step" }
    : (proof?.primaryAction || null);
  const watchModeForRender = (() => {
    if (!topRecoveryAction?.id) return watchMode;
    const watchPrimaryId = String(watchMode?.primaryRecheckAction?.id || "");
    if (!watchPrimaryId || watchPrimaryId === "openFirstVersionExternalBtn") return watchMode;
    if (!ctaDedupeIds.has(watchPrimaryId)) return watchMode;
    return {
      ...watchMode,
      primaryRecheckAction: { id: "reviewMissingBtn", label: "Go to recovery step" },
    };
  })();

  const contextPills = [
    branch ? `<span class="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">${escapeHtml(branch)}</span>` : "",
    framework && framework !== "Not detected" ? `<span class="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">${escapeHtml(framework)}</span>` : "",
    deployTarget && deployTarget !== "Not detected" ? `<span class="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">${escapeHtml(deployTarget)}</span>` : "",
  ].filter(Boolean).join(" ");

  const checksHtml = isScanning
    ? `<div class="flex items-center gap-2 py-3 text-sm text-slate-500">
        <span class="h-2 w-2 rounded-full bg-sky-500 animate-pulse"></span>
        Scanning your project environment…
      </div>`
    : checks.map((check) => {
      const detail = check?.detail ? `<span class="ml-1 text-slate-400">— ${escapeHtml(check.detail)}</span>` : "";
      return `<div class="flex items-start gap-2.5 rounded-lg border ${diagnosisCheckRowClass(check.status)} px-3 py-2">
        <span class="mt-0.5 text-sm leading-none">${diagnosisCheckIcon(check.status)}</span>
        <div class="min-w-0">
          <span class="text-sm font-medium text-slate-800">${escapeHtml(check.label || "Check")}</span>
          ${detail}
          ${check.status !== "ok" && check.message ? `<div class="text-xs text-slate-500 mt-0.5">${escapeHtml(check.message)}</div>` : ""}
        </div>
      </div>`;
    }).join("");

  // Doctor actions (manual commands like "vercel login")
  const manualActionsHtml = doctorActions
    .filter((a) => String(a?.type || "") === "manual" && String(a?.command || "").trim())
    .map((a) => {
      const cmd = String(a.command || "");
      return `<div class="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <span class="text-xs text-slate-600">${escapeHtml(a.description || a.label || "")}</span>
        <code class="ml-auto rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 font-mono">${escapeHtml(cmd)}</code>
        <button data-copy-text="${escapeHtml(cmd)}" class="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50">Copy</button>
      </div>`;
    }).join("");

  // Primary action buttons
  const fixBusy = Boolean(loading?.fixNextBtn);
  const deployBusy = Boolean(loading?.deployNowBtn);
  const scanningBusy = Boolean(loading?.aiAnalyzeBtn);
  let primaryCta = "";
  let secondaryActions = "";
  if (isScanning) {
    primaryCta = `<button id="aiAnalyzeBtn" ${scanningBusy ? "disabled" : ""} class="rounded-full bg-emerald-700 text-white px-5 py-2.5 text-sm font-semibold hover:bg-emerald-800 transition ${scanningBusy ? "opacity-60 cursor-not-allowed" : ""}">${scanningBusy ? "Scanning…" : "Scan this project"}</button>`;
  } else {
    const actionBusyMap = {
      fixNextBtn: fixBusy,
      deployNowBtn: deployBusy,
      aiAnalyzeBtn: scanningBusy,
      runFixNowBtn: Boolean(loading?.runFixNowBtn),
      openFirstVersionExternalBtn: false,
      requestChangesFromPreviewBtn: false,
      requestChangesBtn: false,
    };
    const primaryAction = heroPrimaryAction && heroPrimaryAction.id ? heroPrimaryAction : null;
    if (primaryAction) {
      const busy = Boolean(actionBusyMap[primaryAction.id]);
      primaryCta = `<button id="${escapeHtml(primaryAction.id)}" ${busy ? "disabled" : ""} class="rounded-full bg-emerald-700 text-white px-5 py-2.5 text-sm font-semibold hover:bg-emerald-800 transition ${busy ? "opacity-60 cursor-not-allowed" : ""}">${busy ? "Working…" : escapeHtml(String(primaryAction.label || "Continue"))}</button>`;
    } else if (hasExistingDeploy) {
      primaryCta = `<a href="${escapeHtml(lastDeployUrl)}" target="_blank" rel="noopener noreferrer" class="rounded-full bg-emerald-700 text-white px-5 py-2.5 text-sm font-semibold hover:bg-emerald-800 transition inline-flex items-center gap-1.5">Open deploy <span class="text-emerald-300">↗</span></a>`;
    } else {
      primaryCta = `<button id="deployNowBtn" ${deployBusy ? "disabled" : ""} class="rounded-full bg-emerald-700 text-white px-5 py-2.5 text-sm font-semibold hover:bg-emerald-800 transition ${deployBusy ? "opacity-60 cursor-not-allowed" : ""}">${deployBusy ? "Deploying…" : "Deploy now"}</button>`;
    }
    secondaryActions = Array.isArray(proof?.secondaryActions)
      ? proof.secondaryActions
          .filter((action) => action && action.id && action.id !== heroPrimaryAction?.id)
          .map((action) => renderProofActionButton(action, false))
          .join("")
      : "";
  }

  return `
    <div class="rounded-2xl border border-slate-300/75 bg-white p-5 shadow-[0_12px_28px_rgba(15,23,42,0.08)] space-y-4">
      <section class="rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/60 px-4 py-4">
        <div class="flex flex-wrap items-center gap-2">
          <span class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${escapeHtml(String(proof?.badgeTone || "bg-slate-100 text-slate-800"))}">
            ${escapeHtml(String(proof?.badgeLabel || "Not yet proven"))}
          </span>
          <span class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${mission.priorityTone}">${escapeHtml(mission.priorityLabel)}</span>
        </div>
        <h2 class="mt-3 text-xl font-semibold text-slate-900">${escapeHtml(mission.heroHeadline)}</h2>
        <p class="mt-1 text-sm text-slate-700">${escapeHtml(mission.heroSummary)}</p>
        <div class="mt-3 flex flex-wrap gap-2">
          ${primaryCta}
          ${secondaryActions}
        </div>
        ${proof?.url ? `
          <div class="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2">
            <div class="text-[11px] uppercase tracking-[0.12em] font-semibold text-emerald-800">${proof.variant === "live_stable" || proof.variant === "live_needs_input" ? "Live URL" : "Preview URL"}</div>
            <a href="${escapeHtml(proof.url)}" target="_blank" rel="noopener noreferrer" class="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-800 hover:text-emerald-900 break-all">
              ${escapeHtml(proof.url)} <span class="text-emerald-600">↗</span>
            </a>
            ${lastDeployRecency ? `<p class="mt-1 text-xs text-emerald-800/80">${escapeHtml(lastDeployRecency)}</p>` : ""}
          </div>
        ` : ""}
        <div class="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <span>Project: ${escapeHtml(showProjectName ? projectName : "Current project")}</span>
          <span>•</span>
          <span>Source: ${escapeHtml(String(proof?.sourceIdentity || "Local project"))}</span>
          ${contextPills ? `<span>•</span><span class="inline-flex flex-wrap gap-1">${contextPills}</span>` : ""}
        </div>
        ${(() => {
          const isLive = proof?.variant === "live_needs_input" || proof?.variant === "live_stable";
          const waitingText = sessionContinuity?.waitingOnUser
            ? String(sessionContinuity.waitingOnUser?.handoff?.requiredInput || sessionContinuity.waitingOnUser?.title || "your input")
            : "";
          return isLive && waitingText ? `
          <div class="mt-3 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 text-xs text-amber-900">
            <span class="font-semibold">Deplo is waiting on you:</span> ${escapeHtml(waitingText)}
          </div>` : "";
        })()}
      </section>

      ${(() => {
        const isLiveVariant = proof?.variant === "live_needs_input" || proof?.variant === "live_stable";
        if (isLiveVariant) {
          // Live apps: keep a focused stack with explicit inline execution feedback.
          return `
            ${executionCenter}
            ${missingInputFlow}
            ${renderVerificationEvidenceSection({ evidenceUnits: verificationEvidence, loading })}
          `;
        }
        // Pre-deploy / preview states: lean composition.
        const detailSections = [
          renderOperatorSessionContinuity({ continuity: sessionContinuity, loading, compact: true }),
          nextActionRail,
          issueGroupsHtml,
        ].filter((section) => String(section || "").trim().length > 0).join("");
        return `
          ${executionCenter}
          ${missingInputFlow}
          ${renderVerificationEvidenceSection({ evidenceUnits: verificationEvidence, loading })}
          ${detailSections ? `
            <details class="rounded-xl border border-slate-200 bg-white">
              <summary class="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700 hover:text-slate-900 transition">More operational detail</summary>
              <div class="px-4 pb-4 space-y-3">
                ${detailSections}
              </div>
            </details>
          ` : ""}
        `;
      })()}

      ${(() => {
        const isLiveVariant = proof?.variant === "live_needs_input" || proof?.variant === "live_stable";
        // For live apps: Hero covers status, Missing Input covers action, Watch Mode covers monitoring.
        // Live Health is redundant — suppress it and show only Watch Mode.
        if (isLiveVariant) {
          return renderWatchModeSection({ watch: watchModeForRender, loading });
        }
        // For pre-deploy states: show both Live Health and Watch Mode
        return `
          ${renderLiveHealthSection(liveHealth, proof, showProjectName ? projectName : "Current project", loading)}
          ${renderWatchModeSection({ watch: watchModeForRender, loading })}
        `;
      })()}

      <details class="rounded-xl border border-slate-200 bg-white">
        <summary class="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700 hover:text-slate-900 transition">Technical details</summary>
        <div class="px-4 pb-4 space-y-3">
          <div>
            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-[0.12em] mb-2">Checks</h3>
            <div class="space-y-1.5">${checksHtml}</div>
          </div>
          ${manualActionsHtml ? `<div><h3 class="text-xs font-semibold text-slate-500 uppercase tracking-[0.12em] mb-2">Manual actions</h3><div class="space-y-1.5">${manualActionsHtml}</div></div>` : ""}
          <div class="pt-1">
            <button id="startGithubBtn" class="rounded-full border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition">Import from GitHub instead</button>
          </div>
        </div>
      </details>
    </div>
  `;
}

function renderGithubImportState({ projectSource, loading, status = null, inputText = "", activityLog = [], resultBanner = null }) {
  const phase = String(projectSource?.phase || "idle");
  const repoLabel = String(projectSource?.repoFullName || "").trim();
  const repoUrl = String(projectSource?.repoUrl || "").trim();
  const statusLine = phase === "importing"
    ? "Connecting your GitHub project and preparing project context."
    : phase === "checking"
      ? "Checking what Deplo can verify from GitHub in this session."
      : phase === "limited"
        ? "GitHub project connected. Full deploy diagnosis is not confirmed from GitHub alone."
        : "Connect a GitHub repo to start this project workspace.";
  const connectedLine = repoLabel
    ? `${repoLabel}${repoUrl ? ` · ${repoUrl}` : ""}`
    : "No repository URL captured yet.";
  const hasConnectedRepo = Boolean(repoUrl || repoLabel);
  const capabilityLine = hasConnectedRepo
    ? "GitHub connection is saved in this session."
    : "Deplo is waiting for your GitHub repo URL.";
  const limitationLine = hasConnectedRepo
    ? "Deplo still needs local access to fully verify build setup, environment requirements, and deploy readiness."
    : "No connected repository yet.";
  const whatDeploCanDoLine = hasConnectedRepo
    ? "Deplo can carry this repo context forward, guide local diagnosis, and verify results after each step."
    : "Deplo can connect your repository and prepare a guided diagnosis path.";
  const whatYouNeedLine = hasConnectedRepo
    ? "Check local project for full diagnosis."
    : "Paste your GitHub URL to connect this project.";
  const payoffLine = hasConnectedRepo
    ? "After this, Deplo can confirm what blocks launch and give you one clear next action."
    : "After this, Deplo can start a guided project check.";
  const heroHeadline = hasConnectedRepo
    ? "Your GitHub project is connected"
    : "Connect your GitHub project";
  const heroSummary = hasConnectedRepo
    ? "Connection worked. Deplo still needs local access for a full run-readiness diagnosis."
    : "Start by connecting a repository source.";
  const inspectionFindings = getInspectionFindings(status);
  const githubProof = {
    variant: "no_proof_yet",
    hasBlockingInput: true,
    remainingInputSeverity: "recommended",
    primaryAction: { id: "startScanBtn", label: "Check local project" },
  };
  const githubVerificationEvidenceSeed = resolveVerificationEvidenceUnits({
    proof: githubProof,
    doctorReport: null,
    status,
    launchState: {},
    activityLog,
    resultBanner,
    projectSource,
    loading,
  });
  const githubActions = resolveFounderActionUnits({
    proof: githubProof,
    doctorReport: null,
    loading,
    makerScreen: "githubImport",
    projectSource,
    inspectionFindings,
    fixProgressStep: 0,
    resultBanner: null,
    hasConnectedRepo,
    verificationEvidenceUnits: githubVerificationEvidenceSeed,
  });
  const githubVerificationEvidence = resolveVerificationEvidenceUnits({
    proof: githubProof,
    doctorReport: null,
    status,
    launchState: {},
    activityLog,
    resultBanner,
    projectSource,
    loading,
    actions: githubActions,
  });
  const githubIssues = resolveFounderIssuesModel({
    proof: githubProof,
    doctorReport: null,
    projectSource,
    loading,
    makerScreen: "githubImport",
    inspectionFindings,
    hasConnectedRepo,
    verificationEvidenceUnits: githubVerificationEvidence,
  });
  const githubRecoveryUnits = resolveFounderRecoveryUnits({
    actions: githubActions,
    doctorReport: null,
    proof: githubProof,
    projectSource,
    loading,
    evidenceUnits: githubVerificationEvidence,
  });
  const githubSessionContinuity = resolveOperatorSessionContinuity({
    actions: githubActions,
    evidenceUnits: githubVerificationEvidence,
    activityLog,
    resultBanner,
    loading,
    makerScreen: "githubImport",
    projectSource,
  });
  const githubRail = renderNextActionRail({ actions: githubActions, loading });
  const githubExecutionCenter = renderOperationExecutionCenter({ actions: githubActions, loading, activityLog, resultBanner });
  const githubMissingInputFlow = renderMissingInputFlow({ actions: githubActions, recoveryUnits: githubRecoveryUnits, loading, expanded: true });
  const githubIssueGroups = renderFounderIssueGroups({ issues: githubIssues, loading });
  const inspectionSummary = renderInspectionFindingsSummary(status, "github");
  return `
    <div class="rounded-2xl border border-slate-300/75 bg-white p-5 shadow-[0_12px_28px_rgba(15,23,42,0.08)] space-y-4">
      <section class="rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/60 px-4 py-4">
        <div class="flex flex-wrap items-center gap-2">
          <span class="inline-flex items-center rounded-full bg-sky-100 text-sky-800 px-2.5 py-1 text-xs font-semibold">
            ${hasConnectedRepo ? "Repo connected" : "Awaiting repo URL"}
          </span>
          <span class="inline-flex items-center rounded-full bg-amber-100 text-amber-800 border border-amber-200 px-2.5 py-1 text-xs font-semibold">
            Recommended next
          </span>
        </div>
        <h2 class="mt-3 text-xl font-semibold text-slate-900">${escapeHtml(heroHeadline)}</h2>
        <p class="mt-1 text-sm text-slate-700">${escapeHtml(heroSummary)}</p>
        ${hasConnectedRepo ? `<div class="mt-3 text-xs text-slate-500">Deplo saved this source and can continue from here.</div>` : ""}
        <div class="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <span>${escapeHtml(capabilityLine)}</span>
          <span>•</span>
          <span class="break-all">${escapeHtml(connectedLine)}</span>
        </div>
      </section>

      ${renderOperatorSessionContinuity({ continuity: githubSessionContinuity, loading, compact: true })}

      ${githubRail}

      ${githubExecutionCenter}

      ${inspectionSummary}

      ${githubMissingInputFlow}

      ${githubIssueGroups}

      ${renderVerificationEvidenceSection({ evidenceUnits: githubVerificationEvidence, loading, compact: true })}

      <section class="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 space-y-3">
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] font-semibold text-slate-500">Next step</div>
          <p class="mt-1 text-sm text-slate-700">${escapeHtml(whatYouNeedLine)}</p>
          <p class="mt-1 text-xs text-slate-500">${escapeHtml(payoffLine)}</p>
        </div>
        ${hasConnectedRepo
          ? `<div class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 break-all">
              <span class="font-medium text-slate-700">Connected repo:</span> ${escapeHtml(repoUrl || repoLabel)}
            </div>`
          : `<div>
              <div class="text-[11px] uppercase tracking-[0.12em] font-semibold text-slate-500">Import / connect</div>
              <p class="mt-1 text-sm text-slate-700">Paste your repo URL, then continue.</p>
              <div class="mt-2">${renderCommandInput({ loading, text: inputText, buttonLabel: "Check imported repo" })}</div>
              <div class="mt-2 text-xs text-slate-500">Use a URL like: https://github.com/owner/repo</div>
            </div>`
        }
        <p class="text-xs text-slate-500">${escapeHtml(whatDeploCanDoLine)} · ${escapeHtml(statusLine)} · Use New project to switch source.</p>
      </section>
    </div>
  `;
}

function renderLocalInspectionState({ status }) {
  const projectName = resolveProjectName(status);
  const showProjectName = isUserFacingProjectName(projectName);
  const label = showProjectName ? projectName : "Current folder project";
  return `
    <div class="rounded-2xl border border-slate-300/75 bg-white p-5 shadow-[0_12px_28px_rgba(15,23,42,0.08)] space-y-4">
      <div>
        <h2 class="text-xl font-semibold text-slate-900">Inspecting your project</h2>
        <p class="mt-1 text-sm text-slate-600">Source: local folder · ${escapeHtml(label)}</p>
      </div>
      <div class="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 space-y-2 text-sm text-slate-700">
        <div class="flex items-center gap-2"><span class="h-2 w-2 rounded-full bg-sky-500 animate-pulse"></span>Checking project structure</div>
        <div class="flex items-center gap-2"><span class="h-2 w-2 rounded-full bg-sky-500 animate-pulse"></span>Checking setup requirements</div>
        <div class="flex items-center gap-2"><span class="h-2 w-2 rounded-full bg-sky-500 animate-pulse"></span>Checking deploy readiness</div>
      </div>
      <p class="text-xs text-slate-500">Deplo is preparing a founder-friendly diagnosis.</p>
    </div>
  `;
}

function renderCommandInput({ loading, text, buttonLabel = "Scan this project" }) {
  const analyzeBusy = Boolean(loading?.aiAnalyzeBtn);
  return `
    <div class="rounded-xl border border-slate-200/80 bg-white p-3">
      <textarea id="ai-analyze-input" class="w-full rounded-xl border border-slate-300 bg-white text-sm shadow-inner focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100 px-4 py-3" style="font-size:15px;min-height:86px;resize:vertical;" placeholder="Paste a repo URL, then scan this project.">${escapeHtml(text || "")}</textarea>
      <div class="mt-2 flex items-center justify-between gap-2">
        <span class="text-xs text-slate-400">Example: https://github.com/your/repo</span>
        <button id="aiAnalyzeBtn" ${analyzeBusy ? "disabled" : ""} class="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition ${analyzeBusy ? "opacity-60 cursor-not-allowed" : ""}">${analyzeBusy ? "Scanning…" : escapeHtml(buttonLabel)}</button>
      </div>
    </div>
  `;
}

function resolveDeployProofState({ projectSource, launchState, status, doctorReport }) {
  const sourceMode = String(projectSource?.mode || "none");
  const env = getEnvironmentStatusFromDoctor(doctorReport);
  const hasBlockingInput = env.severity === "blocked" || env.severity === "warning";
  const issues = Array.isArray(doctorReport?.issues) ? doctorReport.issues : [];
  const topIssue = normalizeFounderBlockerText(String(issues[0]?.message || "").trim());
  const remainingInputSeverity = classifyInputSeverity(topIssue || String(env?.severity || ""));
  const remainingInputLabel = inferRemainingInputActionLabel(doctorReport);
  const url = String(status?.vercel?.lastDeployUrl || "").trim();
  const hasUrl = Boolean(url);
  const previewReady = Boolean(launchState?.previewReady || hasUrl);
  const liveReady = Boolean(launchState?.appLive);
  const hasProof = Boolean(hasUrl || previewReady || liveReady);

  const base = {
    sourceMode,
    url,
    hasUrl,
    hasProof,
    hasBlockingInput,
    checked: Boolean(doctorReport),
    fixedConfigured: !hasBlockingInput && Boolean(doctorReport),
    deployedPreviewed: hasProof,
    waitingInput: hasBlockingInput,
    remainingInputSeverity,
    remainingInputLabel,
    projectIdentity: sourceMode === "github"
      ? (String(projectSource?.repoFullName || "").trim() || "GitHub import")
      : sourceMode === "sample"
        ? "Sample project (simulated)"
        : "Current folder",
    sourceIdentity: sourceMode === "github"
      ? "GitHub import"
      : sourceMode === "sample"
        ? "Sample project"
        : sourceMode === "local"
          ? "Local project"
          : "No source selected",
  };

  if (sourceMode === "github") {
    return {
      ...base,
      variant: "no_proof_yet",
      badgeLabel: "Import in progress",
      badgeTone: "bg-sky-100 text-sky-800",
      founderMessage: "Repository source captured. Full inspection is still limited, but this project context is ready for the next guided step.",
      primaryAction: { id: "aiAnalyzeBtn", label: "Check imported repo" },
      secondaryActions: [{ id: "startScanBtn", label: "Use local project instead" }],
    };
  }

  if (sourceMode === "sample") {
    return {
      ...base,
      variant: "no_proof_yet",
      badgeLabel: "Simulated",
      badgeTone: "bg-violet-100 text-violet-800",
      founderMessage: "This is a demo flow. Proof states here are simulated for walkthrough only.",
      primaryAction: { id: "runSampleFlowBtn", label: "Run sample flow" },
      secondaryActions: [{ id: "startScanBtn", label: "Use local project instead" }],
    };
  }

  if (!hasProof) {
    return {
      ...base,
      variant: "no_proof_yet",
      badgeLabel: "Not yet proven",
      badgeTone: "bg-slate-100 text-slate-800",
      founderMessage: hasBlockingInput
        ? (remainingInputSeverity === "recommended"
            ? "No proof URL yet. One recommended setup step remains."
            : "No proof URL yet. One required setup step remains.")
        : "No proof URL yet. Deplo can deploy next.",
      primaryAction: hasBlockingInput
        ? { id: "fixNextBtn", label: remainingInputLabel }
        : { id: "aiAnalyzeBtn", label: "Check project" },
      secondaryActions: [{ id: "requestChangesBtn", label: "Request changes" }],
    };
  }

  if (liveReady && hasBlockingInput) {
    return {
      ...base,
      variant: "live_needs_input",
      badgeLabel: "Live · Needs one input",
      badgeTone: "bg-amber-100 text-amber-900",
      founderMessage: remainingInputSeverity === "recommended"
        ? "Your app is live. One recommended setup step remains for full readiness."
        : "Your app is live. One required setup step still needs your input.",
      primaryAction: hasUrl ? { id: "openFirstVersionExternalBtn", label: "Open live app" } : { id: "deployNowBtn", label: "Open live app" },
      secondaryActions: [
        { id: "fixNextBtn", label: remainingInputLabel },
        { id: "requestChangesFromPreviewBtn", label: "Request changes" },
      ],
    };
  }

  if (liveReady && !hasBlockingInput) {
    return {
      ...base,
      variant: "live_stable",
      badgeLabel: "Live",
      badgeTone: "bg-emerald-100 text-emerald-900",
      founderMessage: "Your app is live and operationally ready.",
      primaryAction: hasUrl ? { id: "openFirstVersionExternalBtn", label: "Open live app" } : { id: "deployNowBtn", label: "Open live app" },
      secondaryActions: [
        { id: "requestChangesFromPreviewBtn", label: "Request changes" },
        { id: "deployNowBtn", label: "Redeploy" },
      ],
    };
  }

  if (hasBlockingInput) {
    return {
      ...base,
      variant: "preview_needs_input",
      badgeLabel: "Preview · Needs one input",
      badgeTone: "bg-amber-100 text-amber-900",
      founderMessage: remainingInputSeverity === "recommended"
        ? "Preview is available. One recommended setup step remains for full readiness."
        : "Preview is available. One required setup step still needs your input.",
      primaryAction: hasUrl ? { id: "openFirstVersionExternalBtn", label: "Open preview" } : { id: "fixNextBtn", label: remainingInputLabel },
      secondaryActions: [
        ...(hasUrl ? [{ id: "fixNextBtn", label: remainingInputLabel }] : []),
        ...(hasUrl ? [{ id: "requestChangesFromPreviewBtn", label: "Request changes" }] : []),
      ],
    };
  }

  return {
    ...base,
    variant: "preview_ready",
    badgeLabel: "Preview",
    badgeTone: "bg-sky-100 text-sky-900",
    founderMessage: "Preview is review-ready. You can keep iterating, then ship live.",
    primaryAction: hasUrl ? { id: "openFirstVersionExternalBtn", label: "Open preview" } : { id: "deployNowBtn", label: "Prepare preview" },
    secondaryActions: [
      { id: "requestChangesFromPreviewBtn", label: "Request changes" },
      { id: "deployNowBtn", label: "Redeploy" },
    ],
  };
}

function formatVerificationRecency(ts) {
  if (!ts) return "Not checked yet";
  const date = new Date(ts);
  const ms = date.getTime();
  if (!Number.isFinite(ms)) return "Not checked yet";
  const diff = Date.now() - ms;
  if (diff < 60 * 1000) return "Verified just now";
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.max(1, Math.round(diff / (60 * 1000)));
    return `Verified ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  const hours = Math.max(1, Math.round(diff / (60 * 60 * 1000)));
  return `Verified ${hours} hour${hours === 1 ? "" : "s"} ago`;
}

function formatDeployRecency(ts) {
  if (!ts) return "";
  const date = new Date(ts);
  const ms = date.getTime();
  if (!Number.isFinite(ms)) return "";
  const diff = Date.now() - ms;
  if (diff < 60 * 1000) return "Deployed just now";
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.max(1, Math.round(diff / (60 * 1000)));
    return `Deployed ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.max(1, Math.round(diff / (60 * 60 * 1000)));
    return `Deployed ${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.max(1, Math.round(diff / (24 * 60 * 60 * 1000)));
  return `Deployed ${days} day${days === 1 ? "" : "s"} ago`;
}

function resolveLiveHealthState({ proof, status, launchState, doctorReport, activityLog, resultBanner, projectSource, loading, evidenceUnits = [] }) {
  const sourceMode = String(projectSource?.mode || "none");
  const lastDeployUrl = String(status?.vercel?.lastDeployUrl || "").trim();
  const hasDeploySignal = Boolean(lastDeployUrl || launchState?.previewReady || launchState?.appLive || proof?.hasProof);
  const liveEvidence = Array.isArray(evidenceUnits)
    ? evidenceUnits.find((unit) => String(unit?.target || "") === "live_url_reachability")
    : null;
  const runtimeEvidence = Array.isArray(evidenceUnits)
    ? evidenceUnits.find((unit) => String(unit?.target || "") === "runtime_readiness")
    : null;
  const deployEvidence = Array.isArray(evidenceUnits)
    ? evidenceUnits.find((unit) => String(unit?.target || "") === "deploy_exists")
    : null;
  const verificationRunning = Boolean(loading?.verifyLiveAppBtn);
  const liveStatus = String(liveEvidence?.status || "not_verified");
  const runtimeStatus = String(runtimeEvidence?.status || "not_verified");
  const liveRecency = String(liveEvidence?.recencyLabel || "").trim();
  const liveSummaryEvidence = String(liveEvidence?.evidenceSummary || "").trim();
  const scopeVerified = String(liveEvidence?.scopeVerified || "").trim();
  const scopeUnverified = String(liveEvidence?.scopeUnverified || "").trim();
  const deployVerified = String(deployEvidence?.status || "") === "verified";

  let state = "no_live_target";
  if (sourceMode === "github") {
    state = "no_live_target";
  } else if (!hasDeploySignal && !deployVerified) {
    state = "no_live_target";
  } else if (liveStatus === "verification_failed") {
    state = "live_check_failed";
  } else if ((liveStatus === "verified" || liveStatus === "partially_verified") && (proof?.hasBlockingInput || runtimeStatus === "partially_verified")) {
    state = "live_degraded";
  } else if (liveStatus === "verified" && !proof?.hasBlockingInput) {
    state = "live_verified";
  } else if (liveStatus === "partially_verified" || (liveStatus === "not_verified" && (launchState?.appLive || proof?.variant === "live_stable" || proof?.variant === "live_needs_input"))) {
    state = "live_unverified";
  } else if (hasDeploySignal || deployVerified) {
    state = "deploy_known_but_not_proven";
  }

  const map = {
    live_verified: {
      tone: "bg-emerald-100 text-emerald-900 border border-emerald-200",
      summary: "Your app is live and Deplo verified public access.",
      scope: scopeVerified || "Verified: live URL reachability.",
      confidence: "high",
      nextAction: proof?.hasUrl
        ? { id: "openFirstVersionExternalBtn", label: "Open live app" }
        : { id: "verifyLiveAppBtn", label: "Check app health again" },
      secondaryAction: { id: "verifyLiveAppBtn", label: "Check app health again" },
      verificationPlan: "Deplo re-checks live reachability and current setup signals.",
      verificationResult: verificationRunning ? "Running live health verification now." : (liveSummaryEvidence || "Latest verification succeeded."),
    },
    live_unverified: {
      tone: "bg-sky-100 text-sky-900 border border-sky-200",
      summary: "Your app appears live, but Deplo has not re-verified it recently.",
      scope: `Verified: ${scopeVerified || "deploy or live signal exists."} Not verified yet: ${scopeUnverified || "recent live access check."}`,
      confidence: "medium",
      nextAction: { id: "verifyLiveAppBtn", label: "Verify live app" },
      secondaryAction: proof?.hasUrl ? { id: "openFirstVersionExternalBtn", label: "Open live app" } : null,
      verificationPlan: "Deplo checks current live reachability and refreshes setup status.",
      verificationResult: verificationRunning ? "Checking now." : (liveSummaryEvidence || "No recent verification recorded."),
    },
    live_degraded: {
      tone: "bg-amber-100 text-amber-900 border border-amber-200",
      summary: "Your app is live, but one setup detail still needs attention.",
      scope: `Verified: ${scopeVerified || "app appears reachable."} Not fully verified: ${runtimeEvidence?.scopeUnverified || "full service readiness."}`,
      confidence: "medium",
      nextAction: { id: "fixNextBtn", label: proof?.remainingInputLabel || "Fix this next" },
      secondaryAction: { id: "verifyLiveAppBtn", label: "Check app health again" },
      verificationPlan: "After the fix, Deplo verifies live access and setup readiness again.",
      verificationResult: verificationRunning ? "Verification will run after this action." : (runtimeEvidence?.evidenceSummary || "One remaining issue still affects full readiness."),
    },
    live_check_failed: {
      tone: "bg-rose-100 text-rose-900 border border-rose-200",
      summary: "Your app needs attention: the last live check failed.",
      scope: `Verified: ${deployEvidence?.scopeVerified || "deploy target exists."} Not verified: ${scopeUnverified || "latest live reachability."}`,
      confidence: "low",
      nextAction: { id: "verifyLiveAppBtn", label: "Check app health again" },
      secondaryAction: proof?.hasBlockingInput ? { id: "fixNextBtn", label: proof?.remainingInputLabel || "Fix this next" } : null,
      verificationPlan: "Deplo reruns live verification and refreshes current setup status.",
      verificationResult: liveSummaryEvidence || "Last verification failed.",
    },
    deploy_known_but_not_proven: {
      tone: "bg-slate-100 text-slate-800 border border-slate-200",
      summary: "A deploy target exists, but live health is not proven yet.",
      scope: "Verified: deploy exists. Not verified yet: public live access.",
      confidence: "low",
      nextAction: { id: "verifyLiveAppBtn", label: "Verify live app" },
      secondaryAction: proof?.hasUrl ? { id: "openFirstVersionExternalBtn", label: "Open preview" } : null,
      verificationPlan: "Deplo checks whether the deployed app is publicly reachable.",
      verificationResult: verificationRunning ? "Verification running." : (liveSummaryEvidence || "No verified live check yet."),
    },
    no_live_target: {
      tone: "bg-slate-100 text-slate-800 border border-slate-200",
      summary: sourceMode === "github"
        ? "Live health is unknown from this source alone."
        : "No live target is available yet.",
      scope: sourceMode === "github"
        ? "Verified: repository source connected. Not verified: runtime health without local access."
        : "Verified: project context. Not verified: live reachability (no deploy target).",
      confidence: "low",
      nextAction: sourceMode === "github"
        ? { id: "startScanBtn", label: "Check local project" }
        : { id: "deployNowBtn", label: "Deploy now" },
      secondaryAction: sourceMode === "github" ? { id: "aiAnalyzeBtn", label: "Retry GitHub inspection" } : null,
      verificationPlan: sourceMode === "github"
        ? "Deplo verifies app health after local project checks."
        : "Deplo verifies live health after deploy.",
      verificationResult: sourceMode === "github" ? "Cannot verify fully from current source." : "No live target to verify yet.",
    },
  };

  const chosen = map[state] || map.no_live_target;
  const recencyLabel = liveRecency || (hasDeploySignal ? "Not re-checked since deploy" : "Not checked yet");
  return {
    state,
    summary: chosen.summary,
    scope: chosen.scope,
    lastVerifiedAt: liveEvidence?.verifiedAt || null,
    recencyLabel,
    confidence: chosen.confidence,
    nextAction: chosen.nextAction,
    secondaryAction: chosen.secondaryAction,
    verificationPlan: chosen.verificationPlan,
    verificationResult: chosen.verificationResult,
    tone: chosen.tone,
  };
}

function inferWatchStaleness({ liveHealth, evidenceGroups, activityLog }) {
  const label = String(liveHealth?.recencyLabel || "").toLowerCase();
  if (!label) return { staleness: "unknown", stalenessLabel: "Verification freshness is unknown." };
  if (label.includes("just now") || label.includes("minute")) {
    return { staleness: "fresh", stalenessLabel: "Verified recently." };
  }
  if (label.includes("hour")) {
    return { staleness: "recent", stalenessLabel: "Verified recently, but worth re-checking soon." };
  }
  if (label.includes("day") || label.includes("not re-checked") || label.includes("not checked")) {
    return { staleness: "stale", stalenessLabel: "Confidence is getting stale. Deplo can re-check this now." };
  }
  if (label.includes("failed")) {
    return { staleness: "stale", stalenessLabel: "Last verification failed. Re-check is recommended now." };
  }
  const entries = Array.isArray(activityLog) ? activityLog : [];
  const lastSuccess = entries.find((entry) => String(entry?.status || "") === "success");
  if (lastSuccess) return { staleness: "recent", stalenessLabel: "Last known check passed recently." };
  const hasAnyEvidence = Array.isArray(evidenceGroups) && evidenceGroups.some((g) => Array.isArray(g?.members) && g.members.length > 0);
  return hasAnyEvidence
    ? { staleness: "unknown", stalenessLabel: "Verification exists, but freshness is unclear." }
    : { staleness: "unknown", stalenessLabel: "No recent verification signal." };
}

function toTimestampMs(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function toWatchStatusLabel(status) {
  const key = String(status || "not_verified");
  if (key === "verified") return "verified";
  if (key === "partially_verified") return "partially verified";
  if (key === "verification_failed") return "check failed";
  if (key === "cannot_verify_yet") return "cannot verify yet";
  return "not fully verified";
}

function toWatchFreshnessLabel(recencyLabel = "") {
  const lower = String(recencyLabel || "").toLowerCase();
  if (!lower) return "";
  if (lower.includes("just now") || lower.includes("minute") || lower.includes("hour")) return "fresh";
  if (lower.includes("day") || lower.includes("not re-checked") || lower.includes("not checked")) return "stale";
  if (lower.includes("failed")) return "failed";
  return "";
}

function resolveWatchModeState({ proof, liveHealth, evidenceUnits, continuity, status, activityLog, loading, projectSource }) {
  const sourceMode = String(projectSource?.mode || "none");
  const groups = resolveFounderEvidenceGroups(evidenceUnits);
  const reachabilityGroup = groups.find((g) => g.id === "app_reachability") || null;
  const runtimeGroup = groups.find((g) => g.id === "service_runtime_readiness") || null;
  const deployGroup = groups.find((g) => g.id === "deploy_access_readiness") || null;
  const stalenessModel = inferWatchStaleness({ liveHealth, evidenceGroups: groups, activityLog });
  const liveStatus = String(liveHealth?.state || "no_live_target");
  const hasFailure = liveStatus === "live_check_failed" || String(reachabilityGroup?.status || "") === "verification_failed";
  const hasPartial = String(reachabilityGroup?.status || "") === "partially_verified"
    || String(runtimeGroup?.status || "") === "partially_verified"
    || String(deployGroup?.status || "") === "partially_verified";
  const hasUnverified = [reachabilityGroup, runtimeGroup, deployGroup]
    .filter(Boolean)
    .some((g) => ["not_verified", "cannot_verify_yet"].includes(String(g?.status || "")));
  const isConfident = liveStatus === "live_verified" && !hasPartial && !hasUnverified && !hasFailure && stalenessModel.staleness !== "stale";
  const deployAt = toTimestampMs(status?.vercel?.lastDeployAt);
  const latestVerifiedAt = toTimestampMs(reachabilityGroup?.verifiedAt || liveHealth?.lastVerifiedAt);
  const notCheckedSinceDeploy = Boolean(deployAt && (!latestVerifiedAt || latestVerifiedAt < deployAt));
  const staleness = notCheckedSinceDeploy ? "stale" : stalenessModel.staleness;
  const stalenessLabel = notCheckedSinceDeploy
    ? "Not re-checked since last deploy · Deplo can re-check now."
    : stalenessModel.stalenessLabel;

  const watchState = hasFailure
    ? "watch_needs_attention"
    : isConfident
      ? "watch_confident"
      : hasPartial
        ? "watch_partial"
        : staleness === "stale"
          ? "watch_stale"
          : "watch_unverified";
  const lastKnownGood = hasFailure
    ? "Last known check did not pass."
    : String(reachabilityGroup?.status || "") === "verified"
      ? "Last known live check passed."
      : liveStatus === "live_unverified"
        ? "App appears reachable from the latest known signal."
        : "Status: Not fully verified yet.";
  const watchTargets = [reachabilityGroup, runtimeGroup, deployGroup]
    .filter(Boolean)
    .map((group) => ({
      id: group.id,
      label: group.label,
      status: group.status,
      summary: `${toWatchStatusLabel(group.status)}${toWatchFreshnessLabel(group.recencyLabel) ? ` · ${toWatchFreshnessLabel(group.recencyLabel)}` : ""}`,
      recencyLabel: group.recencyLabel,
    }));

  let primaryRecheckAction = liveHealth?.nextAction || { id: "verifyLiveAppBtn", label: "Check app health again" };
  if (sourceMode === "github") {
    primaryRecheckAction = { id: "startScanBtn", label: "Continue health check" };
  } else if (watchState === "watch_partial" && String(runtimeGroup?.status || "") !== "verified") {
    primaryRecheckAction = { id: "runFixNowBtn", label: "Verify service readiness" };
  } else if (watchState === "watch_stale") {
    primaryRecheckAction = { id: "verifyLiveAppBtn", label: "Re-verify live access" };
  } else if (watchState === "watch_unverified") {
    primaryRecheckAction = { id: "verifyLiveAppBtn", label: "Re-check deploy readiness" };
  } else if (watchState === "watch_confident" && proof?.hasUrl) {
    primaryRecheckAction = { id: "verifyLiveAppBtn", label: "Check app health again" };
  }

  const secondaryRecheckAction = primaryRecheckAction?.id === "verifyLiveAppBtn" && proof?.hasUrl
    ? { id: "openFirstVersionExternalBtn", label: "Open live app" }
    : (liveHealth?.secondaryAction || null);

  const nextWatchStep = continuity?.resumableNextStep?.label
    ? `${String(continuity.resumableNextStep.label)} to refresh confidence.`
    : String(continuity?.whereNow || liveHealth?.verificationPlan || "Deplo can continue confidence checks on request.");
  const whatChanged = String(continuity?.whatChanged || "");
  const onDemandOnlyLabel = "Checks run on request. Deplo does not run background monitoring yet.";
  const confidenceLabel = watchState === "watch_confident"
    ? "High confidence"
    : watchState === "watch_partial" || watchState === "watch_stale"
      ? "Medium confidence"
      : "Low confidence";

  const recencyLower = String(liveHealth?.recencyLabel || "").toLowerCase();
  const stalenessLower = String(stalenessLabel || "").toLowerCase();
  const dedupeRecency = recencyLower.includes("not re-checked") && stalenessLower.includes("not re-checked");
  const confidenceLine = dedupeRecency
    ? stalenessLabel
    : String(liveHealth?.recencyLabel || "").trim()
      ? `${String(liveHealth.recencyLabel).trim()} · ${stalenessLabel}`
      : stalenessLabel;

  return {
    watchState,
    lastKnownGood,
    staleness,
    stalenessLabel,
    onDemandOnlyLabel,
    watchTargets,
    primaryRecheckAction,
    secondaryRecheckAction,
    nextWatchStep,
    whatChanged,
    confidenceLabel,
    lastCheckedLabel: String(liveHealth?.recencyLabel || "Not checked yet"),
    confidenceLine,
  };
}

function renderWatchModeSection({ watch, loading = {}, compact = false }) {
  if (!watch || typeof watch !== "object") return "";
  const primary = watch.primaryRecheckAction;
  const secondary = watch.secondaryRecheckAction;
  const primaryBusy = Boolean(primary?.id && loading?.[primary.id]);
  const secondaryBusy = Boolean(secondary?.id && loading?.[secondary.id]);
  const stateTone = watch.watchState === "watch_confident"
    ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
    : watch.watchState === "watch_partial" || watch.watchState === "watch_stale"
      ? "bg-amber-100 text-amber-800 border border-amber-200"
      : "bg-slate-100 text-slate-700 border border-slate-200";
  const stateLabel = ({
    watch_confident: "Keep-working: confident",
    watch_stale: "Keep-working: stale",
    watch_partial: "Keep-working: partial",
    watch_needs_attention: "Keep-working: needs attention",
    watch_unverified: "Keep-working: unverified",
  })[watch.watchState] || "Keep-working";
  return `
    <section class="rounded-xl border border-slate-200 bg-white px-4 py-3 space-y-2.5">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[11px] uppercase tracking-[0.12em] font-semibold text-slate-500">Keep working / Watch mode</span>
        <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${stateTone}">${escapeHtml(stateLabel)}</span>
        <span class="inline-flex items-center rounded-full bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 text-[11px] font-medium">${escapeHtml(String(watch.confidenceLabel || "Low confidence"))}</span>
      </div>
      <p class="text-sm text-slate-800"><span class="font-medium">Last known good:</span> ${escapeHtml(String(watch.lastKnownGood || "Not verified yet."))}</p>
      <p class="text-xs text-slate-600">${escapeHtml(String(watch.confidenceLine || watch.stalenessLabel || "Not checked yet"))}</p>
      ${!compact ? `<div class="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
        <div class="text-xs font-semibold text-slate-700">What Deplo is watching</div>
        <ul class="mt-1 space-y-1 text-xs text-slate-600">
          ${(Array.isArray(watch.watchTargets) ? watch.watchTargets : []).slice(0, 3).map((target) => `<li>• ${escapeHtml(String(target.label || "Watch target"))}: ${escapeHtml(String(target.summary || ""))}</li>`).join("")}
        </ul>
      </div>` : ""}
      ${watch.whatChanged ? `<p class="text-xs text-slate-600">What changed: ${escapeHtml(String(watch.whatChanged))}</p>` : ""}
      <p class="text-xs text-slate-500">${escapeHtml(String(watch.nextWatchStep || ""))}</p>
      <div class="flex flex-wrap gap-2">
        ${primary?.id ? `<button id="${escapeHtml(primary.id)}" ${primaryBusy ? "disabled" : ""} class="rounded-full bg-emerald-700 text-white px-3.5 py-2 text-xs font-semibold hover:bg-emerald-800 transition ${primaryBusy ? "opacity-60 cursor-not-allowed" : ""}">${primaryBusy ? "Working…" : escapeHtml(String(primary.label || "Check app health again"))}</button>` : ""}
        ${secondary?.id ? `<button id="${escapeHtml(secondary.id)}" ${secondaryBusy ? "disabled" : ""} class="rounded-full border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition ${secondaryBusy ? "opacity-60 cursor-not-allowed" : ""}">${secondaryBusy ? "Working…" : escapeHtml(String(secondary.label || "Secondary action"))}</button>` : ""}
      </div>
      <p class="text-[11px] text-slate-500">${escapeHtml(String(watch.onDemandOnlyLabel || "Checks run on request."))}</p>
    </section>
  `;
}

function renderLiveHealthSection(liveHealth, proof, projectName, loading = {}) {
  if (!liveHealth || typeof liveHealth !== "object") return "";
  const primary = liveHealth.nextAction;
  const secondary = liveHealth.secondaryAction;
  const primaryBusy = Boolean(primary?.id && loading?.[primary.id]);
  const secondaryBusy = Boolean(secondary?.id && loading?.[secondary.id]);
  const confidenceLabel = liveHealth.confidence === "high"
    ? "High confidence"
    : liveHealth.confidence === "medium"
      ? "Medium confidence"
      : "Low confidence";
  return `
    <section class="rounded-xl border border-slate-200 bg-white px-4 py-3 space-y-2.5">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[11px] uppercase tracking-[0.12em] font-semibold text-slate-500">Live health</span>
        <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${liveHealth.tone}">${escapeHtml(({
          live_verified: "live · healthy",
          live_unverified: "live · unverified",
          live_degraded: "live · needs setup",
          live_check_failed: "live · check failed",
          no_live_target: "no live target",
          deploy_known_but_not_proven: "deploy · unverified",
        })[liveHealth.state] || liveHealth.state.replaceAll("_", " "))}</span>
        <span class="inline-flex items-center rounded-full bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 text-[11px] font-medium">${confidenceLabel}</span>
      </div>
      <p class="text-sm font-medium text-slate-800">${escapeHtml(liveHealth.summary)}</p>
      <p class="text-xs text-slate-600">${escapeHtml(liveHealth.scope)}</p>
      <p class="text-xs text-slate-500">Last verified: ${escapeHtml(liveHealth.recencyLabel)}</p>
      <p class="text-xs text-slate-500">${escapeHtml(liveHealth.verificationResult || liveHealth.verificationPlan)}</p>
      <div class="flex flex-wrap gap-2">
        ${primary?.id ? `<button id="${escapeHtml(primary.id)}" ${primaryBusy ? "disabled" : ""} class="rounded-full bg-emerald-700 text-white px-3.5 py-2 text-xs font-semibold hover:bg-emerald-800 transition ${primaryBusy ? "opacity-60 cursor-not-allowed" : ""}">${primaryBusy ? "Working…" : escapeHtml(String(primary.label || "Continue"))}</button>` : ""}
        ${secondary?.id ? `<button id="${escapeHtml(secondary.id)}" ${secondaryBusy ? "disabled" : ""} class="rounded-full border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition ${secondaryBusy ? "opacity-60 cursor-not-allowed" : ""}">${secondaryBusy ? "Working…" : escapeHtml(String(secondary.label || "Secondary action"))}</button>` : ""}
      </div>
    </section>
  `;
}

function renderDeployProofStatusRow(proofState) {
  const rows = [
    { label: "Checked", done: Boolean(proofState?.checked) },
    { label: "Fixed/Configured", done: Boolean(proofState?.fixedConfigured) },
    { label: "Deployed/Previewed", done: Boolean(proofState?.deployedPreviewed) },
    { label: "Waiting input", done: !Boolean(proofState?.waitingInput), warning: Boolean(proofState?.waitingInput) },
  ];
  return `<div class="grid gap-2 text-xs md:grid-cols-4">
    ${rows.map((row) => {
      const tone = row.warning
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : row.done
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-slate-200 bg-slate-50 text-slate-600";
      const marker = row.warning ? "!" : row.done ? "✓" : "○";
      return `<div class="rounded-lg border ${tone} px-2.5 py-2">${marker} ${escapeHtml(row.label)}</div>`;
    }).join("")}
  </div>`;
}

function renderProofActionButton(action, primary = false) {
  if (!action || !action.id) return "";
  const label = escapeHtml(String(action.label || "Continue"));
  const primaryClass = "rounded-full bg-emerald-700 text-white px-4 py-2 text-sm font-semibold hover:bg-emerald-800 transition";
  const secondaryClass = "rounded-full border border-slate-300/80 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition";
  return `<button id="${escapeHtml(action.id)}" class="${primary ? primaryClass : secondaryClass}">${label}</button>`;
}

function renderEvidenceStatusChip(status) {
  const map = {
    verified: { label: "Verified", tone: "bg-emerald-100 text-emerald-800 border border-emerald-200" },
    partially_verified: { label: "Partially verified", tone: "bg-amber-100 text-amber-800 border border-amber-200" },
    not_verified: { label: "Not verified", tone: "bg-slate-100 text-slate-700 border border-slate-200" },
    verification_failed: { label: "Verification failed", tone: "bg-rose-100 text-rose-800 border border-rose-200" },
    cannot_verify_yet: { label: "Cannot verify yet", tone: "bg-slate-100 text-slate-700 border border-slate-200" },
  };
  const resolved = map[String(status || "not_verified")] || map.not_verified;
  return `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${resolved.tone}">${resolved.label}</span>`;
}

function toConfidenceLabel(level) {
  const value = String(level || "low");
  if (value === "high") return "High confidence";
  if (value === "medium") return "Medium confidence";
  return "Low confidence";
}

function findLatestActivityEntry(entries, matcher) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  return entries.find((entry) => matcher(entry)) || null;
}

function getEvidenceStatusFromEntry(entry) {
  const status = String(entry?.status || "").toLowerCase();
  if (status === "success") return "verified";
  if (status === "error" || status === "failed") return "verification_failed";
  if (status === "running" || status === "queued") return "not_verified";
  return "not_verified";
}

function resolveVerificationEvidenceUnits({
  proof,
  doctorReport,
  status,
  launchState,
  activityLog,
  resultBanner,
  projectSource,
  loading,
  actions = [],
}) {
  const sourceMode = String(projectSource?.mode || "none");
  const entries = Array.isArray(activityLog) ? activityLog : [];
  const report = doctorReport && typeof doctorReport === "object" ? doctorReport : null;
  const issues = Array.isArray(report?.issues) ? report.issues : [];
  const issueText = normalizeFounderBlockerText(String(issues[0]?.message || "").trim());
  const issueLower = issueText.toLowerCase();
  const findings = getInspectionFindings(status);
  const providerHints = Array.isArray(findings?.providerHints) ? findings.providerHints : [];
  const serviceHints = Array.isArray(findings?.serviceHints) ? findings.serviceHints : [];
  const hasDatabaseHint = serviceHints.some((item) => /supabase|prisma|drizzle/i.test(String(item?.value || "")));
  const hasProviderHint = providerHints.some((item) => /vercel|netlify|cloudflare/i.test(String(item?.value || "")));
  const hasDeploySignal = Boolean(
    String(status?.vercel?.lastDeployUrl || "").trim()
    || launchState?.previewReady
    || launchState?.appLive
    || proof?.hasProof,
  );
  const hasLiveSignal = Boolean(
    launchState?.appLive
    || proof?.variant === "live_stable"
    || proof?.variant === "live_needs_input",
  );
  const verifyEntry = findLatestActivityEntry(entries, (entry) => String(entry?.operation || "") === "verify_live");
  const deployEntry = findLatestActivityEntry(
    entries,
    (entry) => ["deploy_preview", "prepare_preview", "deploy_production", "make_app_live"].includes(String(entry?.operation || "")),
  );
  const fixEntry = findLatestActivityEntry(entries, (entry) => String(entry?.operation || "") === "run_repair");
  const bannerText = String(resultBanner?.message || "").toLowerCase();
  const bannerError = String(resultBanner?.type || "") === "error";
  const runningVerify = Boolean(loading?.verifyLiveAppBtn);
  const runningFix = Boolean(loading?.runFixNowBtn);
  const runningScan = Boolean(loading?.aiAnalyzeBtn);
  const actionUnits = Array.isArray(actions) ? actions : [];
  const findActionByButtonId = (buttonId, fallback = null) => {
    const id = String(buttonId || "").trim();
    if (!id) return fallback;
    const unit = actionUnits.find((action) => String(action?.primaryAction?.id || "") === id || String(action?.secondaryAction?.id || "") === id);
    if (!unit) return fallback;
    if (String(unit?.primaryAction?.id || "") === id) return unit.primaryAction;
    if (String(unit?.secondaryAction?.id || "") === id) return unit.secondaryAction;
    return fallback;
  };
  const fallbackNext = proof?.primaryAction || { id: "aiAnalyzeBtn", label: "Check project" };

  const buildUnit = ({
    id,
    target,
    verificationType,
    statusValue,
    evidenceSummary,
    verifiedAt = null,
    confidenceLevel = "low",
    scopeVerified = "",
    scopeUnverified = "",
    nextStepIfIncomplete = null,
    evidenceSources = [],
  }) => {
    const recencyLabel = statusValue === "verification_failed"
      ? "Last verification failed"
      : verifiedAt
        ? formatVerificationRecency(verifiedAt)
        : hasDeploySignal
          ? "Not re-checked since deploy"
          : "Not checked yet";
    return {
      id,
      target,
      verificationType,
      status: statusValue,
      evidenceSummary,
      verifiedAt,
      recencyLabel,
      confidenceLevel,
      scopeVerified,
      scopeUnverified,
      nextStepIfIncomplete,
      evidenceSources,
    };
  };

  const deployExistsStatus = hasDeploySignal
    ? (deployEntry && String(deployEntry.status || "") === "error" ? "verification_failed" : "verified")
    : sourceMode === "github"
      ? "cannot_verify_yet"
      : "not_verified";
  const deployExistsEvidence = deployExistsStatus === "verified"
    ? "Deplo confirmed a deploy target exists."
    : deployExistsStatus === "verification_failed"
      ? "Deplo attempted deployment verification, but the latest check failed."
      : sourceMode === "github"
        ? "Deplo cannot verify deploy existence from GitHub-only access."
        : "Deplo has not verified a deploy target yet.";

  let liveStatus = "not_verified";
  if (sourceMode === "github") {
    liveStatus = "cannot_verify_yet";
  } else if (verifyEntry && String(verifyEntry.status || "") === "error") {
    liveStatus = "verification_failed";
  } else if (verifyEntry && String(verifyEntry.status || "") === "success") {
    liveStatus = "verified";
  } else if (hasLiveSignal) {
    liveStatus = "partially_verified";
  } else if (hasDeploySignal) {
    liveStatus = "not_verified";
  }
  if (runningVerify) {
    liveStatus = hasLiveSignal ? "partially_verified" : "not_verified";
  }
  if (bannerError && bannerText.includes("verify live app")) {
    liveStatus = "verification_failed";
  }
  const liveEvidence = liveStatus === "verified"
    ? "Deplo confirmed the live URL is reachable."
    : liveStatus === "partially_verified"
      ? "Deplo sees a live signal, but has not completed a fresh live reachability check."
      : liveStatus === "verification_failed"
        ? "Deplo attempted a live URL check, but it failed."
        : liveStatus === "cannot_verify_yet"
          ? "Deplo cannot verify live reachability from the current source."
          : "Deplo has not verified live URL reachability yet.";

  let runtimeStatus = "not_verified";
  if (sourceMode === "github") runtimeStatus = "cannot_verify_yet";
  else if (!report) runtimeStatus = runningScan ? "not_verified" : "not_verified";
  else if (runningFix) runtimeStatus = "partially_verified";
  else if (String(report?.overall || "").toLowerCase() === "ready" && !proof?.hasBlockingInput) runtimeStatus = "verified";
  else if (issues.length > 0) runtimeStatus = "partially_verified";
  if (bannerError && (bannerText.includes("fix") || bannerText.includes("setup"))) {
    runtimeStatus = "verification_failed";
  }
  const runtimeEvidence = runtimeStatus === "verified"
    ? "Deplo verified runtime readiness checks passed."
    : runtimeStatus === "partially_verified"
      ? "Deplo verified parts of runtime setup, but one check still needs follow-up."
      : runtimeStatus === "verification_failed"
        ? "Deplo attempted runtime verification, but the last check failed."
        : runtimeStatus === "cannot_verify_yet"
          ? "Deplo needs local access before runtime readiness can be verified."
          : "Runtime readiness has not been verified yet.";

  let databaseStatus = "not_verified";
  const dbIssue = /supabase|database|prisma|drizzle|db/.test(issueLower);
  if (!hasDatabaseHint && !dbIssue) databaseStatus = sourceMode === "github" ? "cannot_verify_yet" : "not_verified";
  else if (sourceMode === "github") databaseStatus = "cannot_verify_yet";
  else if (dbIssue && proof?.hasBlockingInput) databaseStatus = "partially_verified";
  else if (runtimeStatus === "verified" && !dbIssue) databaseStatus = "verified";
  const databaseEvidence = databaseStatus === "verified"
    ? "Deplo did not find active database access blockers in current checks."
    : databaseStatus === "partially_verified"
      ? "Deplo found database setup signals, but connection readiness is still incomplete."
      : databaseStatus === "cannot_verify_yet"
        ? "Deplo cannot verify database-backed features from current access."
        : "Database-backed feature readiness has not been verified yet.";

  let providerStatus = "not_verified";
  const providerIssue = /vercel|netlify|cloudflare|login|auth|access/.test(issueLower);
  if (sourceMode === "github") providerStatus = "cannot_verify_yet";
  else if (providerIssue && proof?.hasBlockingInput) providerStatus = "partially_verified";
  else if (hasProviderHint && runtimeStatus === "verified") providerStatus = "verified";
  const providerEvidence = providerStatus === "verified"
    ? "Deplo verified deploy provider access signals are in a usable state."
    : providerStatus === "partially_verified"
      ? "Deplo found deploy provider context, but access confirmation is still incomplete."
      : providerStatus === "cannot_verify_yet"
        ? "Deplo cannot verify deploy provider access from the current source."
        : "Deploy provider access has not been verified yet.";

  const units = [
    buildUnit({
      id: "evidence-deploy-exists",
      target: "deploy_exists",
      verificationType: "deploy_signal",
      statusValue: deployExistsStatus,
      evidenceSummary: deployExistsEvidence,
      verifiedAt: deployEntry?.timestamp || (hasDeploySignal ? status?.vercel?.lastDeployAt : null),
      confidenceLevel: deployExistsStatus === "verified" ? "high" : deployExistsStatus === "partially_verified" ? "medium" : "low",
      scopeVerified: deployExistsStatus === "verified" ? "Deploy signal exists." : "",
      scopeUnverified: deployExistsStatus === "verified" ? "" : "Deploy target not fully verified yet.",
      nextStepIfIncomplete: deployExistsStatus === "verified" ? null : (findActionByButtonId("deployNowBtn", { id: "deployNowBtn", label: "Deploy now" })),
      evidenceSources: ["proof", "status", "activity"],
    }),
    buildUnit({
      id: "evidence-live-url",
      target: "live_url_reachability",
      verificationType: "live_check",
      statusValue: liveStatus,
      evidenceSummary: liveEvidence,
      verifiedAt: verifyEntry?.timestamp || null,
      confidenceLevel: liveStatus === "verified" ? "high" : liveStatus === "partially_verified" ? "medium" : "low",
      scopeVerified: liveStatus === "verified" ? "Public live URL reachability confirmed." : hasLiveSignal ? "Live signal exists." : "",
      scopeUnverified: liveStatus === "verified" ? "" : "Fresh public reachability check is still incomplete.",
      nextStepIfIncomplete: (liveStatus === "verified")
        ? null
        : (findActionByButtonId("verifyLiveAppBtn", { id: "verifyLiveAppBtn", label: "Verify live app" })),
      evidenceSources: ["proof", "activity", "resultBanner"],
    }),
    buildUnit({
      id: "evidence-runtime",
      target: "runtime_readiness",
      verificationType: "doctor_runtime",
      statusValue: runtimeStatus,
      evidenceSummary: runtimeEvidence,
      verifiedAt: fixEntry?.timestamp || null,
      confidenceLevel: runtimeStatus === "verified" ? "high" : runtimeStatus === "partially_verified" ? "medium" : "low",
      scopeVerified: runtimeStatus === "verified" ? "Core runtime checks passed." : "",
      scopeUnverified: runtimeStatus === "verified" ? "" : "Full runtime setup is still incomplete or unverified.",
      nextStepIfIncomplete: runtimeStatus === "verified" ? null : (findActionByButtonId("runFixNowBtn", fallbackNext)),
      evidenceSources: ["doctorReport", "activity", "resultBanner"],
    }),
    buildUnit({
      id: "evidence-database",
      target: "database_features",
      verificationType: "service_readiness",
      statusValue: databaseStatus,
      evidenceSummary: databaseEvidence,
      verifiedAt: null,
      confidenceLevel: databaseStatus === "verified" ? "medium" : "low",
      scopeVerified: databaseStatus === "verified" ? "Database setup appears available from current checks." : "",
      scopeUnverified: databaseStatus === "verified" ? "" : "Database-backed behavior is not fully verified yet.",
      nextStepIfIncomplete: databaseStatus === "verified" ? null : (findActionByButtonId("reviewMissingBtn", { id: "reviewMissingBtn", label: "Review what's missing" })),
      evidenceSources: ["doctorReport", "inspectionFindings"],
    }),
    buildUnit({
      id: "evidence-provider-access",
      target: "provider_access",
      verificationType: "provider_access",
      statusValue: providerStatus,
      evidenceSummary: providerEvidence,
      verifiedAt: null,
      confidenceLevel: providerStatus === "verified" ? "medium" : "low",
      scopeVerified: providerStatus === "verified" ? "Deploy provider access looks confirmed." : "",
      scopeUnverified: providerStatus === "verified" ? "" : "Provider access confirmation may still be required.",
      nextStepIfIncomplete: providerStatus === "verified" ? null : (findActionByButtonId("runFixNowBtn", fallbackNext)),
      evidenceSources: ["doctorReport", "inspectionFindings"],
    }),
  ];

  return units;
}

function resolveFounderEvidenceGroups(evidenceUnits) {
  const units = Array.isArray(evidenceUnits) ? evidenceUnits : [];
  const targets = {
    app_reachability: ["live_url_reachability"],
    service_runtime_readiness: ["runtime_readiness", "database_features"],
    deploy_access_readiness: ["deploy_exists", "provider_access"],
  };
  const statusRank = {
    verification_failed: 5,
    cannot_verify_yet: 4,
    partially_verified: 3,
    not_verified: 2,
    verified: 1,
  };
  const confidenceRank = { low: 1, medium: 2, high: 3 };
  const confidenceFromRank = (rank) => (rank >= 3 ? "high" : rank === 2 ? "medium" : "low");
  const groupMeta = {
    app_reachability: { label: "App reachability", summary: "Public app access and reachability evidence." },
    service_runtime_readiness: { label: "Service/runtime readiness", summary: "Runtime and connected-service readiness evidence." },
    deploy_access_readiness: { label: "Deploy/access readiness", summary: "Deploy target and platform access evidence." },
  };
  return Object.keys(targets).map((key) => {
    const members = units.filter((item) => targets[key].includes(String(item?.target || "")));
    const worst = members.reduce((acc, item) => {
      const s = String(item?.status || "not_verified");
      return statusRank[s] > statusRank[acc] ? s : acc;
    }, "verified");
    const bestConfidenceRank = members.reduce((acc, item) => {
      const c = String(item?.confidenceLevel || "low");
      return Math.max(acc, confidenceRank[c] || 1);
    }, 1);
    const latest = members
      .map((item) => String(item?.verifiedAt || "").trim())
      .filter(Boolean)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
    const verifiedBits = members.map((item) => String(item?.scopeVerified || "").trim()).filter(Boolean);
    const unverifiedBits = members.map((item) => String(item?.scopeUnverified || "").trim()).filter(Boolean);
    const next = members.find((item) => item?.nextStepIfIncomplete?.id && String(item?.status || "") !== "verified");
    const evidenceSummary = members.find((item) => String(item?.status || "") === "verification_failed")?.evidenceSummary
      || members.find((item) => String(item?.status || "") === "partially_verified")?.evidenceSummary
      || members.find((item) => String(item?.status || "") === "not_verified")?.evidenceSummary
      || members.find((item) => String(item?.status || "") === "cannot_verify_yet")?.evidenceSummary
      || members.find((item) => String(item?.status || "") === "verified")?.evidenceSummary
      || groupMeta[key].summary;
    return {
      id: key,
      label: groupMeta[key].label,
      status: worst,
      confidenceLevel: confidenceFromRank(bestConfidenceRank),
      recencyLabel: latest ? formatVerificationRecency(latest) : "Not checked yet",
      evidenceSummary: String(evidenceSummary || groupMeta[key].summary),
      scopeVerified: verifiedBits.join(" "),
      scopeUnverified: unverifiedBits.join(" "),
      nextStepIfIncomplete: next?.nextStepIfIncomplete || null,
      members,
    };
  });
}

function renderVerificationEvidenceSection({ evidenceUnits, loading = {}, compact = false }) {
  const groups = resolveFounderEvidenceGroups(evidenceUnits);
  if (groups.length === 0) return "";
  const shown = compact ? groups.slice(0, 2) : groups;
  return `
    <section class="rounded-xl border border-slate-200 bg-white px-4 py-3 space-y-2.5">
      <div class="text-[11px] uppercase tracking-[0.12em] font-semibold text-slate-500">Verification evidence</div>
      <div class="space-y-2">
        ${shown.map((group) => {
          const nextAction = group?.nextStepIfIncomplete && group.nextStepIfIncomplete.id ? group.nextStepIfIncomplete : null;
          const nextBusy = Boolean(nextAction?.id && loading?.[nextAction.id]);
          const status = String(group?.status || "not_verified");
          const recency = String(group?.recencyLabel || "").trim();
          const showRecency = Boolean(
            recency
            && !(
              recency.toLowerCase() === "not checked yet"
              && (status === "not_verified" || status === "partially_verified" || status === "cannot_verify_yet")
            ),
          );
          return `
            <article class="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3 space-y-1.5">
              <div class="flex flex-wrap items-center gap-2">
                ${renderEvidenceStatusChip(group.status)}
                <span class="inline-flex items-center rounded-full bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 text-[11px] font-medium">${escapeHtml(toConfidenceLabel(group.confidenceLevel))}</span>
              </div>
              <p class="text-xs font-semibold text-slate-700">${escapeHtml(String(group.label || "Evidence group"))}</p>
              <p class="text-sm font-medium text-slate-800">${escapeHtml(String(group.evidenceSummary || ""))}</p>
              ${group.scopeVerified ? `<p class="text-xs text-slate-600"><span class="font-medium text-slate-700">Verified:</span> ${escapeHtml(String(group.scopeVerified))}</p>` : ""}
              ${group.scopeUnverified ? `<p class="text-xs text-slate-600"><span class="font-medium text-slate-700">Not verified:</span> ${escapeHtml(String(group.scopeUnverified))}</p>` : ""}
              ${showRecency ? `<p class="text-xs text-slate-500">${escapeHtml(recency)}</p>` : ""}
              ${!compact ? `<details class="rounded-md border border-slate-200 bg-white px-2.5 py-2">
                <summary class="cursor-pointer text-[11px] font-medium text-slate-600">Evidence scope</summary>
                <ul class="mt-1 space-y-1 text-[11px] text-slate-600">
                  ${(Array.isArray(group.members) ? group.members : []).map((member) => `<li>• ${escapeHtml(String(member?.evidenceSummary || ""))}</li>`).join("")}
                </ul>
              </details>` : ""}
              ${nextAction ? `<button id="${escapeHtml(nextAction.id)}" ${nextBusy ? "disabled" : ""} class="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition ${nextBusy ? "opacity-60 cursor-not-allowed" : ""}">${nextBusy ? "Working…" : escapeHtml(String(nextAction.label || "Continue"))}</button>` : ""}
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function resolveMakerStateLabel({ onboardingDone, makerStarted, makerScreen, doctorReport, launchState, loading, activityLog, projectSource, status }) {
  const sourceMode = String(projectSource?.mode || "none");
  if (sourceMode === "github") {
    const phase = String(projectSource?.phase || "importing");
    if (phase === "importing") return "importing";
    if (phase === "checking") return "scanning";
    if (phase === "limited") return "repo connected";
    return "ready for next step";
  }
  if (sourceMode === "sample") {
    const phase = String(projectSource?.phase || "demo-idle");
    if (phase === "demo-running") return "scanning";
    if (phase === "demo-ready") return "demo complete";
    return "starting";
  }
  if (!onboardingDone && !makerStarted) return "starting";
  const recent = Array.isArray(activityLog) ? activityLog.slice(0, 3) : [];
  if (recent.some((entry) => String(entry?.status || "") === "error")) return "needs review";
  if (Boolean(loading?.aiAnalyzeBtn) || !doctorReport) return "scanning";
  if (makerScreen === "fixFlow") {
    return Boolean(loading?.runFixNowBtn) ? "fixing" : "needs input";
  }
  if (Boolean(loading?.fixNextBtn)) return "fixing";
  if (makerScreen === "updatingDraft" || Boolean(loading?.deployNowBtn) || Boolean(loading?.founderLaunchAppBtn)) return "deploying";
  const proof = resolveDeployProofState({ projectSource, launchState, status, doctorReport });
  if (proof.variant === "live_needs_input") return "live · needs one input";
  if (proof.variant === "preview_needs_input") return "preview · needs one input";
  if (proof.variant === "preview_ready") return "preview";
  if (proof.variant === "no_proof_yet" && makerStarted) return "not yet proven";
  if (makerScreen === "liveState" && proof.hasProof) return "reviewing";
  if (proof.variant === "live_stable") return "live";
  if (makerStarted) return "building";
  return "starting";
}

function renderMakerOrientationLayer({
  onboardingDone,
  entryIntent,
  makerStarted,
  makerScreen,
  doctorReport,
  status,
  launchState,
  loading,
  activityLog,
  resultBanner,
  projectSource,
}) {
  if (makerScreen === "sourceSelection") {
    return "";
  }
  const state = resolveMakerStateLabel({ onboardingDone, makerStarted, makerScreen, doctorReport, launchState, loading, activityLog, projectSource, status });
  const sourceMode = String(projectSource?.mode || "none");
  const projectName = resolveProjectName(status);
  const showProjectName = isUserFacingProjectName(projectName);
  const sourceName = sourceMode === "github"
    ? String(projectSource?.repoFullName || "").trim() || "GitHub repository"
    : sourceMode === "sample"
      ? "Sample project"
      : (showProjectName ? projectName : "Current folder");
  const statusLead = sourceMode === "github" ? "repo connected" : state;
  const lastActivity = Array.isArray(activityLog) && activityLog.length > 0 ? activityLog[0] : null;
  const recentUpdate = String(lastActivity?.message || resultBanner?.message || "").trim();
  const showBack = makerScreen !== "localDiagnosis";

  return `
    <section class="max-w-3xl mx-auto mt-3 px-4">
      <div class="rounded-xl border border-slate-200 bg-white/90 px-4 py-2.5 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="font-semibold uppercase tracking-[0.12em] text-slate-500">Context</span>
            <span class="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700">${escapeHtml(statusLead)}</span>
            <span class="text-slate-300">•</span>
            <span class="text-slate-600">Source: ${escapeHtml(sourceMode === "none" ? "not selected" : sourceMode)}</span>
            <span class="text-slate-300">•</span>
            <span class="text-slate-600">Project: ${escapeHtml(sourceName)}</span>
          </div>
          <div class="flex items-center gap-2">
            ${showBack ? '<button id="makerBackBtn" class="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 transition">Back</button>' : ""}
            <button id="projectHomeInlineBtn" class="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 transition">Project home</button>
          </div>
        </div>
        ${recentUpdate ? `<p class="mt-1 text-xs text-slate-500">Recent update: ${escapeHtml(recentUpdate)}</p>` : ""}
      </div>
    </section>
  `;
}

function renderFixNextFlow({ doctorReport, loading, showDetails = false, fixProgressStep = 0, proof = null, projectSource = { mode: "local" }, status = null, resultBanner = null, activityLog = [] }) {
  const hasAutofix = getDoctorAutofixActions(doctorReport).length > 0;
  const blocker = normalizeFounderBlockerText(String((doctorReport?.issues || [])[0]?.message || "One setup detail still needs your input."));
  const issues = Array.isArray(doctorReport?.issues) ? doctorReport.issues : [];
  const manualActions = Array.isArray(doctorReport?.actions)
    ? doctorReport.actions.filter((action) => String(action?.type || "") === "manual")
    : [];
  const fixSteps = ["Reviewing blocker", "Applying safe changes", "Preparing redeploy", "Redeploying", "Ready for review"];
  const showProgress = Boolean(loading?.runFixNowBtn);
  const stageLabel = showProgress
    ? "Applying safe fix"
    : showDetails
      ? "Review what's missing"
      : "Understand blocker";
  const primaryLabel = hasAutofix ? "Apply safe fix" : "Recheck after input";
  const verificationEvidenceSeed = resolveVerificationEvidenceUnits({
    proof: proof || { hasBlockingInput: true, hasProof: false },
    doctorReport,
    status,
    launchState: {},
    activityLog,
    resultBanner,
    projectSource,
    loading,
  });
  const actionUnits = resolveFounderActionUnits({
    proof: proof || { hasBlockingInput: true, hasProof: false },
    doctorReport,
    loading,
    makerScreen: "fixFlow",
    projectSource,
    inspectionFindings: getInspectionFindings(status),
    fixProgressStep,
    resultBanner,
    activityLog,
    verificationEvidenceUnits: verificationEvidenceSeed,
  });
  const verificationEvidence = resolveVerificationEvidenceUnits({
    proof: proof || { hasBlockingInput: true, hasProof: false },
    doctorReport,
    status,
    launchState: {},
    activityLog,
    resultBanner,
    projectSource,
    loading,
    actions: actionUnits,
  });
  const fixRecoveryUnits = resolveFounderRecoveryUnits({
    actions: actionUnits,
    doctorReport,
    proof: proof || { hasBlockingInput: true, hasProof: false },
    projectSource,
    loading,
    evidenceUnits: verificationEvidence,
  });
  const fixSessionContinuity = resolveOperatorSessionContinuity({
    actions: actionUnits,
    evidenceUnits: verificationEvidence,
    activityLog,
    resultBanner,
    loading,
    makerScreen: "fixFlow",
    projectSource,
  });
  const actionRail = renderNextActionRail({ actions: actionUnits, loading });
  const executionCenter = renderOperationExecutionCenter({ actions: actionUnits, loading, activityLog, resultBanner });
  const missingInputFlow = renderMissingInputFlow({ actions: actionUnits, recoveryUnits: fixRecoveryUnits, loading, expanded: showDetails });
  return `
    <div class="max-w-3xl mx-auto p-4 space-y-4" id="appBody">
      <section class="rounded-2xl border border-slate-300/75 bg-white p-5 shadow-[0_12px_28px_rgba(15,23,42,0.08)] space-y-4">
        <div class="text-xs uppercase tracking-[0.14em] text-slate-400">Fix this next</div>
        <div class="text-xs text-slate-500">${escapeHtml(stageLabel)}</div>
        <h2 class="text-xl font-semibold text-slate-900">We'll fix the blocker and get you closer to live</h2>
        <p class="text-sm text-slate-600">${escapeHtml(blocker)}</p>
        ${actionRail}
        ${executionCenter}
        ${renderOperatorSessionContinuity({ continuity: fixSessionContinuity, loading, compact: true })}
        ${missingInputFlow}
        ${renderVerificationEvidenceSection({ evidenceUnits: verificationEvidence, loading, compact: true })}
        <div class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">What Deplo does automatically</div>
          <ul class="mt-2 space-y-1 text-sm text-slate-700">
            <li>• Runs safe setup fixes first</li>
            <li>• Rechecks your project status</li>
            <li>• Prepares redeploy when ready</li>
          </ul>
        </div>
        <div class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">What still needs your input</div>
          <p class="mt-1 text-sm text-slate-700">${manualActions.length > 0 ? "A setup detail may still need your input." : "No manual input is required yet."}</p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">What success looks like</div>
          <p class="mt-1 text-sm text-slate-700">${hasAutofix ? "Deplo applies the safe fix and updates your readiness." : "You'll see exactly what to provide next, then Deplo continues."}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button id="runFixNowBtn" ${loading?.runFixNowBtn ? "disabled" : ""} class="rounded-full bg-emerald-700 text-white px-5 py-2.5 text-sm font-semibold hover:bg-emerald-800 transition ${loading?.runFixNowBtn ? "opacity-60 cursor-not-allowed" : ""}">${loading?.runFixNowBtn ? "Applying safe fix…" : primaryLabel}</button>
          <button id="reviewMissingBtn" class="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">Review what's missing</button>
          <button id="cancelFixNextBtn" class="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">Back</button>
        </div>
        ${showProgress
          ? `<div class="pt-1">
              <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
                ${fixSteps.map((label, index) => {
                  if (index < fixProgressStep) {
                    return `<span class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-800"><span>✓</span><span>${escapeHtml(label)}</span></span>`;
                  }
                  if (index === fixProgressStep) {
                    return `<span class="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-800"><span class="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse"></span><span>${escapeHtml(label)}</span></span>`;
                  }
                  return `<span class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-500"><span>○</span><span>${escapeHtml(label)}</span></span>`;
                }).join('<span class="text-slate-300">•</span>')}
              </div>
              <p class="mt-2 text-xs text-slate-500">Deplo is applying safe fixes and preparing redeploy.</p>
            </div>`
          : ""}
        ${showDetails
          ? `<div class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 space-y-2">
              <div class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">What's missing right now</div>
              ${issues.length > 0
                ? `<ul class="space-y-1 text-sm text-slate-700">${issues.slice(0, 3).map((issue) => `<li>• ${escapeHtml(normalizeFounderBlockerText(String(issue?.message || "")))}</li>`).join("")}</ul>`
                : '<p class="text-sm text-slate-700">One setup detail still needs your input.</p>'}
              ${manualActions.length > 0
                ? `<div class="pt-1">
                    <div class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">What you may need to provide</div>
                    <ul class="mt-1 space-y-1 text-sm text-slate-700">${manualActions.slice(0, 2).map((action) => `<li>• ${escapeHtml(String(action?.description || action?.label || "Manual setup input needed."))}</li>`).join("")}</ul>
                  </div>`
                : ""}
            </div>`
          : ""}
      </section>
    </div>
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
        ? "○ One step needs your input"
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
      reason: "One step needs your input before shipping.",
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

function resolveProjectName(status) {
  const explicit = String(status?.project?.name || "").trim();
  if (explicit) return explicit;
  const root = String(status?.project?.root || "").trim();
  if (!root) return "Current project";
  const parts = root.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || "Current project";
}

function isUserFacingProjectName(name) {
  const value = String(name || "").trim();
  if (!value) return false;
  const lower = value.toLowerCase();
  if (["current project", "current folder", "local project", "your project", "unknown project", "project"].includes(lower)) {
    return false;
  }
  return true;
}

function resolveMakerStage({ makerStarted, launchState, status, makerScreen, onboardingDone, entryIntent, projectSource, doctorReport }) {
  const sourceMode = String(projectSource?.mode || "none");
  if (entryIntent === "onboarding") return "Onboarding";
  if (sourceMode === "github") {
    const phase = String(projectSource?.phase || "importing");
    if (phase === "importing") return "Importing";
    if (phase === "checking") return "Checking";
    return "GitHub import";
  }
  if (sourceMode === "sample") {
    const phase = String(projectSource?.phase || "demo-idle");
    if (phase === "demo-running") return "Sample run";
    if (phase === "demo-ready") return "Sample complete";
    return "Sample";
  }
  if (makerScreen === "updatingDraft") return "Applying changes";
  if (makerScreen === "fixFlow") return "Fix";
  if (makerScreen === "liveState") return "Reviewing deploy";
  if (!makerStarted && !onboardingDone) return "Start";
  if (!makerStarted) return "Scan";
  const proof = resolveDeployProofState({ projectSource, launchState, status, doctorReport });
  if (proof.variant === "live_stable") return "Live";
  if (proof.variant === "live_needs_input") return "Live";
  if (proof.variant === "preview_needs_input") return "Fix";
  if (proof.variant === "preview_ready") return "Reviewing deploy";
  return "Checking";
}

function renderConsoleShell({ status, expertMode, makerStarted, launchState, makerScreen, onboardingDone, entryIntent, projectSource, doctorReport, hasChosenProjectSource }) {
  const projectName = resolveProjectName(status);
  const showProjectName = isUserFacingProjectName(projectName);
  const stage = resolveMakerStage({ makerStarted, launchState, status, makerScreen, onboardingDone, entryIntent, projectSource, doctorReport });
  const sourceMode = String(projectSource?.mode || "none");
  const sourceLabel = !hasChosenProjectSource || sourceMode === "none"
    ? "Choose source"
    : sourceMode === "github"
    ? "GitHub import"
    : sourceMode === "sample"
      ? "Sample project"
      : "Local project";
  const sourceName = !hasChosenProjectSource || sourceMode === "none"
    ? ""
    : sourceMode === "github"
    ? String(projectSource?.repoFullName || "").trim()
    : sourceMode === "sample"
      ? "Sample demo"
      : (showProjectName ? projectName : "");
  const inSourceSelection = !hasChosenProjectSource || makerScreen === "sourceSelection";
  const showStartOver = !expertMode && !inSourceSelection && (makerStarted || makerScreen !== "localDiagnosis");
  return `
    <header class="sticky top-0 z-40 border-b border-slate-200/80 bg-slate-50/95 backdrop-blur">
      <div class="max-w-6xl mx-auto px-4 py-3">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <span class="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-600 shadow-[0_0_0_5px_rgba(16,185,129,0.14)]"></span>
            <button id="deploHomeBtn" class="text-base font-semibold text-slate-900 hover:text-slate-700 transition">Deplo</button>
            ${inSourceSelection
      ? `<span class="rounded-full border border-slate-300/70 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600">Source selection</span>`
      : `<span class="text-slate-300">/</span><button id="projectHomeBtn" class="truncate text-sm text-slate-600 hover:text-slate-800 transition">${escapeHtml(sourceName || sourceLabel)}</button><span class="rounded-full border border-slate-300/70 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600">${escapeHtml(sourceLabel)}</span>`}
          </div>
          <div class="flex items-center gap-2">
            ${!inSourceSelection ? '<button id="startBtn" class="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition">New project</button>' : ""}
            ${showStartOver ? '<button id="startOverBtn" class="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition">New project</button>' : ""}
            <span class="rounded-full border border-slate-300/70 bg-white px-2.5 py-1 text-xs text-slate-700">${escapeHtml(inSourceSelection ? "Source selection" : stage)}</span>
            ${expertMode
    ? '<button id="closeExpertToolsBtn" class="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition">Hide expert tools</button>'
    : '<button id="openExpertToolsBtn" class="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition">Expert tools</button>'}
          </div>
        </div>
      </div>
    </header>
  `;
}

function renderMakerPipelineStrip({ makerStarted, launchState, status, doctorReport, projectSource }) {
  const sourceMode = String(projectSource?.mode || "none");
  if (sourceMode === "sample") {
    const phase = String(projectSource?.phase || "demo-idle");
    const activeIndex = phase === "demo-running" ? 1 : phase === "demo-ready" ? 3 : 0;
    const steps = ["Scan", "Fix", "Deploy", "Live"].map((label, index) => ({
      label,
      active: index === activeIndex,
      done: index < activeIndex,
    }));
    return `
      <div class="sticky top-[57px] z-30 border-b border-slate-200/70 bg-white/90 backdrop-blur">
        <div class="max-w-6xl mx-auto px-4 py-2">
        <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span class="text-slate-500 mr-1">Flow</span>
          ${steps.map((step) => `
            <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${step.active
      ? "bg-sky-100 text-sky-800 border border-sky-200/80"
      : step.done
        ? "bg-emerald-100 text-emerald-800 border border-emerald-200/80"
        : "bg-slate-100 text-slate-600 border border-slate-200/80"}">
              <span>${step.done ? "✓" : step.active ? "●" : "○"}</span>
              <span>${step.label}</span>
            </span>
          `).join("")}
        </div>
        </div>
      </div>
    `;
  }
  if (sourceMode === "github") {
    const phase = String(projectSource?.phase || "importing");
    const activeIndex = 0;
    const steps = ["Scan", "Fix", "Deploy", "Live"].map((label, index) => ({
      label,
      active: index === activeIndex,
      done: index < activeIndex,
    }));
    return `
      <div class="sticky top-[57px] z-30 border-b border-slate-200/70 bg-white/90 backdrop-blur">
        <div class="max-w-6xl mx-auto px-4 py-2">
        <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span class="text-slate-500 mr-1">Flow</span>
          ${steps.map((step) => `
            <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${step.active
      ? "bg-sky-100 text-sky-800 border border-sky-200/80"
      : step.done
        ? "bg-emerald-100 text-emerald-800 border border-emerald-200/80"
        : "bg-slate-100 text-slate-600 border border-slate-200/80"}">
              <span>${step.done ? "✓" : step.active ? "●" : "○"}</span>
              <span>${step.label}</span>
            </span>
          `).join("")}
        </div>
        </div>
      </div>
    `;
  }
  const proof = resolveDeployProofState({ projectSource, launchState, status, doctorReport });
  const steps = [
    { label: "Scan", done: Boolean(proof.checked), active: !proof.checked },
    {
      label: "Fix",
      done: Boolean(proof.fixedConfigured),
      active: proof.waitingInput,
    },
    {
      label: "Deploy",
      done: Boolean(proof.deployedPreviewed),
      active: proof.variant === "no_proof_yet" && !proof.waitingInput && proof.checked,
    },
    {
      label: "Live",
      done: proof.variant === "live_stable" || proof.variant === "live_needs_input",
      active: proof.variant === "live_stable",
      warning: proof.variant === "live_needs_input",
    },
  ];
  return `
    <div class="sticky top-[57px] z-30 border-b border-slate-200/70 bg-white/90 backdrop-blur">
      <div class="max-w-6xl mx-auto px-4 py-2">
      <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span class="text-slate-500 mr-1">Flow</span>
        ${steps.map((step) => `
          <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${step.active
    ? (step.warning ? "bg-amber-100 text-amber-800 border border-amber-200/80" : "bg-sky-100 text-sky-800 border border-sky-200/80")
    : step.warning
      ? "bg-amber-100 text-amber-800 border border-amber-200/80"
    : step.done
      ? "bg-emerald-100 text-emerald-800 border border-emerald-200/80"
      : "bg-slate-100 text-slate-600 border border-slate-200/80"}">
            <span>${step.warning ? "!" : step.done ? "✓" : step.active ? "●" : "○"}</span>
            <span>${step.label}</span>
          </span>
        `).join("")}
      </div>
      </div>
    </div>
  `;
}

// renderAiChatExecutionPlanSection removed — replaced by renderProjectDiagnosis + renderCommandInput

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

  const statusLine = (analyzing || (!hasPlan && started))
    ? `<div class="flex items-center gap-2 text-sm text-sky-800">
        <span class="h-2 w-2 rounded-full bg-sky-500 animate-pulse"></span>
        Setting up and running checks...
      </div>`
    : `<div class="text-sm text-emerald-800">&#10003; Setup complete — your deploy is ready to review</div>`;

  const nextResult = readyForReview
    ? "Your deploy is ready to review."
    : "Next, review and verify your deploy.";
  const showLaunchButton = Boolean(firstIncomplete);

  return `
    <div class="mt-4 rounded-2xl border border-slate-200/70 bg-white/90 p-4">
      <h3 class="text-base font-semibold text-slate-900">Project status</h3>
      <p class="mt-1 text-sm text-slate-600">Review your deploy and request changes.</p>
      ${statusLine}
      <div class="mt-3 flex flex-wrap gap-2">
        <button id="openFirstVersionBtn" class="rounded-full bg-emerald-700 text-white px-4 py-2 text-sm font-semibold hover:bg-emerald-800 transition">Open deploy</button>
        <button id="requestChangesBtn" class="rounded-full border border-slate-300/80 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">Request changes</button>
      </div>
      <div class="mt-3 text-sm font-medium text-slate-800">What's set up</div>
      <ul class="mt-1 space-y-1 text-xs text-slate-600">
        ${summaryLines.map((line) => `<li>• ${escapeHtml(line)}</li>`).join("")}
      </ul>
      ${needsInput
        ? `<p class="mt-3 text-sm text-amber-800">&#9888; ${escapeHtml(makerStepOutcome(firstIncomplete))}</p>`
        : ""}
      ${showLaunchButton
        ? `<div class="mt-3">
          <button id="founderLaunchAppBtn" ${loading?.founderLaunchAppBtn ? "disabled" : ""} class="rounded-full bg-emerald-700 text-white px-4 py-2 text-sm font-semibold hover:bg-emerald-800 transition ${loading?.founderLaunchAppBtn ? "opacity-60 cursor-not-allowed" : ""}">${loading?.founderLaunchAppBtn ? nextAction.loadingLabel : nextAction.buttonLabel}</button>
        </div>`
        : ""}
      ${launchProgress ? `<p class="mt-2 text-sm text-slate-700">${escapeHtml(launchProgress)}</p>` : ""}
      <p class="mt-3 text-sm text-emerald-800">${escapeHtml(nextResult)}</p>
    </div>
  `;
}

function renderFirstVersionContent({ status, executionPlan, launchState, doctorReport, appliedChangeRequest = "", projectSource, activityLog = [], resultBanner = null, loading = {} }) {
  const ideaText = String(executionPlan?.rawInput || "");
  const projectType = inferProjectType(ideaText);
  const included = previewIncludedList(projectType, ideaText);
  const hasAppliedUpdate = String(appliedChangeRequest || "").trim().length > 0;
  const appliedUpdateText = String(appliedChangeRequest || "").trim();
  const proof = resolveDeployProofState({ projectSource, launchState, status, doctorReport });
  const hasLivePreview = proof.hasUrl;
  const firstVersionUrl = proof.url;
  const projectName = resolveProjectName(status);
  const projectDisplay = String(projectName || "").trim() && String(projectName || "").trim() !== "Current project"
    ? String(projectName || "").trim()
    : proof.projectIdentity;
  const primaryAction = renderProofActionButton(proof.primaryAction, true);
  const secondaryActions = Array.isArray(proof.secondaryActions)
    ? proof.secondaryActions.map((action) => renderProofActionButton(action, false)).join("")
    : "";
  const readinessTone = proof.waitingInput
    ? "border-amber-200 bg-amber-50/90 text-amber-900"
    : "border-emerald-200 bg-emerald-50/90 text-emerald-900";
  const firstVersionEvidence = resolveVerificationEvidenceUnits({
    proof,
    doctorReport,
    status,
    launchState,
    activityLog,
    resultBanner,
    projectSource,
    loading,
  });
  const liveHealth = resolveLiveHealthState({
    proof,
    status,
    launchState,
    doctorReport,
    activityLog,
    resultBanner,
    projectSource,
    loading,
    evidenceUnits: firstVersionEvidence,
  });
  const firstVersionActions = resolveFounderActionUnits({
    proof,
    doctorReport,
    loading,
    makerScreen: "firstVersion",
    projectSource,
    inspectionFindings: getInspectionFindings(status),
    fixProgressStep: 0,
    resultBanner,
    activityLog,
    verificationEvidenceUnits: firstVersionEvidence,
  });
  const firstVersionContinuity = resolveOperatorSessionContinuity({
    actions: firstVersionActions,
    evidenceUnits: firstVersionEvidence,
    activityLog,
    resultBanner,
    loading,
    makerScreen: "firstVersion",
    projectSource,
  });
  const watchMode = resolveWatchModeState({
    proof,
    liveHealth,
    evidenceUnits: firstVersionEvidence,
    continuity: firstVersionContinuity,
    status,
    activityLog,
    loading,
    projectSource,
  });

  return `
    <section class="rounded-2xl border border-slate-200/75 bg-white/82 p-5 shadow-md space-y-5">
      <div class="text-xs uppercase tracking-[0.18em] text-slate-400">Deploy</div>
      <div class="space-y-1">
        <h2 class="text-xl font-semibold text-slate-900">${escapeHtml(projectDisplay)}</h2>
        <p class="text-sm text-slate-600">${escapeHtml(proof.founderMessage)}</p>
        <p class="text-xs text-slate-500">Source: ${escapeHtml(proof.sourceIdentity)} · ${escapeHtml(proof.badgeLabel)}</p>
        ${proof.hasUrl ? `<p class="text-sm font-medium text-slate-800">${proof.variant === "live_stable" || proof.variant === "live_needs_input" ? "Live at" : "Preview at"} <a href="${escapeHtml(firstVersionUrl)}" target="_blank" rel="noopener noreferrer" class="text-emerald-700 hover:text-emerald-800 underline underline-offset-2">${escapeHtml(firstVersionUrl)}</a></p>` : ""}
      </div>
      <!-- Browser chrome frame -->
      <div class="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden shadow-sm">
        <div class="flex items-center gap-2 px-3 py-2 bg-slate-100/80 border-b border-slate-200">
          <div class="flex gap-1.5">
            <span class="h-2.5 w-2.5 rounded-full bg-rose-400/70"></span>
            <span class="h-2.5 w-2.5 rounded-full bg-amber-400/70"></span>
            <span class="h-2.5 w-2.5 rounded-full bg-emerald-400/70"></span>
          </div>
          <div class="flex-1 rounded-md bg-white border border-slate-200 px-3 py-1 text-xs text-slate-500 truncate">${hasLivePreview ? escapeHtml(firstVersionUrl) : "URL pending"}</div>
          <span class="rounded-full px-2 py-0.5 text-[10px] font-medium ${proof.badgeTone}">${escapeHtml(proof.badgeLabel)}</span>
        </div>
        ${hasLivePreview
          ? `<iframe src="${escapeHtml(firstVersionUrl)}" title="First version preview" class="h-[460px] w-full bg-white"></iframe>`
          : `<div class="p-4">
              ${renderFallbackDraftArtifact(projectType, ideaText)}
              <p class="mt-3 text-sm text-slate-500 text-center">Preparing your proof URL…</p>
            </div>`}
      </div>

      ${hasAppliedUpdate
        ? `<p class="text-xs text-emerald-700">Updated based on: "${escapeHtml(appliedUpdateText)}"</p>`
        : ""}

      ${renderDeployProofStatusRow(proof)}
      ${renderLiveHealthSection(liveHealth, proof, projectDisplay, loading)}
      ${renderWatchModeSection({ watch: watchMode, loading, compact: true })}

      <ul class="space-y-1.5 text-sm text-slate-600">
        ${included.map((line) => `<li class="flex items-start gap-2"><span class="text-emerald-600 mt-0.5">✓</span> ${escapeHtml(line)}</li>`).join("")}
      </ul>

      <p class="text-sm ${readinessTone} rounded-lg px-3 py-2">${escapeHtml(proof.founderMessage)}</p>

      <div class="flex flex-wrap gap-2.5">
        ${primaryAction}
        ${secondaryActions}
        <button id="closeFirstVersionPreviewBtn" class="rounded-full border border-slate-300/80 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">Back</button>
        <button id="projectHomeInlineBtn" class="rounded-full bg-transparent px-2 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 transition">Project home</button>
      </div>
    </section>
  `;
}

// renderWhatHappensNextCard removed — redundant with pipeline strip

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
  makerScreen,
  onboardingDone,
  entryIntent,
  projectSource,
  resultBanner,
}) {
  const sourceMode = String(projectSource?.mode || "none");
  const started = Boolean(makerStarted);
  const proof = resolveDeployProofState({ projectSource, launchState, status, doctorReport });
  const firstVersionAvailable = sourceMode === "local" && started && Boolean(status?.vercel?.lastDeployUrl || launchState?.previewReady || launchState?.appLive);
  const postIdeaBuilding = started && !firstVersionAvailable;
  const nextAction = getPrimaryNextActionState(doctorReport);
  const hasIncompleteLaunchSteps = getLaunchChecklist(launchState).some((step) => !step.done);
  const showSetupProgress = postIdeaBuilding && hasIncompleteLaunchSteps && nextAction.mode !== "shipping";
  const compactStatusLine = started
    ? `<p class="text-xs text-slate-500">${
      firstVersionAvailable
        ? proof.founderMessage
        : "Setting up your project. One clear next step at a time."
    }</p>`
    : "";
  const ideaQuote = String(executionPlan?.rawInput || "").trim();
  const resolvedProjectName = String(resolveProjectName(status) || "").trim();
  const projectNameDisplay = resolvedProjectName && resolvedProjectName !== "Current project"
    ? resolvedProjectName
    : proof.projectIdentity;
  const summaryLines = firstVersionSummary(inferProjectType(ideaQuote));
  const firstVersionUrl = String(proof.url || "").trim();
  const hasFirstVersionUrl = Boolean(firstVersionUrl);
  const checklist = getLaunchChecklist(launchState);
  const doneSteps = checklist.filter((step) => step.done).map((step) => makerStepOutcome(step));
  const nextMissingStep = checklist.find((step) => !step.done);
  const canFixNow = nextAction.mode === "setup_fix";
  const needsInputNow = nextAction.mode !== "shipping";
  const liveHealth = resolveLiveHealthState({
    proof,
    status,
    launchState,
    doctorReport,
    activityLog,
    resultBanner,
    projectSource,
    loading,
    evidenceUnits: resolveVerificationEvidenceUnits({
      proof,
      doctorReport,
      status,
      launchState,
      activityLog,
      resultBanner,
      projectSource,
      loading,
    }),
  });
  const showOnboarding = makerScreen === "sourceSelection";
  const showLocalInspection = makerScreen === "localInspection" && sourceMode === "local";
  const showGithubImport = makerScreen === "githubImport" && sourceMode === "github";
  const samplePhase = String(projectSource?.phase || "demo-idle");
  const showSampleFlow = makerScreen === "sampleFlow" && sourceMode === "sample";
  const showLocalDiagnosis = makerScreen === "localDiagnosis" && sourceMode === "local";
  return [
    '<div class="max-w-3xl mx-auto p-4 space-y-4" id="appBody">',
    showOnboarding
      ? renderOnboardingScreen(status)
      : "",
    showGithubImport
      ? renderGithubImportState({ projectSource, loading, status, inputText: executionPlan.rawInput, activityLog, resultBanner })
      : "",
    showLocalInspection
      ? renderLocalInspectionState({ status })
      : "",
    showSampleFlow
      ? `<section class="rounded-2xl border border-slate-300/75 bg-white p-5 shadow-[0_12px_28px_rgba(15,23,42,0.08)] space-y-3">
          <h2 class="text-xl font-semibold text-slate-900">Sample project flow</h2>
          <p class="text-sm text-slate-600">You're in demo mode. This walkthrough is simulated and does not run real deploy actions.</p>
          <div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            ${samplePhase === "demo-running"
              ? "Running sample walkthrough: scan → fix → deploy → live (simulated)."
              : samplePhase === "demo-ready"
                ? "Sample walkthrough complete. You can restart or switch to a real project."
                : "Start a safe walkthrough to see the Deplo flow."}
          </div>
          <div class="flex flex-wrap gap-2">
            <button id="runSampleFlowBtn" class="rounded-full bg-emerald-700 text-white px-4 py-2 text-sm font-semibold hover:bg-emerald-800 transition">${samplePhase === "demo-ready" ? "Run sample again" : "Run sample flow"}</button>
            <button id="startScanBtn" class="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">Use local project instead</button>
          </div>
        </section>`
      : "",
    showLocalDiagnosis && !started
      ? renderProjectDiagnosis({
          status,
          doctorReport,
          loading,
          launchState,
          inputText: executionPlan.rawInput,
          makerScreen,
          projectSource,
          resultBanner,
          activityLog,
        })
      : "",
    showLocalDiagnosis && postIdeaBuilding
      ? [
        '<section class="rounded-2xl border border-slate-300/70 bg-white p-4 shadow-soft space-y-3">',
        '<h2 class="text-lg font-semibold text-slate-900">Setting up your project</h2>',
        ideaQuote ? `<blockquote class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">"${escapeHtml(ideaQuote)}"</blockquote>` : "",
        '<div class="flex items-center gap-2 text-sm text-sky-800"><span class="h-2 w-2 rounded-full bg-sky-500 animate-pulse"></span>Running setup steps</div>',
        `<div class="grid gap-2 text-xs md:grid-cols-2">
          <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div class="font-medium text-slate-700">Scanned</div>
            <div class="mt-1 text-slate-600">${summaryLines[0] ? escapeHtml(summaryLines[0]) : "Project scanned and checked."}</div>
          </div>
          <div class="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
            <div class="font-medium text-emerald-800">What is ready</div>
            <div class="mt-1 text-emerald-700">${doneSteps.length > 0 ? escapeHtml(doneSteps.join(" • ")) : "Scan complete. Ready for checks."}</div>
          </div>
          <div class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <div class="font-medium text-amber-800">Needs attention</div>
            <div class="mt-1 text-amber-700">${nextMissingStep ? escapeHtml(makerStepOutcome(nextMissingStep)) : "No blockers detected."}</div>
          </div>
          <div class="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2">
            <div class="font-medium text-sky-800">Next step</div>
            <div class="mt-1 text-sky-700">${canFixNow ? "Safe setup fixes can run now." : "Ready to redeploy and verify."}</div>
          </div>
        </div>`,
        needsInputNow && nextMissingStep
          ? `<p class="text-sm text-amber-800">Needs your input: ${escapeHtml(makerStepOutcome(nextMissingStep))}</p>`
          : "",
        compactStatusLine,
        '<div class="flex flex-wrap gap-2">',
        `<button id="founderLaunchAppBtn" ${loading?.founderLaunchAppBtn ? "disabled" : ""} class="rounded-full bg-emerald-700 text-white px-4 py-2 text-sm font-semibold hover:bg-emerald-800 transition ${loading?.founderLaunchAppBtn ? "opacity-60 cursor-not-allowed" : ""}">${loading?.founderLaunchAppBtn ? nextAction.loadingLabel : nextAction.buttonLabel}</button>`,
        '<button id="requestChangesBtn" class="rounded-full border border-slate-300/80 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">Request changes</button>',
        "</div>",
        "</section>",
      ].join("")
      : "",
    showLocalDiagnosis && firstVersionAvailable
      ? [
        '<section class="rounded-2xl border border-slate-300/70 bg-white p-4 shadow-soft space-y-3">',
        `<h2 class="text-lg font-semibold text-slate-900">${escapeHtml(projectNameDisplay)}</h2>`,
        `<p class="text-sm text-slate-600">${escapeHtml(proof.founderMessage)}</p>`,
        `<p class="text-xs text-slate-500">Source: ${escapeHtml(proof.sourceIdentity)} · Stage: ${escapeHtml(proof.badgeLabel)}</p>`,
        proof.hasUrl
          ? `<p class="text-sm font-medium text-slate-800">${proof.variant === "live_stable" || proof.variant === "live_needs_input" ? "Live at" : "Preview at"} <a href="${escapeHtml(firstVersionUrl)}" target="_blank" rel="noopener noreferrer" class="text-emerald-700 hover:text-emerald-800 underline underline-offset-2">${escapeHtml(firstVersionUrl)}</a></p>`
          : "",
        '<div class="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">',
        '<div class="flex items-center gap-2 px-3 py-2 bg-slate-100/80 border-b border-slate-200">',
        '<span class="h-2 w-2 rounded-full bg-rose-300"></span><span class="h-2 w-2 rounded-full bg-amber-300"></span><span class="h-2 w-2 rounded-full bg-emerald-300"></span>',
        hasFirstVersionUrl
          ? `<a href="${escapeHtml(firstVersionUrl)}" target="_blank" rel="noopener noreferrer" class="flex-1 rounded-md border border-emerald-200 bg-white px-2 py-1 text-xs font-medium text-emerald-900 truncate hover:bg-emerald-50 transition">${escapeHtml(firstVersionUrl)}</a>`
          : '<div class="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 truncate">URL pending</div>',
        `<span class="rounded-full px-2 py-0.5 text-[10px] font-medium ${proof.badgeTone}">${escapeHtml(proof.badgeLabel)}</span>`,
        '</div>',
        `<div class="h-40 bg-gradient-to-b from-white to-slate-50 p-3">${renderFallbackDraftArtifact(inferProjectType(ideaQuote), ideaQuote)}</div>`,
        '</div>',
        renderDeployProofStatusRow(proof),
        renderLiveHealthSection(liveHealth, proof, projectNameDisplay, loading),
        '<div class="flex flex-wrap gap-2">',
        renderProofActionButton(proof.primaryAction, true),
        ...(Array.isArray(proof.secondaryActions) ? proof.secondaryActions.map((action) => renderProofActionButton(action, false)) : []),
        '<button id="closeFirstVersionPreviewBtn" class="rounded-full border border-slate-300/80 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">Back</button>',
        "</div>",
        compactStatusLine,
        "</section>",
      ].join("")
      : "",
    showSetupProgress
      ? renderFounderSetupProgress(launchState, loading, launchProgress, launchStepStates, doctorReport)
      : "",
    "</div>",
  ].join("");
}

function renderFirstVersionScreen({ status, executionPlan, launchState, doctorReport, appliedChangeRequest = "", projectSource, activityLog = [], resultBanner = null, loading = {} }) {
  return [
    '<div class="max-w-5xl mx-auto p-4 space-y-4" id="appBody">',
    renderFirstVersionContent({ status, executionPlan, launchState, doctorReport, appliedChangeRequest, projectSource, activityLog, resultBanner, loading }),
    "</div>",
  ].join("");
}

function renderChangeRequestScreen({ validationMessage = "", status = null }) {
  const currentVersionUrl = String(status?.vercel?.lastDeployUrl || "").trim();
  return [
    '<div class="max-w-3xl mx-auto p-4 space-y-4" id="appBody">',
    '<section class="rounded-2xl border border-slate-200/75 bg-white/88 p-4 shadow-soft space-y-3">',
    '<div class="text-xs font-medium uppercase tracking-[0.12em] text-slate-400">Current deploy</div>',
    '<div class="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">',
    '<div class="flex items-center gap-2 px-3 py-2 bg-slate-100/80 border-b border-slate-200">',
    '<span class="h-2 w-2 rounded-full bg-rose-300"></span><span class="h-2 w-2 rounded-full bg-amber-300"></span><span class="h-2 w-2 rounded-full bg-emerald-300"></span>',
    `<div class="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-500 truncate">${currentVersionUrl ? escapeHtml(currentVersionUrl) : "Preview URL is being prepared"}</div>`,
    "</div>",
    currentVersionUrl
      ? '<button id="openFirstVersionExternalBtn" class="w-full text-left px-3 py-2 text-xs text-emerald-800 hover:bg-emerald-50 transition">Current version</button>'
      : '<div class="px-3 py-2 text-xs text-slate-500">Current version preview will appear here.</div>',
    "</div>",
    "</section>",
    '<section class="rounded-2xl border border-slate-200/75 bg-white/82 p-5 shadow-md">',
    '<h2 class="text-lg font-semibold text-slate-900">What would you like to change?</h2>',
    '<p class="mt-1 text-sm text-slate-500">Describe what to change. Deplo will apply it and redeploy.</p>',
    '<div class="mt-3 text-sm font-medium text-slate-700">Describe the change</div>',
    '<p class="mt-1 text-xs text-slate-500">Try: make the button bigger, add softer colors, or add a booking form.</p>',
    '<textarea id="changeRequestInput" class="mt-3 w-full rounded-2xl border border-slate-200/80 bg-white p-3 text-sm text-slate-800 focus:border-slate-300" rows="6" placeholder="Describe the change you want..."></textarea>',
    validationMessage
      ? `<p class="mt-2 text-sm text-rose-700">${escapeHtml(validationMessage)}</p>`
      : "",
    '<div class="mt-4 flex flex-wrap gap-2.5">',
    '<button id="submitChangeRequestBtn" class="rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 transition">Apply &amp; redeploy</button>',
    '<button id="cancelChangeRequestBtn" class="rounded-full border border-slate-300/80 bg-white px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition">Back</button>',
    '<button id="projectHomeInlineBtn" class="rounded-full bg-transparent px-2 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 transition">Project home</button>',
    "</div>",
    "</section>",
    "</div>",
  ].join("");
}

function renderUpdatingDraftScreen({ requestSummary = "", stepIndex = 0, ready = false }) {
  const verbatim = String(requestSummary || "").trim();
  const steps = ["Reading request", "Applying changes", "Redeploying", "Ready for review"];
  return [
    '<div class="max-w-3xl mx-auto p-4 space-y-4" id="appBody">',
    '<section class="rounded-2xl border border-slate-200/75 bg-white/82 p-5 shadow-md text-center">',
    '<div class="inline-flex items-center gap-2 rounded-full bg-sky-50 px-4 py-2 text-sm text-sky-800">',
    '<span class="h-2 w-2 animate-pulse rounded-full bg-sky-500"></span>',
    '<span>Applying changes and redeploying…</span>',
    '</div>',
    verbatim
      ? `<div class="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-left text-sm text-slate-700"><span class="font-medium">Your request:</span> ${escapeHtml(verbatim)}</div>`
      : "",
    '<div class="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">',
    ...steps.map((label, index) => {
      if (index < stepIndex) {
        return `<span class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-800"><span>✓</span><span>${label}</span></span>`;
      }
      if (index === stepIndex && !ready) {
        return `<span class="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-sky-800"><span class="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse"></span><span>${label}</span></span>`;
      }
      if (index === 3 && ready) {
        return `<span class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-800"><span>✓</span><span>${label}</span></span>`;
      }
      return `<span class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-500"><span>○</span><span>${label}</span></span>`;
    }).join('<span class="text-slate-300">•</span>'),
    '</div>',
    '<p class="mt-2 text-xs text-slate-500">This usually takes a few seconds.</p>',
    ready
      ? '<div class="mt-5 flex items-center justify-center gap-3"><button id="backToFirstVersionAfterUpdateBtn" class="rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 transition">See updated version</button><button id="projectHomeInlineBtn" class="rounded-full bg-transparent px-2 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 transition">Project home</button></div>'
      : '<div class="mt-5 flex items-center justify-center gap-3"><span class="text-xs text-slate-500">Finishing your updated version…</span><button id="projectHomeInlineBtn" class="rounded-full bg-transparent px-2 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 transition">Project home</button></div>',
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
    '<section class="max-w-6xl mx-auto p-4 space-y-6">',
    '<section class="rounded-2xl bg-slate-900 text-slate-50 p-4 shadow-md border border-slate-700/70">',
    '<div class="flex flex-wrap items-center justify-between gap-3">',
    '<div>',
    '<h2 class="text-xl font-semibold">Expert tools</h2>',
    '<p class="text-sm text-slate-300">Advanced diagnostics and technical controls.</p>',
    "</div>",
    '<button id="closeExpertToolsBtn" class="rounded-full border border-slate-500/70 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700 transition">Hide expert tools</button>',
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
    "</section>",
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
      details.push("Specify the environment variable name.");
    }
    if (hasSupabasePhrase && !hasSupabaseName) {
      details.push("Specify the function name to deploy.");
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
    message: "Paste a repo URL, or describe what to do: deploy, fix errors, connect database.",
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
      inspectionFindings: null,
    },
    inspectionFindings: null,
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
  const [onboardingDone, setOnboardingDone] = useState(true);
  const [hasChosenProjectSource, setHasChosenProjectSource] = useState(true);
  const [chosenProjectSource, setChosenProjectSource] = useState("local");
  const [entryIntent, setEntryIntent] = useState("project");
  const [projectSource, setProjectSource] = useState({
    mode: "local",
    label: "Local project",
    repoUrl: "",
    repoFullName: "",
    branch: "",
    phase: "ready",
  });
  const [visibleMakerScreen, setVisibleMakerScreen] = useState("localDiagnosis");
  const [makerPreviousScreen, setMakerPreviousScreen] = useState("localDiagnosis");
  const [changeRequestBackScreen, setChangeRequestBackScreen] = useState("liveState");
  const [changeRequestValidation, setChangeRequestValidation] = useState("");
  const [lastSubmittedChangeRequest, setLastSubmittedChangeRequest] = useState("");
  const [lastAppliedChangeRequest, setLastAppliedChangeRequest] = useState("");
  const [updateProgressStep, setUpdateProgressStep] = useState(0);
  const [updateReady, setUpdateReady] = useState(false);
  const [fixDetailsVisible, setFixDetailsVisible] = useState(false);
  const [fixProgressStep, setFixProgressStep] = useState(0);
  const makerScreen = visibleMakerScreen;
  // Guard: only explicit user clicks may change the screen.
  // This wrapper prevents any background process, polling callback, or
  // useEffect from silently transitioning away from sourceSelection.
  const _userClickInProgress = useRef(false);
  const setMakerScreen = (next) => {
    if (visibleMakerScreen === "sourceSelection" && next !== "sourceSelection" && !_userClickInProgress.current) {
      console.warn(`[SCREEN-GUARD] Blocked background transition from sourceSelection → ${next}`);
      return;
    }
    setVisibleMakerScreen(next);
  };
  const operationStatusRef = useRef({});
  const launchState = mergeLaunchState(getLaunchState(status), launchStateOverrides);

  function resetFlowForSourceSwitch() {
    // NOTE: This intentionally does NOT set makerScreen.
    // The caller MUST set the desired screen after calling this function.
    // This prevents accidental screen transitions from background resets.
    setMakerStarted(false);
    setOnboardingDone(false);
    setMakerPreviousScreen("localDiagnosis");
    setChangeRequestBackScreen("localDiagnosis");
    setChangeRequestValidation("");
    setLastSubmittedChangeRequest("");
    setLastAppliedChangeRequest("");
    setUpdateProgressStep(0);
    setUpdateReady(false);
    setFixDetailsVisible(false);
    setFixProgressStep(0);
    setExecutionPlan({ rawInput: "", actions: [], steps: [], analyzedAt: null });
    setCommandText("");
    setCommandFocused(false);
    setResultBanner(null);
    setLaunchProgress("");
    setLaunchStepStates({});
    setLaunchStateOverrides({});
    setActivityLog([]);
    setDoctorReport(null);
    setOperations([]);
  }

  function activateLocalSource() {
    setProjectSource({
      mode: "local",
      label: "Local project",
      repoUrl: "",
      repoFullName: "",
      branch: String(status?.git?.branch || ""),
      phase: "ready",
    });
  }

  function activateGithubSource(repoUrl, phase = "importing") {
    const repo = parseGithubRepoIdentity(repoUrl);
    setProjectSource({
      mode: "github",
      label: "Imported from GitHub",
      repoUrl: repo.url,
      repoFullName: repo.fullName,
      branch: "",
      phase,
    });
  }

  function activateSampleSource() {
    setProjectSource({
      mode: "sample",
      label: "Sample project",
      repoUrl: "",
      repoFullName: "Sample demo",
      branch: "",
      phase: "demo-idle",
    });
  }

  function clearProjectSourceSelection() {
    setProjectSource({
      mode: "none",
      label: "Choose source",
      repoUrl: "",
      repoFullName: "",
      branch: "",
      phase: "idle",
    });
  }

  function resolveProjectHomeScreen() {
    const mode = String(projectSource?.mode || "none");
    if (mode === "github") return "githubImport";
    if (mode === "sample") return "sampleFlow";
    if (mode === "none") return "sourceSelection";
    return "localDiagnosis";
  }

  function goDeploHome() {
    setExpertMode(false);
    setVisibleMakerScreen("sourceSelection");
    setMakerStarted(false);
    setOnboardingDone(false);
    setHasChosenProjectSource(false);
    setChosenProjectSource("none");
    setEntryIntent("onboarding");
    setMakerPreviousScreen("localDiagnosis");
    clearProjectSourceSelection();
  }

  function goProjectHome() {
    setExpertMode(false);
    setEntryIntent("project");
    setMakerScreen(resolveProjectHomeScreen());
    setMakerPreviousScreen("localDiagnosis");
  }

  function startOverMakerFlow() {
    setExpertMode(false);
    setVisibleMakerScreen("sourceSelection");
    setMakerPreviousScreen("localDiagnosis");
    setMakerStarted(false);
    setOnboardingDone(false);
    setHasChosenProjectSource(false);
    setChosenProjectSource("none");
    setEntryIntent("onboarding");
    clearProjectSourceSelection();
    setChangeRequestBackScreen("localDiagnosis");
    setChangeRequestValidation("");
    setLastSubmittedChangeRequest("");
    setLastAppliedChangeRequest("");
    setUpdateProgressStep(0);
    setUpdateReady(false);
    setExecutionPlan({ rawInput: "", actions: [], steps: [], analyzedAt: null });
    setCommandText("");
    setCommandFocused(false);
  }

  function openMakerScreen(nextScreen) {
    if (!nextScreen || nextScreen === visibleMakerScreen) {
      return;
    }
    setMakerPreviousScreen(visibleMakerScreen || "localDiagnosis");
    setMakerScreen(nextScreen);
  }

  function goMakerBack() {
    const previous = makerPreviousScreen || "localDiagnosis";
    setMakerScreen(previous);
    if (previous === "localDiagnosis") {
      setMakerPreviousScreen("localDiagnosis");
    }
  }

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
    if (projectSource.mode !== "local") {
      return;
    }
    setProjectSource((prev) => ({
      ...prev,
      branch: String(status?.git?.branch || ""),
    }));
  }, [status?.git?.branch, projectSource.mode]);

  useEffect(() => {
    if (makerScreen !== "changeRequest") {
      return;
    }
    const timer = setTimeout(() => {
      const input = document.getElementById("changeRequestInput");
      if (input instanceof HTMLTextAreaElement) {
        input.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [makerScreen]);

  useEffect(() => {
    if (makerScreen !== "updatingDraft") {
      return;
    }
    setUpdateProgressStep(0);
    setUpdateReady(false);
    const timers = [
      setTimeout(() => setUpdateProgressStep(1), 650),
      setTimeout(() => setUpdateProgressStep(2), 1450),
      setTimeout(() => setUpdateProgressStep(3), 2300),
      setTimeout(() => setUpdateReady(true), 2500),
    ];
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [makerScreen, lastSubmittedChangeRequest]);

  useEffect(() => {
    if (makerScreen !== "fixFlow" || !loading?.runFixNowBtn) {
      setFixProgressStep(0);
      return;
    }
    setFixProgressStep(0);
    const timers = [
      setTimeout(() => setFixProgressStep(1), 450),
      setTimeout(() => setFixProgressStep(2), 1000),
      setTimeout(() => setFixProgressStep(3), 1600),
      setTimeout(() => setFixProgressStep(4), 2300),
    ];
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [makerScreen, loading?.runFixNowBtn]);

  useEffect(() => {
    if (makerScreen !== "localInspection") {
      return;
    }
    const timer = setTimeout(() => {
      setMakerScreen("localDiagnosis");
    }, 1200);
    return () => clearTimeout(timer);
  }, [makerScreen]);

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
    const findings = data?.inspectionFindings && typeof data.inspectionFindings === "object"
      ? data.inspectionFindings
      : (stack?.inspectionFindings && typeof stack.inspectionFindings === "object" ? stack.inspectionFindings : null);
    if (stack) {
      const confirmed = Array.isArray(findings?.stack)
        ? findings.stack.filter((item) => String(item?.confidence || "") === "confirmed").slice(0, 2)
        : [];
      const stackLines = [
        "Detected stack:",
        `framework: ${String(stack.framework ?? "null")}`,
        `deploy: ${String(stack.deploy ?? "null")}`,
        `database: ${String(stack.database ?? "null")}`,
        `backend: ${String(stack.backend ?? "null")}`,
        ...(confirmed.length > 0
          ? ["", "Confirmed findings:", ...confirmed.map((item) => `- ${String(item?.value || "").trim()}`)]
          : []),
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
    async function handleClick(event) {
      _userClickInProgress.current = true;
      try {
      const rawTarget = event.target;
      if (!(rawTarget instanceof HTMLElement)) {
        return;
      }
      const resolvedTarget = rawTarget.closest("[id], [data-onboarding-action], [data-command-suggestion], [data-suggestion-kind], [data-copy-text], [data-doctor-action-id], [data-operator-command], [data-idea-seed], [data-suggestion-id], [data-macro-id], [data-timeline-toggle], [data-retry-step-index]");
      const target = resolvedTarget instanceof HTMLElement ? resolvedTarget : rawTarget;
      if (!target.id) {
        // Card-level clicks delegate to the matching button by id.
        // The id-based handlers below are the single source of truth for each action.
        const onboardingCard = target.closest("[data-onboarding-action]");
        if (onboardingCard instanceof HTMLElement) {
          const action = String(onboardingCard.dataset?.onboardingAction || "");
          if (action) {
            const btn = document.getElementById(action);
            if (btn instanceof HTMLElement) {
              btn.click();
            }
          }
        }
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

      const runFounderFixFlow = async () => {
        const nextAction = getPrimaryNextActionState(doctorReport);
        return runAction("runFixNowBtn", "Fix environment", async () => {
          if (nextAction.mode === "setup_open") {
            setExpertMode(false);
            setFixDetailsVisible(true);
            return "One setup detail still needs your input.\nReview what's missing below.";
          }
          if (nextAction.mode === "setup_fix") {
            const beforeReport = doctorReport && typeof doctorReport === "object" ? doctorReport : null;
            const autofixActions = getDoctorAutofixActions(beforeReport);
            if (autofixActions.length === 0) {
              setFixDetailsVisible(true);
              return "No safe automatic fix is available.\nReview what's missing below.";
            }
            const minimumProgressDelay = new Promise((resolve) => setTimeout(resolve, 2200));
            let latestReport = beforeReport;
            const applySafeFixes = async () => {
              for (const action of autofixActions) {
                const actionId = String(action?.id || "").trim();
                if (!actionId) continue;
                const data = await postJson("/api/doctor/fix", { actionId });
                if (data?.report && typeof data.report === "object") {
                  latestReport = data.report;
                  setDoctorReport(data.report);
                }
              }
              await Promise.all([loadDoctorReport(), loadStatus(), loadSuggestions()]);
            };
            await Promise.all([applySafeFixes(), minimumProgressDelay]);
            setMakerScreen("localDiagnosis");
            setFixDetailsVisible(false);
            const afterOverall = String(latestReport?.overall || "").toLowerCase();
            return afterOverall === "ready"
              ? "Your project is ready for review.\nDeplo applied safe fixes and rechecked setup."
              : "One setup detail still needs your input.\nDeplo applied safe fixes and prepared the next step.";
          }
          setFixDetailsVisible(true);
          return "One setup detail still needs your input.\nReview what's missing below.";
        });
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
          setExpertMode(false);
          openMakerScreen("fixFlow");
          return;
        }
        if (suggestion) {
          const inputEl = document.getElementById("ai-analyze-input");
          if (inputEl instanceof HTMLInputElement || inputEl instanceof HTMLTextAreaElement) {
            inputEl.value = suggestion;
            inputEl.focus();
          }
          setExecutionPlan((prev) => ({ ...prev, rawInput: suggestion }));
          setCommandText(suggestion);
          setCommandFocused(false);
          setMakerScreen("localDiagnosis");
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

        if (target.id === "deploHomeBtn") {
          goDeploHome();
          return;
        }

        if (target.id === "startBtn") {
          setExpertMode(false);
          setVisibleMakerScreen("sourceSelection");
          setMakerPreviousScreen("localDiagnosis");
          setMakerStarted(false);
          setOnboardingDone(false);
          setHasChosenProjectSource(false);
          setChosenProjectSource("none");
          setEntryIntent("onboarding");
          clearProjectSourceSelection();
          setChangeRequestBackScreen("localDiagnosis");
          setChangeRequestValidation("");
          setLastSubmittedChangeRequest("");
          setLastAppliedChangeRequest("");
          setUpdateProgressStep(0);
          setUpdateReady(false);
          setFixDetailsVisible(false);
          setFixProgressStep(0);
          setExecutionPlan({ rawInput: "", actions: [], steps: [], analyzedAt: null });
          setCommandText("");
          setCommandFocused(false);
          setResultBanner(null);
          setLaunchProgress("");
          setLaunchStepStates({});
          setLaunchStateOverrides({});
          setActivityLog([]);
          setDoctorReport(null);
          setOperations([]);
          return;
        }

        if (target.id === "projectHomeBtn" || target.id === "projectHomeInlineBtn") {
          goProjectHome();
          return;
        }

        if (target.id === "makerBackBtn") {
          goMakerBack();
          return;
        }

        if (target.id === "startOverBtn") {
          const hasDraft = Boolean(makerStarted || String(executionPlan?.rawInput || "").trim());
          if (hasDraft) {
            const approved = window.confirm("Start a new project? Current progress will be reset.");
            if (!approved) {
              return;
            }
          }
          startOverMakerFlow();
          return;
        }

        if (target.id === "openExpertToolsBtn") {
          setExpertMode(true);
          return;
        }

        if (target.id === "openFirstVersionBtn") {
          openMakerScreen("liveState");
          return;
        }

        if (target.id === "requestChangesBtn") {
          setChangeRequestBackScreen("localDiagnosis");
          setChangeRequestValidation("");
          openMakerScreen("changeRequest");
          return;
        }

        if (target.id === "requestChangesFromPreviewBtn") {
          setChangeRequestBackScreen("liveState");
          setChangeRequestValidation("");
          openMakerScreen("changeRequest");
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
          goMakerBack();
          return;
        }

        if (target.id === "cancelChangeRequestBtn") {
          setChangeRequestValidation("");
          goMakerBack();
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
          openMakerScreen("updatingDraft");
          setOutput("Change request added.");
          return;
        }

        if (target.id === "backToFirstVersionAfterUpdateBtn") {
          setLastAppliedChangeRequest(lastSubmittedChangeRequest);
          openMakerScreen("liveState");
          return;
        }

        if (target.id === "backToDashboardBtn") {
          goMakerBack();
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
        const quickIdeaSeed = String(target.dataset?.ideaSeed || "").trim();
        if (quickIdeaSeed) {
          const inputEl = document.getElementById("ai-analyze-input");
          if (inputEl instanceof HTMLInputElement || inputEl instanceof HTMLTextAreaElement) {
            inputEl.value = quickIdeaSeed;
            inputEl.focus();
          }
          setExecutionPlan((prev) => ({ ...prev, rawInput: quickIdeaSeed }));
          setCommandText(quickIdeaSeed);
          return;
        }
        if (quickCommand) {
          setEntryIntent("project");
          setMakerStarted(true);
          setMakerScreen("localDiagnosis");
          await runAction(target.id, "Analyze", async () => analyzeOperatorInput(quickCommand));
          return;
        }

        // Onboarding path handlers (id-based — for direct button clicks)
        if (target.id === "startScanBtn") {
          resetFlowForSourceSwitch();
          activateLocalSource();
          setHasChosenProjectSource(true);
          setChosenProjectSource("local");
          setOnboardingDone(true);
          setEntryIntent("project");
          setMakerScreen("localInspection");
          setTimeout(() => {
            const inputEl = document.getElementById("ai-analyze-input");
            if (inputEl instanceof HTMLInputElement || inputEl instanceof HTMLTextAreaElement) {
              inputEl.focus();
            }
          }, 50);
          return;
        }

        if (target.id === "startGithubBtn") {
          resetFlowForSourceSwitch();
          activateGithubSource("", "awaiting-url");
          setHasChosenProjectSource(true);
          setChosenProjectSource("github");
          setOnboardingDone(true);
          setEntryIntent("project");
          setMakerScreen("githubImport");
          setTimeout(() => {
            const inputEl = document.getElementById("ai-analyze-input");
            if (inputEl instanceof HTMLInputElement || inputEl instanceof HTMLTextAreaElement) {
              inputEl.value = "";
              inputEl.placeholder = "Paste your GitHub repo URL here…";
              inputEl.focus();
            }
          }, 50);
          return;
        }

        if (target.id === "startSampleBtn") {
          resetFlowForSourceSwitch();
          activateSampleSource();
          setHasChosenProjectSource(true);
          setChosenProjectSource("sample");
          setOnboardingDone(true);
          setEntryIntent("project");
          setMakerScreen("sampleFlow");
          return;
        }

        if (target.id === "runSampleFlowBtn") {
          setProjectSource((prev) => ({ ...prev, mode: "sample", label: "Sample project", phase: "demo-running" }));
          setMakerStarted(false);
          setTimeout(() => {
            setProjectSource((prev) => prev.mode === "sample" ? { ...prev, phase: "demo-ready" } : prev);
          }, 1800);
          setOutput("Sample walkthrough completed (simulated).");
          return;
        }

        if (target.id === "aiAnalyzeBtn") {
          setEntryIntent("project");
          // Stay on current screen — do NOT force a screen change here.
          // The analysis callback sets the correct screen only if needed.
          await runAction("aiAnalyzeBtn", "Analyze", async () => {
            const inputEl = document.getElementById("ai-analyze-input");
            const text = inputEl instanceof HTMLInputElement || inputEl instanceof HTMLTextAreaElement ? inputEl.value : "";
            const trimmed = String(text || "").trim();
            const githubImport = isGithubRepoUrl(trimmed) || projectSource.mode === "github";
            if (githubImport) {
              resetFlowForSourceSwitch();
              activateGithubSource(trimmed, "importing");
              setMakerStarted(true);
              setMakerScreen("githubImport");
              setExecutionPlan({ rawInput: trimmed, actions: [], steps: [], analyzedAt: new Date().toISOString() });
              setCommandText(trimmed);
              setTimeout(() => {
                setProjectSource((prev) => prev.mode === "github" ? { ...prev, phase: "checking" } : prev);
              }, 900);
              setTimeout(() => {
                setProjectSource((prev) => prev.mode === "github" ? { ...prev, phase: "limited" } : prev);
              }, 1900);
              const repo = parseGithubRepoIdentity(trimmed);
              const repoName = String(repo?.fullName || "").trim();
              return [
                "GitHub source captured.",
                repoName ? `Repository: ${repoName}` : "Repository URL saved in workspace context.",
                "Full inspection is still limited beta.",
                "Next: Check imported repo to continue this flow, or switch to local project.",
              ].join("\n");
            }
            setMakerStarted(true);
            setMakerScreen("localDiagnosis");
            return analyzeOperatorInput(trimmed);
          });
          return;
        }

        if (target.id === "deployNowBtn") {
          setEntryIntent("project");
          setMakerStarted(true);
          setMakerScreen("localDiagnosis");
          await runAction("deployNowBtn", "Deploy preview", async () => {
            const result = await dispatchCoreAction("deploy_preview");
            await loadStatus();
            return formatActionResult(result, "Deploy queued");
          });
          return;
        }

        if (target.id === "verifyLiveAppBtn") {
          await runAction("verifyLiveAppBtn", "Verify live app", async () => {
            const entryId = createActivityEntry("verify_live", "queued", "Live health check queued");
            updateActivityEntry(entryId, "running", "Checking live status now");
            try {
              await Promise.all([loadStatus(), loadDoctorReport(), loadSuggestions()]);
              updateActivityEntry(entryId, "success", "Live health verified");
              return [
                "Live health re-checked.",
                "Deplo refreshed deploy and setup signals.",
              ].join("\n");
            } catch (error) {
              const message = error instanceof Error ? error.message : "Live health check failed.";
              updateActivityEntry(entryId, "error", "Live health check failed", message);
              throw error;
            }
          });
          return;
        }

        if (target.id === "fixNextBtn") {
          setEntryIntent("project");
          setExpertMode(false);
          setFixDetailsVisible(false);
          openMakerScreen("fixFlow");
          return;
        }

        if (target.id === "reviewMissingBtn") {
          setFixDetailsVisible(true);
          if (makerScreen !== "fixFlow") {
            setEntryIntent("project");
            setExpertMode(false);
            openMakerScreen("fixFlow");
          }
          return;
        }

        if (target.id === "runFixNowBtn") {
          await runFounderFixFlow();
          return;
        }

        if (target.id === "cancelFixNextBtn") {
          setFixDetailsVisible(false);
          setFixProgressStep(0);
          goMakerBack();
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
              setLaunchProgress("");
              setMakerScreen("fixFlow");
              return `${nextAction.buttonLabel}: one manual input is still needed.`;
            }
            if (nextAction.mode === "setup_fix") {
              const beforeReport = doctorReport && typeof doctorReport === "object" ? doctorReport : null;
              const autofixActions = getDoctorAutofixActions(beforeReport);
              if (autofixActions.length === 0) {
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
            await Promise.all([loadStatus(), loadDoctorReport(), loadSuggestions()]);
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
            await Promise.all([loadStatus(), loadDoctorReport(), loadSuggestions()]);
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
            if (inputEl instanceof HTMLInputElement || inputEl instanceof HTMLTextAreaElement) {
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
      } finally {
        _userClickInProgress.current = false;
      }
    }

    function handleKeyDown(event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const card = target.closest("[data-onboarding-action]");
      if (!(card instanceof HTMLElement)) {
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      const action = String(card.dataset?.onboardingAction || "");
      if (!action) {
        return;
      }
      const button = document.getElementById(action);
      if (button instanceof HTMLElement) {
        button.click();
      }
    }

    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    status,
    launchState,
    loading,
    executionPlan,
    prodConfirmChecked,
    doctorReport,
    makerScreen,
    makerPreviousScreen,
    makerStarted,
    onboardingDone,
    lastSubmittedChangeRequest,
    projectSource,
  ]);

  const html = useMemo(() => {
    const localProjectDetected = hasDetectedLocalProject(status);

    const availableMacros = ALL_MACROS.filter((macro) => macro.steps.every((step) => stepSupported(step, capabilities)));
    const hasJobs = Array.isArray(operations) && operations.length > 0;
    const timelineEntries = buildTimeline(activityLog, operations, executionPlan, prodConfirmChecked);
    const timelineOutcome = computeOutcome(timelineEntries);
    const shell = renderConsoleShell({ status, expertMode, makerStarted, launchState, makerScreen, onboardingDone, entryIntent, projectSource, doctorReport, hasChosenProjectSource });
    const showPipeline = makerScreen !== "sourceSelection" && (entryIntent !== "onboarding" || makerStarted);
    const makerOrientation = renderMakerOrientationLayer({
      onboardingDone,
      entryIntent,
      makerStarted,
      makerScreen,
      doctorReport,
      status,
      launchState,
      loading,
      activityLog,
      resultBanner,
      projectSource,
    });
    const shellWithPipeline = showPipeline
      ? `${shell}${renderMakerPipelineStrip({ makerStarted, launchState, status, doctorReport, projectSource })}`
      : shell;
    const expertToolsPanel = expertMode
      ? expertViewHtml({
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
        })
      : "";
    if (makerScreen === "liveState") {
      return [
        shellWithPipeline,
        makerOrientation,
        renderFirstVersionScreen({
        status,
        executionPlan,
        launchState,
        doctorReport,
        appliedChangeRequest: lastAppliedChangeRequest,
        projectSource,
        activityLog,
        resultBanner,
        loading,
      }),
      expertToolsPanel,
      ].join("");
    }
    if (makerScreen === "changeRequest") {
      return [
        shellWithPipeline,
        makerOrientation,
        renderChangeRequestScreen({ validationMessage: changeRequestValidation, status }),
        expertToolsPanel,
      ].join("");
    }
    if (makerScreen === "updatingDraft") {
      return [
        shellWithPipeline,
        makerOrientation,
        renderUpdatingDraftScreen({ requestSummary: lastSubmittedChangeRequest, stepIndex: updateProgressStep, ready: updateReady }),
        expertToolsPanel,
      ].join("");
    }
    if (makerScreen === "fixFlow") {
      const fixProof = resolveDeployProofState({ projectSource, launchState, status, doctorReport });
      return [
        shellWithPipeline,
        makerOrientation,
        renderFixNextFlow({
          doctorReport,
          loading,
          showDetails: fixDetailsVisible,
          fixProgressStep,
          proof: fixProof,
          projectSource,
          status,
          resultBanner,
          activityLog,
        }),
        expertToolsPanel,
      ].join("");
    }
    return [
      shellWithPipeline,
      makerOrientation,
      renderMakerDashboard({
      loading,
      executionPlan,
      status,
      launchState,
      launchProgress,
      launchStepStates,
      doctorReport,
      activityLog,
      makerStarted,
      makerScreen,
      onboardingDone,
      entryIntent,
      projectSource,
      resultBanner,
    }),
    expertToolsPanel,
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
    expertMode,
    makerStarted,
    onboardingDone,
    hasChosenProjectSource,
    chosenProjectSource,
    entryIntent,
    projectSource,
    makerScreen,
    changeRequestBackScreen,
    changeRequestValidation,
    lastSubmittedChangeRequest,
    lastAppliedChangeRequest,
    updateProgressStep,
    updateReady,
    fixDetailsVisible,
    fixProgressStep,
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

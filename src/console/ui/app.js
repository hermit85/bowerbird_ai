import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18";
import { createRoot } from "https://esm.sh/react-dom@18/client";
import { AutoModeSection } from "/components/autoModeSection.js";
import { ActivitySection } from "/components/activitySection.js";
import { CommandCenterSection } from "/components/commandCenterSection.js";
import { ExecutionQueueSection } from "/components/executionQueueSection.js";
import { ProjectHealthSection } from "/components/projectHealthSection.js";
import { StatusSection } from "/components/statusSection.js";
import { SuggestionsSection } from "/components/suggestionsSection.js";
import { ChatImportSection } from "/components/chatImportSection.js";
import { MacrosSection } from "/components/macrosSection.js";
import { QuickActionsSection } from "/components/quickActionsSection.js";
import { InstructionSection } from "/components/instructionSection.js";
import { RepairSection } from "/components/repairSection.js";
import { DeploymentSection } from "/components/deploymentSection.js";
import { EnvironmentSection } from "/components/environmentSection.js";

console.log("BowerBird UI loaded");

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
  if (type === "deploy_preview") return "deploy preview";
  if (type === "deploy_production") return "deploy production";
  if (type === "run_repair") return "run repair";
  if (type === "show_logs") return "show logs";
  if (type === "env_add") return `add env ${String(action?.key || "KEY")}`;
  if (type === "deploy_supabase_function") return `deploy supabase function ${String(action?.name || "NAME")}`;
  return type || "unknown";
}

function renderAiChatExecutionPlanSection({ loading, text, actions, guidance, prodConfirmChecked }) {
  const analyzeBusy = Boolean(loading.aiAnalyzeBtn);
  const runBusy = Boolean(loading.aiRunPlanBtn);
  const autoRunBusy = Boolean(loading.aiAutoRunSafeBtn);
  const hasActions = Array.isArray(actions) && actions.length > 0;
  const hasProductionDeploy = Array.isArray(actions) && actions.some((action) => String(action?.type) === "deploy_production");
  const runDisabled = runBusy || !hasActions || (hasProductionDeploy && !prodConfirmChecked);
  const safeTypes = new Set(["deploy_preview", "show_logs"]);
  const safeOnly = hasActions && actions.every((action) => safeTypes.has(String(action?.type)));
  const actionRows = Array.isArray(actions) && actions.length > 0
    ? actions.map((action, index) => `<li>${index + 1}. ${escapeHtml(formatExecutionAction(action))}</li>`).join("")
    : "<li>No actions detected yet.</li>";
  const guidanceClass = guidance?.tone === "ok"
    ? "bg-emerald-100 border-emerald-300 text-emerald-900"
    : guidance?.tone === "warn"
      ? "bg-amber-100 border-amber-300 text-amber-900"
      : guidance?.tone === "hint"
        ? "bg-sky-100 border-sky-300 text-sky-900"
        : "bg-slate-100 border-slate-300 text-slate-800";

  return `
    <section class="rounded-xl bg-white p-5 shadow-sm border border-slate-200">
      <h2 class="text-lg font-semibold">AI Chat → Execution Plan</h2>
      <label class="text-sm font-medium mt-3 block">Paste AI Chat</label>
      <textarea id="ai-analyze-input" class="mt-2 w-full rounded-md border border-slate-300 p-3 h-28 text-sm" placeholder="Paste AI instructions here...">${escapeHtml(text || "")}</textarea>
      <div class="mt-3">
        <button id="aiAnalyzeBtn" ${analyzeBusy ? "disabled" : ""} class="rounded-md bg-slate-700 text-white px-3 py-2 text-sm ${analyzeBusy ? "opacity-60 cursor-not-allowed" : ""}">${analyzeBusy ? "Analyzing..." : "Analyze"}</button>
        <button id="aiRunPlanBtn" ${runDisabled ? "disabled" : ""} class="ml-2 rounded-md bg-emerald-700 text-white px-3 py-2 text-sm ${runDisabled ? "opacity-60 cursor-not-allowed" : ""}">${runBusy ? "Running..." : "Run Plan"}</button>
      </div>
      ${hasProductionDeploy
        ? `<div class="mt-3 rounded-lg border border-amber-300 bg-amber-100 p-3 text-amber-900">
          <div class="text-sm font-semibold">Production deploy detected. Please confirm before running.</div>
          <label class="mt-2 flex items-center gap-2 text-sm">
            <input id="prodConfirmCheckbox" type="checkbox" ${prodConfirmChecked ? "checked" : ""} />
            <span>I confirm production deployment</span>
          </label>
        </div>`
        : ""}
      ${safeOnly
        ? `<div class="mt-3 rounded-lg border border-emerald-300 bg-emerald-100 p-3 text-emerald-900">
          <div class="text-sm font-semibold">Safe to run automatically</div>
          <button id="aiAutoRunSafeBtn" ${autoRunBusy ? "disabled" : ""} class="mt-2 rounded-md bg-emerald-700 text-white px-3 py-2 text-sm ${autoRunBusy ? "opacity-60 cursor-not-allowed" : ""}">${autoRunBusy ? "Running..." : "Auto-run safe actions"}</button>
        </div>`
        : ""}
      <div class="mt-3">
        <div class="rounded-lg border p-3 ${guidanceClass}">
          <div class="text-sm font-semibold">${escapeHtml(guidance?.label || "No actions detected")}</div>
          <div class="text-sm mt-1">${escapeHtml(guidance?.message || "")}</div>
        </div>
      </div>
      <div class="mt-3">
        <div class="text-sm font-medium text-slate-700">Detected Actions</div>
        <ol class="mt-1 list-decimal pl-5 text-sm text-slate-700 space-y-1">${actionRows}</ol>
      </div>
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
      details.push("Add an env key, for example: add env DATABASE_URL");
    }
    if (hasSupabasePhrase && !hasSupabaseName) {
      details.push("Add a function name, for example: deploy supabase function generate");
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
      message: `Found ${detectedActions.length} action${detectedActions.length === 1 ? "" : "s"} ready for Run Plan.`,
    };
  }

  const liveOrConnected = Boolean(status?.vercel?.lastDeployUrl) || Boolean(status?.supabase?.connected);
  if (liveOrConnected) {
    return {
      label: "Recommended next step",
      tone: "hint",
      message: "Try: deploy preview, add env DATABASE_URL, or deploy supabase function generate",
    };
  }

  return {
    label: "No actions detected",
    tone: "neutral",
    message: "Paste instructions with clear commands like deploy preview or add env DATABASE_URL",
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
  const [operations, setOperations] = useState([]);
  const [chatText, setChatText] = useState("");
  const [chatActions, setChatActions] = useState([]);
  const [chatEmptyMessage, setChatEmptyMessage] = useState("");
  const [aiAnalyzeText, setAiAnalyzeText] = useState("");
  const [aiAnalyzeActions, setAiAnalyzeActions] = useState([]);
  const [prodConfirmChecked, setProdConfirmChecked] = useState(false);
  const [commandText, setCommandText] = useState("");
  const [commandFocused, setCommandFocused] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [output, setOutput] = useState("Ready");
  const [loading, setLoading] = useState({});
  const [resultBanner, setResultBanner] = useState(null);
  const [lastAction, setLastAction] = useState("No actions yet");
  const operationStatusRef = useRef({});

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
    setSuggestions(Array.isArray(data) ? data : []);
  }

  async function loadCapabilities() {
    const response = await fetch("/api/capabilities");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Failed to load capabilities");
    }
    setCapabilities(data || {});
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
    Promise.all([loadStatus(), loadSuggestions(), loadCapabilities()]).catch((error) => setOutput(error.message));
    const timer = setInterval(() => {
      Promise.all([loadStatus(), loadSuggestions(), loadCapabilities()]).catch(() => {
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
      if (target instanceof HTMLElement && target.id === "command-center-input") {
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
        if (!(active instanceof HTMLElement) || active.id !== "command-center-input") {
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

  function markAction(label, outcome, details) {
    const time = nowTime();
    const statusText = outcome === "success" ? "success" : "failed";
    setLastAction(`Last action: ${label} — ${statusText} — ${time}`);
    setResultBanner({
      type: outcome,
      message: `${label} ${outcome === "success" ? "completed" : "failed"}`,
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

      try {
        const suggestion = target.dataset?.commandSuggestion;
        if (suggestion) {
          const inputEl = document.getElementById("command-center-input");
          if (inputEl instanceof HTMLInputElement) {
            inputEl.value = suggestion;
          }
          setCommandText(suggestion);
          setCommandFocused(false);
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

        if (target.id === "aiAnalyzeBtn") {
          await runAction("aiAnalyzeBtn", "Analyze", async () => {
            const inputEl = document.getElementById("ai-analyze-input");
            const text = inputEl instanceof HTMLTextAreaElement ? inputEl.value : "";
            const normalized = text.trim();
            setAiAnalyzeText(text);
            if (!normalized) {
              setAiAnalyzeActions([]);
              setProdConfirmChecked(false);
              return "Please paste AI chat text first.";
            }

            const data = await postJson("/api/ai/detect", { text });
            const actions = Array.isArray(data.actions) ? data.actions : [];
            setAiAnalyzeActions(actions);
            setProdConfirmChecked(false);
            if (actions.length === 0) {
              return "No actions detected.";
            }
            return [
              "Detected Actions",
              ...actions.map((action, index) => `${index + 1}. ${formatExecutionAction(action)}`),
            ].join("\n");
          });
          return;
        }

        if (target.id === "aiRunPlanBtn") {
          await runAction("aiRunPlanBtn", "Run plan", async () => {
            const inputEl = document.getElementById("ai-analyze-input");
            const text = inputEl instanceof HTMLTextAreaElement ? inputEl.value.trim() : "";
            if (!text) {
              return "Please paste AI chat text first.";
            }
            if (!Array.isArray(aiAnalyzeActions) || aiAnalyzeActions.length === 0) {
              return "No detected actions to run. Click Analyze first.";
            }

            const hasProdDeploy = aiAnalyzeActions.some((action) => String(action?.type) === "deploy_production");
            if (hasProdDeploy && !prodConfirmChecked) {
              return "Please confirm production deployment first.";
            }

            const data = await postJson("/api/ai/run", { text });
            const actions = Array.isArray(data.actions) ? data.actions : [];
            const jobIds = Array.isArray(data.jobIds) ? data.jobIds : [];
            setAiAnalyzeActions(actions);
            await loadOperations();
            await loadStatus();
            return [
              "Running plan",
              ...actions.map((action, index) => `${index + 1}. ${formatExecutionAction(action)}`),
              "",
              `Jobs queued: ${jobIds.length}`,
            ].join("\n");
          });
          return;
        }

        if (target.id === "aiAutoRunSafeBtn") {
          await runAction("aiAutoRunSafeBtn", "Auto-run safe actions", async () => {
            const text = aiAnalyzeText.trim();
            if (!text) {
              return "Please paste AI chat text first.";
            }
            if (!Array.isArray(aiAnalyzeActions) || aiAnalyzeActions.length === 0) {
              return "No detected actions to run. Click Analyze first.";
            }
            const safeTypes = new Set(["deploy_preview", "show_logs"]);
            const safeOnly = aiAnalyzeActions.every((action) => safeTypes.has(String(action?.type)));
            if (!safeOnly) {
              return "Auto-run only supports safe plans (deploy preview, show logs).";
            }

            const data = await postJson("/api/ai/run", { text });
            const actions = Array.isArray(data.actions) ? data.actions : [];
            setAiAnalyzeActions(actions);
            await loadOperations();
            await loadStatus();
            return [
              "Running safe actions",
              ...actions.map((action, index) => `${index + 1}. ${formatExecutionAction(action)}`),
              "",
              `Jobs queued: ${Array.isArray(data.jobIds) ? data.jobIds.length : 0}`,
            ].join("\n");
          });
          return;
        }

        if (target.id === "prodConfirmCheckbox") {
          const input = target;
          if (input instanceof HTMLInputElement) {
            setProdConfirmChecked(input.checked);
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

            const result = await postJson("/api/ai/import", { text });
            const parsed = Array.isArray(result.actions)
              ? result.actions.map((item) => formatExecutionAction(item))
              : [];
            setChatActions(parsed);
            if (parsed.length === 0) {
              setChatEmptyMessage("No runnable actions detected.");
              return "No runnable actions detected.";
            }
            setChatEmptyMessage("");
            await loadOperations();
            return [
              `Detected actions: ${result.actionsDetected}`,
              `Jobs queued: ${result.jobsQueued}`,
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
            const data = await postJson("/api/deploy/preview");
            await loadStatus();
            await loadSuggestions();
            return formatActionResult(data, "Job queued");
          });
          return;
        }

        if (target.id === "prodDeployBtn") {
          await runAction("prodDeployBtn", "Production deploy", async () => {
            const data = await postJson("/api/deploy/prod");
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
            const data = await postJson("/api/do/execute", { instruction: "deploy preview" });
            await loadStatus();
            await loadSuggestions();
            return formatActionResult(data, "Job queued");
          });
          return;
        }

        if (target.id === "quickDeployProdBtn") {
          await runAction("quickDeployProdBtn", "Deploy production", async () => {
            const data = await postJson("/api/do/execute", { instruction: "deploy production" });
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
  }, [status, loading]);

  const html = useMemo(() => {
    const availableMacros = ALL_MACROS.filter((macro) => macro.steps.every((step) => stepSupported(step, capabilities)));
    const hasJobs = Array.isArray(operations) && operations.length > 0;
    const heroState = detectHeroState(status, operations);
    const errorSummary = extractErrorSummary(status);
    const guidance = computeExecutionPlanGuidance(aiAnalyzeText, aiAnalyzeActions, status);
    return [
      '<div class="max-w-6xl mx-auto p-4 space-y-4" id="appBody">',
      '<h1 class="text-2xl font-bold">BowerBird</h1>',
      '<p class="text-sm text-slate-600">AI builder operator console for command-first shipping.</p>',
      `<div class="text-sm text-slate-600">${escapeHtml(lastAction)}</div>`,
      renderAiChatExecutionPlanSection({ loading, text: aiAnalyzeText, actions: aiAnalyzeActions, guidance, prodConfirmChecked }),
      CommandCenterSection({ loading, commandText, commandFocused, heroState, errorSummary, status }),
      ActivitySection({ operations }),
      resultBanner
        ? `<section class="rounded-xl p-3 shadow-sm ${resultBanner.type === "success" ? "bg-emerald-100 border border-emerald-300 text-emerald-900" : "bg-rose-100 border border-rose-300 text-rose-900"}">${escapeHtml(resultBanner.message)} (${escapeHtml(resultBanner.time)})</section>`
        : "",
      ProjectHealthSection({ status }),
      '<details class="rounded-xl bg-white p-4 shadow-sm">',
      '<summary class="cursor-pointer text-lg font-semibold">Advanced</summary>',
      '<div class="mt-4 space-y-4">',
      StatusSection({ status }),
      hasJobs
        ? `<details class="rounded-xl bg-slate-50 p-4 border border-slate-200"><summary class="cursor-pointer text-base font-semibold">Execution Queue (${operations.length})</summary><div class="mt-3">${ExecutionQueueSection({ operations })}</div></details>`
        : "",
      '<section class="rounded-xl bg-white p-4 shadow-sm">',
      '<h2 class="text-lg font-semibold mb-3">Output</h2>',
      `<pre id="outputPanel" class="bg-slate-950 text-slate-100 rounded-md p-2 text-xs overflow-auto max-h-72">${escapeHtml(output)}</pre>`,
      "</section>",
      SuggestionsSection({ suggestions, loading }),
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
  }, [status, capabilities, suggestions, operations, chatText, chatActions, chatEmptyMessage, aiAnalyzeText, aiAnalyzeActions, prodConfirmChecked, commandText, commandFocused, instruction, output, loading, lastAction, resultBanner]);

  return React.createElement("div", { dangerouslySetInnerHTML: { __html: html } });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

createRoot(document.getElementById("root")).render(React.createElement(App));

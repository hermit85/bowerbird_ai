import React, { useEffect, useMemo, useState } from "https://esm.sh/react@18";
import { createRoot } from "https://esm.sh/react-dom@18/client";
import { StatusSection } from "/components/statusSection.js";
import { InstructionSection } from "/components/instructionSection.js";
import { RepairSection } from "/components/repairSection.js";
import { DeploymentSection } from "/components/deploymentSection.js";
import { EnvironmentSection } from "/components/environmentSection.js";

console.log("BowerBird UI loaded");

function App() {
  const [status, setStatus] = useState({
    repoPath: "",
    branch: "",
    lastDeployUrl: null,
    vercelStatus: "",
    supabaseStatus: "",
    envVars: [],
    lastErrorJson: null,
    repairPrompt: null,
    repairHistory: null,
    lastDeployLog: null,
    lastApplyPatchLog: null,
  });
  const [instruction, setInstruction] = useState("");
  const [output, setOutput] = useState("Ready");
  const [loading, setLoading] = useState({});
  const [resultBanner, setResultBanner] = useState(null);
  const [lastAction, setLastAction] = useState("No actions yet");

  async function loadStatus() {
    const response = await fetch("/api/status");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Failed to load status");
    }
    setStatus(data);
  }

  useEffect(() => {
    loadStatus().catch((error) => setOutput(error.message));
    const timer = setInterval(() => {
      loadStatus().catch(() => {
        // keep previous status when polling fails
      });
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const outputPanel = document.getElementById("outputPanel");
    if (outputPanel) {
      outputPanel.scrollTop = outputPanel.scrollHeight;
    }
  }, [output]);

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
            return [data.result.stdout, data.result.stderr].filter(Boolean).join("\n") || "Done";
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
            return [data.result.stdout, data.result.stderr].filter(Boolean).join("\n") || "Done";
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
            return [data.result.stdout, data.result.stderr].filter(Boolean).join("\n") || "Done";
          });
          return;
        }

        if (target.id === "applyRedeployBtn") {
          await runAction("applyRedeployBtn", "Apply patch + redeploy", async () => {
            const data = await postJson("/api/repair/apply-redeploy");
            const logs = [
              data.applyResult?.stdout,
              data.applyResult?.stderr,
              data.shipResult?.stdout,
              data.shipResult?.stderr,
            ]
              .filter(Boolean)
              .join("\n");
            await loadStatus();
            return logs || "Done";
          });
          return;
        }

        if (target.id === "previewDeployBtn") {
          await runAction("previewDeployBtn", "Preview deploy", async () => {
            const data = await postJson("/api/deploy/preview");
            await loadStatus();
            return [data.result.stdout, data.result.stderr].filter(Boolean).join("\n") || "Done";
          });
          return;
        }

        if (target.id === "prodDeployBtn") {
          await runAction("prodDeployBtn", "Production deploy", async () => {
            const data = await postJson("/api/deploy/prod");
            await loadStatus();
            return [data.result.stdout, data.result.stderr].filter(Boolean).join("\n") || "Done";
          });
          return;
        }

        if (target.id === "viewLogsBtn") {
          await runAction("viewLogsBtn", "View logs", async () => {
            return [
              "=== .bowerbird/last_deploy_log.txt ===",
              status.lastDeployLog || "(missing)",
              "",
              "=== .bowerbird/last_apply_patch_log.txt ===",
              status.lastApplyPatchLog || "(missing)",
            ].join("\n");
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
            return data.message || "Added env var.";
          });
        }
      } catch (error) {
        setOutput(error instanceof Error ? error.message : "Action failed");
      }
    }

    root.addEventListener("click", handleClick);
    return () => root.removeEventListener("click", handleClick);
  }, [status, loading]);

  const html = useMemo(() => {
    return [
      '<div class="max-w-6xl mx-auto p-4 space-y-4" id="appBody">',
      '<h1 class="text-2xl font-bold">BowerBird Console</h1>',
      `<div class="text-sm text-slate-600">${escapeHtml(lastAction)}</div>`,
      '<div class="grid gap-4 md:grid-cols-2">',
      StatusSection({ status }),
      InstructionSection({ instruction, loading }),
      "</div>",
      '<div class="grid gap-4 md:grid-cols-2">',
      RepairSection({ status, loading }),
      DeploymentSection({ loading }),
      "</div>",
      EnvironmentSection({ status, loading }),
      resultBanner
        ? `<section class="rounded-xl p-3 shadow-sm ${resultBanner.type === "success" ? "bg-emerald-100 border border-emerald-300 text-emerald-900" : "bg-rose-100 border border-rose-300 text-rose-900"}">${escapeHtml(resultBanner.message)} (${escapeHtml(resultBanner.time)})</section>`
        : "",
      '<section class="rounded-xl bg-white p-4 shadow-sm">',
      '<h2 class="text-lg font-semibold mb-3">Output</h2>',
      `<pre id="outputPanel" class="bg-slate-950 text-slate-100 rounded-md p-2 text-xs overflow-auto max-h-72">${escapeHtml(output)}</pre>`,
      "</section>",
      "</div>",
    ].join("");
  }, [status, instruction, output, loading, lastAction, resultBanner]);

  return React.createElement("div", { dangerouslySetInnerHTML: { __html: html } });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

createRoot(document.getElementById("root")).render(React.createElement(App));

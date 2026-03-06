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
          setInstruction(text);
          const data = await postJson("/api/do/preview", { instruction: text });
          setOutput([data.result.stdout, data.result.stderr].filter(Boolean).join("\n") || "Done");
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
          setInstruction(text);
          const data = await postJson("/api/do/execute", { instruction: text });
          setOutput([data.result.stdout, data.result.stderr].filter(Boolean).join("\n") || "Done");
          await loadStatus();
          return;
        }

        if (target.id === "copyPromptBtn") {
          if (!status.repairPrompt) {
            setOutput("No repair prompt found.");
            return;
          }
          await navigator.clipboard.writeText(status.repairPrompt);
          setOutput("Copied repair prompt.");
          return;
        }

        if (target.id === "pastePatchBtn") {
          const data = await postJson("/api/repair/paste-patch");
          setOutput([data.result.stdout, data.result.stderr].filter(Boolean).join("\n") || "Done");
          await loadStatus();
          return;
        }

        if (target.id === "applyRedeployBtn") {
          const data = await postJson("/api/repair/apply-redeploy");
          const logs = [
            data.applyResult?.stdout,
            data.applyResult?.stderr,
            data.shipResult?.stdout,
            data.shipResult?.stderr,
          ]
            .filter(Boolean)
            .join("\n");
          setOutput(logs || "Done");
          await loadStatus();
          return;
        }

        if (target.id === "previewDeployBtn") {
          const data = await postJson("/api/deploy/preview");
          setOutput([data.result.stdout, data.result.stderr].filter(Boolean).join("\n") || "Done");
          await loadStatus();
          return;
        }

        if (target.id === "prodDeployBtn") {
          const data = await postJson("/api/deploy/prod");
          setOutput([data.result.stdout, data.result.stderr].filter(Boolean).join("\n") || "Done");
          await loadStatus();
          return;
        }

        if (target.id === "viewLogsBtn") {
          setOutput([
            "=== .bowerbird/last_deploy_log.txt ===",
            status.lastDeployLog || "(missing)",
            "",
            "=== .bowerbird/last_apply_patch_log.txt ===",
            status.lastApplyPatchLog || "(missing)",
          ].join("\n"));
          return;
        }

        if (target.id === "addEnvBtn") {
          const key = document.getElementById("envKeyInput")?.value?.trim() || "";
          const value = document.getElementById("envValueInput")?.value || "";
          const data = await postJson("/api/env/add", { key, value, target: "preview" });
          setOutput(data.message || "Added env var.");
          const envValueInput = document.getElementById("envValueInput");
          if (envValueInput) {
            envValueInput.value = "";
          }
          await loadStatus();
        }
      } catch (error) {
        setOutput(error instanceof Error ? error.message : "Action failed");
      }
    }

    root.addEventListener("click", handleClick);
    return () => root.removeEventListener("click", handleClick);
  }, [status]);

  const html = useMemo(() => {
    return [
      '<div class="max-w-6xl mx-auto p-4 space-y-4" id="appBody">',
      '<h1 class="text-2xl font-bold">BowerBird Console</h1>',
      '<div class="grid gap-4 md:grid-cols-2">',
      StatusSection({ status }),
      InstructionSection({ instruction }),
      "</div>",
      '<div class="grid gap-4 md:grid-cols-2">',
      RepairSection({ status }),
      DeploymentSection(),
      "</div>",
      EnvironmentSection({ status }),
      '<section class="rounded-xl bg-white p-4 shadow-sm">',
      '<h2 class="text-lg font-semibold mb-3">Output</h2>',
      `<pre class="bg-slate-950 text-slate-100 rounded-md p-2 text-xs overflow-auto max-h-72">${escapeHtml(output)}</pre>`,
      "</section>",
      "</div>",
    ].join("");
  }, [status, instruction, output]);

  return React.createElement("div", { dangerouslySetInnerHTML: { __html: html } });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

createRoot(document.getElementById("root")).render(React.createElement(App));

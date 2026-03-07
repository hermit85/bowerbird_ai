"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type StatusPayload = {
  ok: boolean;
  message?: string;
  lastDeployUrl?: string | null;
  lastError?: unknown;
  repairHistory?: unknown;
  lastDeployLog?: string;
  lastApplyPatchLog?: string;
  uiLastRunLog?: string;
  runActive?: boolean;
  timestamp?: string;
};

function pretty(value: unknown): string {
  if (value === null || value === undefined) {
    return "Not available";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function Page(): JSX.Element {
  const [status, setStatus] = useState<StatusPayload>({ ok: true });
  const [loading, setLoading] = useState(false);
  const [patchText, setPatchText] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = async (): Promise<void> => {
    const response = await fetch("/api/status", { cache: "no-store" });
    const payload = (await response.json()) as StatusPayload;
    setStatus(payload);
  };

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  const runBadge = useMemo(() => {
    return status.runActive ? "running" : "idle";
  }, [status.runActive]);

  const onRun = async (): Promise<void> => {
    setLoading(true);
    setNotice("");
    const response = await fetch("/api/run", { method: "POST" });
    const payload = (await response.json()) as { ok: boolean; message: string };
    setNotice(payload.message);
    setLoading(false);
    void refresh();
  };

  const onSavePatch = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setLoading(true);
    setNotice("");
    const response = await fetch("/api/patch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patch: patchText }),
    });
    const payload = (await response.json()) as { ok: boolean; message: string };
    setNotice(payload.message);
    setLoading(false);
    void refresh();
  };

  return (
    <main>
      <h1>deplo.app Console</h1>
      <p className="meta">Local control plane for repair-loop, patching, and artifact visibility.</p>

      <section>
        <h2>Status</h2>
        <div className="row">
          <span className="pill">Loop: {runBadge}</span>
          <span className="pill">Updated: {status.timestamp ?? "n/a"}</span>
        </div>
        <p>
          <strong>Last deploy URL:</strong> {status.lastDeployUrl ?? "Not available"}
        </p>
        <p>
          <strong>Last error:</strong>
        </p>
        <pre>{pretty(status.lastError)}</pre>
        <p>
          <strong>Repair history:</strong>
        </p>
        <pre>{pretty(status.repairHistory)}</pre>
      </section>

      <section>
        <h2>Repair Loop</h2>
        <div className="row">
          <button onClick={onRun} disabled={loading}>
            Run repair loop
          </button>
          {notice ? <span className="meta">{notice}</span> : null}
        </div>
        <p className="meta">Command: node ../../dist/cli.js repair-loop --max 3 --copy</p>
        <pre>{status.uiLastRunLog || "No run output yet."}</pre>
      </section>

      <section>
        <h2>Patch</h2>
        <form onSubmit={onSavePatch}>
          <textarea
            value={patchText}
            onChange={(event) => setPatchText(event.target.value)}
            placeholder="Paste unified diff here..."
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button type="submit" disabled={loading}>
              Save patch
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2>Logs</h2>
        <details>
          <summary>.bowerbird/last_deploy_log.txt</summary>
          <pre>{status.lastDeployLog || "No deploy log found."}</pre>
        </details>
        <details>
          <summary>.bowerbird/last_apply_patch_log.txt</summary>
          <pre>{status.lastApplyPatchLog || "No apply-patch log found."}</pre>
        </details>
      </section>
    </main>
  );
}

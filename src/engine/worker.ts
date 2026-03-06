import { getNextJob, updateJobStatus } from "./queue";
import type { Job } from "./types";

type Executor = (job: Job) => Promise<{ ok: boolean; output: string }>;

let running = false;
let started = false;

async function tick(executor: Executor): Promise<void> {
  if (running) {
    return;
  }
  running = true;

  try {
    const next = getNextJob();
    if (!next) {
      return;
    }

    updateJobStatus(next.id, "running", { startedAt: Date.now() });
    try {
      const result = await executor(next);
      updateJobStatus(next.id, result.ok ? "success" : "failed", {
        finishedAt: Date.now(),
        output: result.output,
      });
    } catch (error) {
      updateJobStatus(next.id, "failed", {
        finishedAt: Date.now(),
        output: error instanceof Error ? error.message : "Worker execution failed.",
      });
    }
  } finally {
    running = false;
  }
}

export function startWorker(executor: Executor): void {
  if (started) {
    return;
  }
  started = true;

  const loop = async (): Promise<void> => {
    await tick(executor);
    setTimeout(loop, 500);
  };

  void loop();
}

import { getAdapterForCapability } from "../providers";
import type { CapabilityName } from "../providers";
import { addJob, getJobs } from "./queue";
import type { Job } from "./types";
import { startWorker } from "./worker";

type HandlerResult = { ok: boolean; output: string };
type JobHandler = (job: Job) => Promise<HandlerResult>;

let initialized = false;
let customHandler: JobHandler | null = null;

type JobMapping = {
  capability: CapabilityName;
  payload?: any;
};

function mapJobToCapability(job: Job): JobMapping | null {
  if (job.type === "deploy_preview") {
    return { capability: "deploy_preview" };
  }
  if (job.type === "deploy_production") {
    return { capability: "deploy_production" };
  }
  if (job.type === "deploy_supabase_function") {
    const functionName = job.payload?.functionName ?? job.payload?.name;
    return {
      capability: "supabase_functions",
      payload: {
        functionName,
        projectRef: job.payload?.projectRef,
      },
    };
  }
  if (job.type === "add_env") {
    return {
      capability: "env_management",
      payload: {
        key: job.payload?.key,
        value: job.payload?.value,
        target: job.payload?.target,
      },
    };
  }
  if (job.type === "view_logs") {
    return { capability: "logs" };
  }
  return null;
}

async function executeJob(job: Job): Promise<HandlerResult> {
  const mapping = mapJobToCapability(job);
  if (mapping) {
    const capability = mapping.capability;
    const adapter = getAdapterForCapability(capability);
    if (adapter) {
      return adapter.execute(capability, mapping.payload ?? job.payload);
    }
  }

  if (customHandler) {
    return customHandler(job);
  }

  return {
    ok: false,
    output: `No handler for job type: ${job.type}`,
  };
}

export function initEngine(handler?: JobHandler): void {
  if (handler) {
    customHandler = handler;
  }
  if (initialized) {
    return;
  }

  startWorker(async (job) => executeJob(job));
  initialized = true;
}

export function enqueue(type: string, payload?: any): Job {
  return addJob({ type, payload });
}

export function getAllJobs(): Job[] {
  return getJobs();
}

export async function waitForJob(jobId: string, timeoutMs = 120000): Promise<Job | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = getJobs().find((item) => item.id === jobId);
    if (job && (job.status === "success" || job.status === "failed")) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

import type { Job } from "./types";

const jobs: Job[] = [];
const MAX_JOBS = 20;

function trimJobs(): void {
  if (jobs.length <= MAX_JOBS) {
    return;
  }
  jobs.splice(0, jobs.length - MAX_JOBS);
}

export function addJob(job: Omit<Job, "id" | "status" | "createdAt"> & Partial<Pick<Job, "id" | "status" | "createdAt">>): Job {
  const next: Job = {
    id: job.id ?? `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: job.type,
    payload: job.payload,
    status: job.status ?? "queued",
    createdAt: job.createdAt ?? Date.now(),
  };

  jobs.push(next);
  trimJobs();
  return next;
}

export function getNextJob(): Job | undefined {
  return jobs.find((job) => job.status === "queued");
}

export function getJobs(): Job[] {
  return [...jobs];
}

export function updateJobStatus(
  id: string,
  status: Job["status"],
  patch: Partial<Pick<Job, "startedAt" | "finishedAt" | "output">> = {},
): Job | undefined {
  const job = jobs.find((item) => item.id === id);
  if (!job) {
    return undefined;
  }

  job.status = status;
  if (status === "running" && !job.startedAt) {
    job.startedAt = Date.now();
  }
  if ((status === "success" || status === "failed") && !job.finishedAt) {
    job.finishedAt = Date.now();
  }

  if (patch.startedAt !== undefined) {
    job.startedAt = patch.startedAt;
  }
  if (patch.finishedAt !== undefined) {
    job.finishedAt = patch.finishedAt;
  }
  if (patch.output !== undefined) {
    job.output = patch.output;
  }

  return job;
}

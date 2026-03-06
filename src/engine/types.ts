export type Job = {
  id: string;
  type: string;
  payload?: any;
  status: "queued" | "running" | "success" | "failed";
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  output?: string;
};

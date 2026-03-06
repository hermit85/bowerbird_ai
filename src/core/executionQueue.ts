type Operation = {
  id: string;
  instruction: string;
  status: "queued" | "running" | "success" | "error";
  startedAt?: string;
  finishedAt?: string;
};

const queue: Operation[] = [];

function trimQueue(): void {
  if (queue.length <= 20) {
    return;
  }
  queue.splice(0, queue.length - 20);
}

export function addOperation(instruction: string): Operation {
  const operation: Operation = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    instruction,
    status: "queued",
  };
  queue.push(operation);
  trimQueue();
  return operation;
}

export function updateOperation(id: string, status: Operation["status"]): void {
  const operation = queue.find((item) => item.id === id);
  if (!operation) {
    return;
  }

  operation.status = status;
  if (status === "running") {
    operation.startedAt = new Date().toISOString();
    operation.finishedAt = undefined;
    return;
  }

  if (status === "success" || status === "error") {
    if (!operation.startedAt) {
      operation.startedAt = new Date().toISOString();
    }
    operation.finishedAt = new Date().toISOString();
  }
}

export function getQueue(): Operation[] {
  return [...queue];
}

export type { Operation };


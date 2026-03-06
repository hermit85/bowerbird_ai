type AutoResult = {
  executed: string[];
  skipped: string[];
};

type AutoExecutor = (instruction: string) => Promise<void>;

let executor: AutoExecutor = async () => {
  throw new Error("Auto executor is not configured.");
};

export function setAutoExecutor(nextExecutor: AutoExecutor): void {
  executor = nextExecutor;
}

async function executeInstruction(instruction: string): Promise<void> {
  await executor(instruction);
}

export async function runAutoMode(state: any, suggestions: any[]): Promise<AutoResult> {
  const safeActions = [
    "deploy preview",
    "deploy supabase function NAME",
  ];

  const result: AutoResult = {
    executed: [],
    skipped: [],
  };

  void state;

  for (const s of suggestions) {
    const action = s?.action;
    if (typeof action !== "string") {
      continue;
    }

    if (safeActions.includes(action)) {
      await executeInstruction(action);
      result.executed.push(action);
    } else {
      result.skipped.push(action);
    }
  }

  return result;
}

export type { AutoResult };


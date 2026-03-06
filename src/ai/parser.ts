export type ExecutionAction =
  | { type: "deploy_preview" }
  | { type: "deploy_production" }
  | { type: "env_add"; key: string; value?: string }
  | { type: "deploy_supabase_function"; name: string }
  | { type: "run_repair" }
  | { type: "show_logs" };

export type ExecutionPlan = {
  actions: ExecutionAction[];
  rawInput: string;
};

function normalizeLine(line: string): string {
  return line
    .trim()
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+[\).:\-]\s+/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ");
}

function parseLine(line: string): ExecutionAction | null {
  const normalized = normalizeLine(line);
  if (!normalized) {
    return null;
  }

  if (/\bdeploy\s+preview\b/i.test(normalized)) {
    return { type: "deploy_preview" };
  }
  if (/\bdeploy\s+production\b/i.test(normalized)) {
    return { type: "deploy_production" };
  }
  if (/\brun\s+repair\b/i.test(normalized)) {
    return { type: "run_repair" };
  }
  if (/\bshow\s+logs\b/i.test(normalized)) {
    return { type: "show_logs" };
  }

  const envMatch = normalized.match(/\badd\s+env\s+([A-Z0-9_]+)\b/i);
  if (envMatch?.[1]) {
    return {
      type: "env_add",
      key: envMatch[1].toUpperCase(),
    };
  }

  const supabaseFunction = normalized.match(/deploy supabase function\s+([a-zA-Z0-9_-]+)/i);
  if (supabaseFunction?.[1]) {
    return {
      type: "deploy_supabase_function",
      name: supabaseFunction[1],
    };
  }

  return null;
}

export function parseAIInstructions(text: string): ExecutionPlan {
  const actions: ExecutionAction[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed) {
      actions.push(parsed);
    }
  }
  return {
    actions,
    rawInput: text,
  };
}

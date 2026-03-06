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

type IndexedAction = {
  index: number;
  action: ExecutionAction;
};

function parseLine(line: string): ExecutionAction[] {
  const normalized = normalizeLine(line);
  if (!normalized) {
    return [];
  }

  const matches: IndexedAction[] = [];

  const pushSimple = (re: RegExp, action: ExecutionAction): void => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(normalized)) !== null) {
      matches.push({ index: m.index, action });
    }
  };

  const pushCaptured = (re: RegExp, toAction: (match: RegExpExecArray) => ExecutionAction): void => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(normalized)) !== null) {
      matches.push({ index: m.index, action: toAction(m) });
    }
  };

  pushSimple(/\b(?:deploy\s+preview|run\s+preview\s+deploy|preview\s+deploy)\b/gi, {
    type: "deploy_preview",
  });
  pushSimple(/\b(?:deploy\s+production|run\s+production\s+deploy|production\s+deploy)\b/gi, {
    type: "deploy_production",
  });
  pushSimple(/\b(?:run\s+repair|repair\s+deployment)\b/gi, { type: "run_repair" });
  pushSimple(/\b(?:show\s+logs|view\s+logs)\b/gi, { type: "show_logs" });

  pushCaptured(/\b(?:add\s+env|set\s+environment\s+variable)\s+([A-Z][A-Z0-9_]*)\b/gi, (m) => ({
    type: "env_add",
    key: m[1].toUpperCase(),
  }));

  pushCaptured(/\bdeploy(?:\s+the)?\s+supabase\s+function\s+([a-zA-Z0-9_-]+)\b/gi, (m) => ({
    type: "deploy_supabase_function",
    name: m[1],
  }));

  matches.sort((a, b) => a.index - b.index);
  return matches.map((m) => m.action);
}

export function parseAIInstructions(text: string): ExecutionPlan {
  const actions: ExecutionAction[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    actions.push(...parseLine(line));
  }
  return {
    actions,
    rawInput: text,
  };
}

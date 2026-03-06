export type ExecutionAction =
  | { type: "connect_database" }
  | { type: "deploy_backend_functions" }
  | { type: "prepare_preview" }
  | { type: "make_app_live" }
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

function toSegments(text: string): string[] {
  // Normalize bullets and numbered list prefixes first.
  const cleanedLines = text
    .split(/\r?\n/)
    .map((line) => normalizeLine(line))
    .filter((line) => line.length > 0);

  if (cleanedLines.length === 0) {
    return [];
  }

  // Join long chats into one stream, then split into sentence-like segments.
  const stream = cleanedLines.join(" ").replace(/\s+/g, " ").trim();
  const pieces = stream.split(/(?<=[.!?])\s+|(?:\s*;\s*)/g);
  return pieces
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
}

function parseSegment(segment: string): ExecutionAction[] {
  const normalized = normalizeLine(segment);
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

  pushSimple(/\b(?:connect(?:\s+the)?\s+database|set\s+up\s+database)\b/gi, {
    type: "connect_database",
  });
  pushSimple(/\b(?:deploy\s+backend(?:\s+functions?)?)\b/gi, {
    type: "deploy_backend_functions",
  });
  pushSimple(/\b(?:prepare\s+preview|deploy\s+preview|run\s+preview\s+deploy|preview\s+deploy)\b/gi, {
    type: "prepare_preview",
  });
  pushSimple(/\b(?:make\s+app\s+live|go\s+live|deploy\s+production|run\s+production\s+deploy|production\s+deploy)\b/gi, {
    type: "make_app_live",
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

  pushSimple(/\blaunch\s+(?:saas|app)\b/gi, { type: "connect_database" });
  pushSimple(/\blaunch\s+(?:saas|app)\b/gi, { type: "deploy_backend_functions" });
  pushSimple(/\blaunch\s+(?:saas|app)\b/gi, { type: "prepare_preview" });
  pushSimple(/\blaunch\s+(?:saas|app)\b/gi, { type: "make_app_live" });

  matches.sort((a, b) => a.index - b.index);
  return matches.map((m) => m.action);
}

export function parseAIInstructions(text: string): ExecutionPlan {
  const actions: ExecutionAction[] = [];
  const segments = toSegments(text);
  const seen = new Set<string>();

  const actionKey = (action: ExecutionAction): string => {
    if (action.type === "env_add") {
      return `${action.type}:${action.key.toUpperCase()}`;
    }
    if (action.type === "deploy_supabase_function") {
      return `${action.type}:${action.name.toLowerCase()}`;
    }
    return action.type;
  };

  for (const segment of segments) {
    const parsed = parseSegment(segment);
    for (const action of parsed) {
      const key = actionKey(action);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      actions.push(action);
    }
  }
  return {
    actions,
    rawInput: text,
  };
}

import type { ParsedCommand, ParsedIntent } from "./types";

function normalizeLine(line: string): string {
  return line
    .trim()
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+[\).:\-]\s+/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ");
}

function toSegments(text: string): string[] {
  const cleanedLines = text
    .split(/\r?\n/)
    .map((line) => normalizeLine(line))
    .filter((line) => line.length > 0);

  if (cleanedLines.length === 0) {
    return [];
  }

  const stream = cleanedLines.join(" ").replace(/\s+/g, " ").trim();
  const pieces = stream.split(/(?<=[.!?])\s+|(?:\s*;\s*)/g);
  return pieces
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
}

type IndexedIntent = {
  index: number;
  intent: ParsedIntent;
};

function parseSegment(rawCommand: string, segment: string): ParsedIntent[] {
  const normalized = normalizeLine(segment);
  if (!normalized) {
    return [];
  }

  const matches: IndexedIntent[] = [];

  const pushSimple = (re: RegExp, intent: ParsedIntent): void => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(normalized)) !== null) {
      matches.push({ index: m.index, intent });
    }
  };

  const pushCaptured = (re: RegExp, toIntent: (match: RegExpExecArray) => ParsedIntent): void => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(normalized)) !== null) {
      matches.push({ index: m.index, intent: toIntent(m) });
    }
  };

  pushSimple(/\b(?:launch\s+(?:saas|app))\b/gi, {
    rawCommand,
    intent: "launch_application",
    target: "production",
  });
  pushSimple(/\b(?:connect(?:\s+the)?\s+database|set\s+up\s+database)\b/gi, {
    rawCommand,
    intent: "connect_database",
  });
  pushSimple(/\b(?:deploy\s+backend(?:\s+functions?)?)\b/gi, {
    rawCommand,
    intent: "deploy_backend",
  });
  pushSimple(/\b(?:prepare\s+preview|deploy\s+preview|run\s+preview\s+deploy|preview\s+deploy)\b/gi, {
    rawCommand,
    intent: "prepare_preview",
  });
  pushSimple(/\b(?:make\s+app\s+live|go\s+live|deploy\s+production|run\s+production\s+deploy|production\s+deploy)\b/gi, {
    rawCommand,
    intent: "make_app_live",
    target: "production",
  });
  pushSimple(/\b(?:run\s+repair|repair\s+deployment)\b/gi, { rawCommand, intent: "run_repair" });
  pushSimple(/\b(?:show\s+logs|view\s+logs)\b/gi, { rawCommand, intent: "show_logs" });

  pushCaptured(/\b(?:add\s+env|set\s+environment\s+variable)\s+([A-Z][A-Z0-9_]*)\b/gi, (m) => ({
    rawCommand,
    intent: "env_add",
    key: m[1].toUpperCase(),
  }));

  pushCaptured(/\bdeploy(?:\s+the)?\s+supabase\s+function\s+([a-zA-Z0-9_-]+)\b/gi, (m) => ({
    rawCommand,
    intent: "deploy_supabase_function",
    name: m[1],
  }));

  matches.sort((a, b) => a.index - b.index);
  return matches.map((m) => m.intent);
}

function intentKey(intent: ParsedIntent): string {
  if (intent.intent === "env_add") {
    return `${intent.intent}:${intent.key.toUpperCase()}`;
  }
  if (intent.intent === "deploy_supabase_function") {
    return `${intent.intent}:${intent.name.toLowerCase()}`;
  }
  return intent.intent;
}

export function parseAIInstructions(text: string): ParsedCommand {
  const rawCommand = text;
  const intents: ParsedIntent[] = [];
  const segments = toSegments(text);
  const seen = new Set<string>();

  for (const segment of segments) {
    const parsed = parseSegment(rawCommand, segment);
    for (const intent of parsed) {
      const key = intentKey(intent);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      intents.push(intent);
    }
  }

  return {
    rawCommand,
    intents,
  };
}


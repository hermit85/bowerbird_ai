export type ParsedAction = {
  label: string;
  instruction: string;
};

export function extractActions(text: string): ParsedAction[] {
  const actions: ParsedAction[] = [];
  const lower = text.toLowerCase();

  if (lower.includes("deploy preview")) {
    actions.push({
      label: "Deploy preview",
      instruction: "deploy preview",
    });
  }

  if (lower.includes("deploy production")) {
    actions.push({
      label: "Deploy production",
      instruction: "deploy production",
    });
  }

  if (lower.includes("deploy supabase function")) {
    actions.push({
      label: "Deploy Supabase function",
      instruction: "deploy supabase function NAME",
    });
  }

  if (lower.includes("add env")) {
    actions.push({
      label: "Add environment variable",
      instruction: "add env KEY to vercel",
    });
  }

  return actions;
}


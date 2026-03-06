export type DoStep = {
  title: string;
  cmd: string;
  args: string[];
};

export type DoPlan = {
  detectedTask:
    | "vercel_env_add"
    | "deploy_preview"
    | "deploy_production"
    | "supabase_function_deploy";
  sourceText: string;
  steps: DoStep[];
  metadata?: {
    key?: string;
    functionName?: string;
    projectRef?: string;
  };
};

export function normalizeInstruction(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseDoInstruction(rawText: string): DoPlan | null {
  const sourceText = normalizeInstruction(rawText);
  const normalized = sourceText;

  const envMatch = normalized.match(
    /(?:add env|add environment variable|set vercel env)\s+([A-Z0-9_]+)\b.*\bvercel\b/i,
  );
  if (envMatch?.[1]) {
    const key = envMatch[1].toUpperCase();
    return {
      detectedTask: "vercel_env_add",
      sourceText,
      metadata: { key },
      steps: [
        { title: `Add Vercel env var ${key}`, cmd: "vercel", args: ["env", "add", key] },
      ],
    };
  }

  const supabaseMatch = normalized.match(
    /^deploy supabase function ([a-zA-Z0-9_-]+)\s+--project-ref\s+([a-zA-Z0-9_-]+)$/,
  );
  if (supabaseMatch?.[1] && supabaseMatch?.[2]) {
    const functionName = supabaseMatch[1];
    const projectRef = supabaseMatch[2];
    return {
      detectedTask: "supabase_function_deploy",
      sourceText,
      metadata: { functionName, projectRef },
      steps: [
        {
          title: `Deploy Supabase function ${functionName}`,
          cmd: "supabase",
          args: ["functions", "deploy", functionName, "--project-ref", projectRef],
        },
      ],
    };
  }

  if (normalized === "deploy production" || normalized === "redeploy production") {
    return {
      detectedTask: "deploy_production",
      sourceText,
      steps: [
        { title: "Check git status", cmd: "git", args: ["status", "--porcelain"] },
        { title: "Stage changes", cmd: "git", args: ["add", "."] },
        { title: "Commit changes", cmd: "git", args: ["commit", "-m", "chore: deploy"] },
        { title: "Push changes", cmd: "git", args: ["push"] },
        { title: "Create production deploy", cmd: "vercel", args: ["--prod", "--yes"] },
      ],
    };
  }

  if (
    normalized === "deploy preview" ||
    normalized === "redeploy" ||
    normalized === "redeploy preview" ||
    normalized === "vercel deploy"
  ) {
    return {
      detectedTask: "deploy_preview",
      sourceText,
      steps: [
        { title: "Check git status", cmd: "git", args: ["status", "--porcelain"] },
        { title: "Stage changes", cmd: "git", args: ["add", "."] },
        { title: "Commit changes", cmd: "git", args: ["commit", "-m", "chore: deploy"] },
        { title: "Push changes", cmd: "git", args: ["push"] },
        { title: "Create preview deploy", cmd: "vercel", args: ["deploy", "--yes"] },
      ],
    };
  }

  return null;
}

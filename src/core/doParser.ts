export type DoStep = {
  title: string;
  cmd: string;
  args: string[];
};

export type DoPlan = {
  detectedTask: "vercel_env_add" | "deploy_preview";
  sourceText: string;
  steps: DoStep[];
  metadata?: Record<string, string>;
};

export function normalizeInstruction(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function parseDoInstruction(rawText: string): DoPlan | null {
  const sourceText = normalizeInstruction(rawText);
  const normalized = sourceText.toLowerCase();

  const envMatch = sourceText.match(
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

  if (/\bdeploy preview\b/i.test(normalized) || /\bredeploy preview\b/i.test(normalized) || /\bvercel deploy\b/i.test(normalized)) {
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

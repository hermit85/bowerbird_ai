import { createInterface } from "node:readline/promises";
import { execa } from "execa";
import { fail, ok, warn } from "../core/reporter";
import { run } from "../core/runner";
import { deploy } from "./deploy";

type ParsedInstruction =
  | { type: "vercel_env_add"; key: string }
  | { type: "deploy_preview" };

function parseInstruction(text: string): ParsedInstruction | null {
  const normalized = text.trim().toLowerCase();

  const envMatch = normalized.match(
    /(?:add env|add environment variable)\s+([a-z_][a-z0-9_]*)\s+to vercel/i,
  );
  if (envMatch?.[1]) {
    return { type: "vercel_env_add", key: envMatch[1].toUpperCase() };
  }

  if (/\bdeploy preview\b/i.test(normalized) || /\bredeploy\b/i.test(normalized)) {
    return { type: "deploy_preview" };
  }

  return null;
}

async function promptSecret(label: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const value = await rl.question(`Enter value for ${label}: `);
    return value;
  } finally {
    rl.close();
  }
}

export async function doCommand(): Promise<number> {
  if (process.platform !== "darwin") {
    warn("`bowerbird do` currently supports clipboard parsing on macOS only.");
    return 1;
  }

  const paste = await execa("pbpaste", [], { reject: false });
  if ((paste.exitCode ?? 1) !== 0) {
    warn("pbpaste is not available. Copy instruction text to clipboard and retry.");
    return 1;
  }

  const instruction = paste.stdout ?? "";
  if (!instruction.trim()) {
    warn("Clipboard is empty. Copy an instruction first.");
    return 1;
  }

  const parsed = parseInstruction(instruction);
  if (!parsed) {
    warn("Could not detect a supported instruction.");
    warn("Supported: add env <KEY> to vercel, add environment variable <KEY> to vercel, deploy preview, redeploy");
    return 1;
  }

  if (parsed.type === "vercel_env_add") {
    ok(`Detected instruction: add env ${parsed.key} to Vercel`);
    const value = await promptSecret(parsed.key);
    const result = await run("vercel", ["env", "add", parsed.key], { input: `${value}\n` });
    if (result.exitCode !== 0) {
      fail("Failed to add Vercel environment variable.", result.stderr || result.stdout);
      return 1;
    }
    ok(`Added ${parsed.key} to Vercel.`);
    return 0;
  }

  ok("Detected instruction: deploy preview");
  return deploy([]);
}

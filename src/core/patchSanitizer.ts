import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type SanitizeResult = {
  ok: boolean;
  message?: string;
  sanitizedPath: string;
};

export async function sanitizeRepairPatchFile(projectRoot: string): Promise<SanitizeResult> {
  const metaDir = path.resolve(projectRoot, ".bowerbird");
  const rawPatchPath = path.resolve(metaDir, "repair_patch.diff");
  const sanitizedPatchPath = path.resolve(metaDir, "repair_patch.sanitized.diff");

  let raw: string;
  try {
    raw = await readFile(rawPatchPath, "utf8");
  } catch {
    return {
      ok: false,
      message: "Could not read .bowerbird/repair_patch.diff.",
      sanitizedPath: sanitizedPatchPath,
    };
  }

  const noFences = raw
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("```"))
    .join("\n");
  const lines = noFences.split(/\r?\n/);
  let startIndex = lines.findIndex((line) => line.startsWith("diff --git "));
  if (startIndex === -1) {
    startIndex = lines.findIndex((line) => line.startsWith("--- "));
  }
  if (startIndex === -1) {
    return {
      ok: false,
      message: "Patch is not a valid unified diff.",
      sanitizedPath: sanitizedPatchPath,
    };
  }

  await mkdir(metaDir, { recursive: true });
  const sanitized = `${lines.slice(startIndex).join("\n").trim()}\n`;
  await writeFile(sanitizedPatchPath, sanitized, "utf8");
  return { ok: true, sanitizedPath: sanitizedPatchPath };
}

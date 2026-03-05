import type { ParsedDeployLog } from "./logParser";

export type ErrorCategory =
  | "module_not_found"
  | "missing_env_variables"
  | "typescript_compile_errors"
  | "dependency_install_failures"
  | "unknown";

const CATEGORY_PATTERNS: Array<{ category: ErrorCategory; pattern: RegExp }> = [
  {
    category: "module_not_found",
    pattern: /(module not found|cannot find module|can't resolve)/i,
  },
  {
    category: "missing_env_variables",
    pattern: /(missing env|environment variable|is not set|undefined.*env|missing required env)/i,
  },
  {
    category: "typescript_compile_errors",
    pattern: /(typescript|tsc|ts\d{4}|type .* is not assignable)/i,
  },
  {
    category: "dependency_install_failures",
    pattern: /(npm err!|failed to install|could not resolve dependency|eresolve)/i,
  },
];

export function classifyErrors(parsed: ParsedDeployLog): ErrorCategory[] {
  const haystack = [parsed.raw, ...parsed.errorLines].join("\n");
  const categories = CATEGORY_PATTERNS.filter((entry) => entry.pattern.test(haystack)).map(
    (entry) => entry.category,
  );

  if (categories.length === 0) {
    return ["unknown"];
  }

  return categories;
}

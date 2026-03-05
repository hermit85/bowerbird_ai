import type { ParsedDeployError } from "./logParser";

export type ClassifiedError = {
  type:
    | "MODULE_NOT_FOUND"
    | "MISSING_ENV"
    | "TYPESCRIPT_ERROR"
    | "DEPENDENCY_ERROR"
    | "BUILD_FAILURE";
  message: string;
  file?: string;
  line?: number;
};

export function classifyError(parsed: ParsedDeployError): ClassifiedError {
  const text = parsed.message;

  let type: ClassifiedError["type"] = "BUILD_FAILURE";
  if (/cannot find module|module not found|can't resolve/i.test(text)) {
    type = "MODULE_NOT_FOUND";
  } else if (/process\.env|environment variable|missing env|is not set/i.test(text)) {
    type = "MISSING_ENV";
  } else if (/ts\d{4}|typescript|type .* is not assignable/i.test(text)) {
    type = "TYPESCRIPT_ERROR";
  } else if (/npm err!|eresolve|dependency/i.test(text)) {
    type = "DEPENDENCY_ERROR";
  }

  return {
    type,
    message: parsed.message,
    file: parsed.file,
    line: parsed.line,
  };
}

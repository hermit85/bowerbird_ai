export type ParsedDeployLog = {
  raw: string;
  lines: string[];
  errorLines: string[];
};

const ERROR_LINE_PATTERN =
  /(error|failed|failure|cannot|can't|not found|missing|ts\d{4}|npm err!)/i;

export function parseDeployLog(logText: string): ParsedDeployLog {
  const lines = logText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const errorLines = lines.filter((line) => ERROR_LINE_PATTERN.test(line));

  return {
    raw: logText,
    lines,
    errorLines,
  };
}

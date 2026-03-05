export type ParsedDeployError = {
  step: string;
  message: string;
  file?: string;
  line?: number;
};

const STEP_PATTERN = /^\$\s+(.+)$/;
const ERROR_PATTERN =
  /(error|failed|failure|cannot find module|can't resolve|module not found|npm err!|ts\d{4}|process\.env)/i;
const FILE_LINE_PATTERN = /((?:[A-Za-z]:)?[^\s:]+\.[a-zA-Z0-9]+):(\d+)(?::\d+)?/;

export function parseDeployLog(logText: string): ParsedDeployError {
  const lines = logText.split(/\r?\n/);

  let currentStep = "unknown";
  let failingStep = "unknown";
  let message = "Unknown deploy failure";
  let file: string | undefined;
  let line: number | undefined;

  for (const rawLine of lines) {
    const lineText = rawLine.trim();
    if (!lineText) {
      continue;
    }

    const stepMatch = lineText.match(STEP_PATTERN);
    if (stepMatch?.[1]) {
      currentStep = stepMatch[1];
    }

    if (ERROR_PATTERN.test(lineText)) {
      failingStep = currentStep;
      message = lineText;

      const fileLineMatch = lineText.match(FILE_LINE_PATTERN);
      if (fileLineMatch?.[1]) {
        file = fileLineMatch[1];
      }
      if (fileLineMatch?.[2]) {
        const parsedLine = Number.parseInt(fileLineMatch[2], 10);
        if (!Number.isNaN(parsedLine)) {
          line = parsedLine;
        }
      }
    }
  }

  return {
    step: failingStep,
    message,
    file,
    line,
  };
}

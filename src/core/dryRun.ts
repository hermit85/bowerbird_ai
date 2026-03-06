let dryRunEnabled = false;

export function isDryRun(args: string[]): boolean {
  return args.includes("--dry");
}

export function setDryRun(enabled: boolean): void {
  dryRunEnabled = enabled;
}

export function getDryRun(): boolean {
  return dryRunEnabled;
}

export function assertNotDryRun(actionName: string): void {
  if (!dryRunEnabled) {
    return;
  }

  console.log(`[DRY RUN] Skipping ${actionName}`);
  throw new Error(`DRY RUN blocked action: ${actionName}`);
}


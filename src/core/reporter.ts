import chalk from "chalk";

export function ok(label: string): void {
  console.log(chalk.green(`[OK] ${label}`));
}

export function warn(label: string, detail?: string): void {
  console.log(chalk.yellow(`[WARN] ${label}`));
  if (detail) {
    console.log(chalk.yellow(`       ${detail}`));
  }
}

export function fail(label: string, detail?: string): void {
  console.log(chalk.red(`[BLOCKER] ${label}`));
  if (detail) {
    console.log(chalk.red(`          ${detail}`));
  }
}

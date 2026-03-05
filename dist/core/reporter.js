import chalk from "chalk";
export function ok(label) {
    console.log(chalk.green(`[OK] ${label}`));
}
export function warn(label, detail) {
    console.log(chalk.yellow(`[WARN] ${label}`));
    if (detail) {
        console.log(chalk.yellow(`       ${detail}`));
    }
}
export function fail(label, detail) {
    console.log(chalk.red(`[BLOCKER] ${label}`));
    if (detail) {
        console.log(chalk.red(`          ${detail}`));
    }
}

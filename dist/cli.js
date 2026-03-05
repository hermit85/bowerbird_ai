#!/usr/bin/env node
import { doctor } from "./recipes/doctor";
import { deploy } from "./recipes/deploy";
function printHelp() {
    console.log("Usage: bowerbird <command> [options]");
    console.log("");
    console.log("Commands:");
    console.log("  doctor        Run environment and tooling diagnostics");
    console.log("  deploy        Commit/push and trigger Vercel deploy");
    console.log("");
    console.log("Options:");
    console.log("  --config      TODO: custom config path override");
}
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    const hasConfigFlag = args.includes("--config");
    // TODO: wire --config to getConfig()/run once override support is added.
    if (hasConfigFlag) {
        console.warn("`--config` is not implemented yet. Using operator.config.json in current directory.");
    }
    if (command === "doctor") {
        const code = await doctor();
        process.exitCode = code;
        return;
    }
    if (command === "deploy") {
        const code = await deploy(args.slice(1));
        process.exitCode = code;
        return;
    }
    printHelp();
    process.exitCode = 1;
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unexpected error while running CLI.";
    console.error(`Error: ${message}`);
    process.exitCode = 1;
});

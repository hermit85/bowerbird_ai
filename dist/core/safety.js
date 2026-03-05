export function ensureSafe(cmd, args, allowCommands, blockedPatterns) {
    const binary = cmd.trim();
    if (!binary) {
        throw new Error("Blocked command: empty command.");
    }
    if (!allowCommands.includes(binary)) {
        throw new Error(`Blocked command: "${binary}" is not in allowCommands (${allowCommands.join(", ") || "none configured"}).`);
    }
    const fullCommand = [binary, ...args].join(" ");
    const matchedPattern = blockedPatterns.find((pattern) => fullCommand.includes(pattern));
    if (matchedPattern) {
        throw new Error(`Blocked command: matched blocked pattern "${matchedPattern}" in "${fullCommand}".`);
    }
}

export type RunResult = {
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
};
type RunOptions = {
    cwd?: string;
};
export declare function run(cmd: string, args?: string[], options?: RunOptions): Promise<RunResult>;
export {};
//# sourceMappingURL=runner.d.ts.map
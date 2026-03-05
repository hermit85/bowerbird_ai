import { z } from "zod";
declare const configSchema: z.ZodObject<{
    projectRoot: z.ZodString;
    allowCommands: z.ZodDefault<z.ZodArray<z.ZodString>>;
    blockedPatterns: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type OperatorConfig = z.infer<typeof configSchema>;
export declare function getConfig(): Promise<OperatorConfig>;
export {};
//# sourceMappingURL=config.d.ts.map
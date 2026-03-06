import type { Capabilities } from "./capabilities";
import { isActionAllowed } from "./capabilities";

export type Macro = {
  id: string;
  label: string;
  steps: string[];
};

export const macros: Macro[] = [
  {
    id: "setup_supabase_api",
    label: "Setup Supabase API",
    steps: [
      "add env SUPABASE_URL to vercel",
      "add env SUPABASE_ANON_KEY to vercel",
      "deploy supabase function api",
      "deploy preview",
    ],
  },
  {
    id: "first_deploy",
    label: "First Deploy",
    steps: ["deploy preview"],
  },
];

export function isMacroSupported(macro: Macro, capabilities: Capabilities): boolean {
  return macro.steps.every((step) => isActionAllowed(step, capabilities));
}

export function getSupportedMacros(capabilities: Capabilities): Macro[] {
  return macros.filter((macro) => isMacroSupported(macro, capabilities));
}

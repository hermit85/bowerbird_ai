import assert from "node:assert/strict";
import test from "node:test";
import { parseAIInstructions } from "./parser";

test("parses numbered AI instruction list into deterministic execution plan", () => {
  const input = `To deploy this project you should:
1. add env DATABASE_URL
2. deploy preview
3. deploy supabase function generate
`;

  const plan = parseAIInstructions(input);
  assert.deepEqual(plan, {
    intents: [
      { rawCommand: input, intent: "env_add", key: "DATABASE_URL" },
      { rawCommand: input, intent: "prepare_preview" },
      { rawCommand: input, intent: "deploy_supabase_function", name: "generate" },
    ],
    rawCommand: input,
  });
});

test("parses command variants and ignores irrelevant lines", () => {
  const input = `
- show logs
this line is not a command
2) run repair
deploy production
add env API_KEY
`;

  const plan = parseAIInstructions(input);
  assert.deepEqual(plan, {
    intents: [
      { rawCommand: input, intent: "show_logs" },
      { rawCommand: input, intent: "run_repair" },
      { rawCommand: input, intent: "make_app_live", target: "production" },
      { rawCommand: input, intent: "env_add", key: "API_KEY" },
    ],
    rawCommand: input,
  });
});

test("returns same plan on repeated parse for determinism", () => {
  const input = "deploy preview\nadd env DATABASE_URL\nshow logs\nirrelevant note";
  const first = parseAIInstructions(input);
  const second = parseAIInstructions(input);
  assert.deepEqual(first, second);
  assert.deepEqual(first.intents, [
    { rawCommand: input, intent: "prepare_preview" },
    { rawCommand: input, intent: "env_add", key: "DATABASE_URL" },
    { rawCommand: input, intent: "show_logs" },
  ]);
});

test("parses founder intent phrases into normalized launch actions", () => {
  const input = "launch SaaS and then make app live";
  const plan = parseAIInstructions(input);
  assert.deepEqual(plan.intents, [
    { rawCommand: input, intent: "launch_application", target: "production" },
    { rawCommand: input, intent: "make_app_live", target: "production" },
  ]);
});

test("deduplicates repeated normalized actions while preserving first-seen order", () => {
  const input = "deploy preview and deploy preview then connect database and connect database";
  const plan = parseAIInstructions(input);
  assert.deepEqual(plan.intents, [
    { rawCommand: input, intent: "prepare_preview" },
    { rawCommand: input, intent: "connect_database" },
  ]);
});

test("parses founder-safe suggestion commands", () => {
  const input = "deploy backend\nconnect database\ndeploy preview";
  const plan = parseAIInstructions(input);
  assert.deepEqual(plan.intents, [
    { rawCommand: input, intent: "deploy_backend" },
    { rawCommand: input, intent: "connect_database" },
    { rawCommand: input, intent: "prepare_preview" },
  ]);
});

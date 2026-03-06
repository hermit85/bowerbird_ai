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
    actions: [
      { type: "env_add", key: "DATABASE_URL" },
      { type: "prepare_preview" },
      { type: "deploy_supabase_function", name: "generate" },
    ],
    rawInput: input,
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
    actions: [
      { type: "show_logs" },
      { type: "run_repair" },
      { type: "make_app_live" },
      { type: "env_add", key: "API_KEY" },
    ],
    rawInput: input,
  });
});

test("returns same plan on repeated parse for determinism", () => {
  const input = "deploy preview\nadd env DATABASE_URL\nshow logs\nirrelevant note";
  const first = parseAIInstructions(input);
  const second = parseAIInstructions(input);
  assert.deepEqual(first, second);
  assert.deepEqual(first.actions, [
    { type: "prepare_preview" },
    { type: "env_add", key: "DATABASE_URL" },
    { type: "show_logs" },
  ]);
});

test("parses founder intent phrases into normalized launch actions", () => {
  const input = "launch SaaS and then make app live";
  const plan = parseAIInstructions(input);
  assert.deepEqual(plan.actions, [
    { type: "connect_database" },
    { type: "deploy_backend_functions" },
    { type: "prepare_preview" },
    { type: "make_app_live" },
  ]);
});

test("deduplicates repeated normalized actions while preserving first-seen order", () => {
  const input = "deploy preview and deploy preview then connect database and connect database";
  const plan = parseAIInstructions(input);
  assert.deepEqual(plan.actions, [
    { type: "prepare_preview" },
    { type: "connect_database" },
  ]);
});

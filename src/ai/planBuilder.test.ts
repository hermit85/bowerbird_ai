import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutionPlan } from "./planBuilder";

test("builds launch steps from launch_application intent", () => {
  const result = buildExecutionPlan(
    [
      {
        rawCommand: "launch SaaS",
        intent: "launch_application",
        target: "production",
      },
    ],
    {
      canConnectDatabase: true,
      canDeployBackend: true,
      canDeployPreview: true,
      canDeployProduction: true,
      backendRequired: true,
      backendProvider: "supabase-functions",
    },
    {
      databaseConnected: false,
      backendDeployed: false,
      previewReady: false,
      appLive: false,
    },
  );

  assert.deepEqual(result.steps, [
    { type: "connect_database" },
    { type: "deploy_backend_functions" },
    { type: "prepare_preview" },
    { type: "make_app_live" },
  ]);
  assert.equal(result.reasoning.length, 4);
});


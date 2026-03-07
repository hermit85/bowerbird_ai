import assert from "node:assert/strict";
import test from "node:test";
import { resolveCapabilities } from "./capabilityResolver";

test("resolves backend capabilities from stack", () => {
  const caps = resolveCapabilities({
    stack: {
      framework: "next",
      deploy: "vercel",
      database: "supabase",
      backend: "supabase-functions",
    },
    launch: {
      databaseConnected: false,
      backendDeployed: false,
      previewReady: false,
      appLive: false,
    },
  });

  assert.deepEqual(caps, {
    canConnectDatabase: true,
    canDeployBackend: true,
    canDeployPreview: true,
    canDeployProduction: true,
    backendRequired: true,
    backendProvider: "supabase-functions",
  });
});


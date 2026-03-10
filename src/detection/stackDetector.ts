import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type InspectionConfidence = "confirmed" | "likely" | "not_verified";

export type InspectionFinding = {
  id: string;
  label: string;
  value: string;
  confidence: InspectionConfidence;
  evidence: string[];
};

export type InspectionFindings = {
  stack: InspectionFinding[];
  scripts: InspectionFinding[];
  providerHints: InspectionFinding[];
  serviceHints: InspectionFinding[];
  operationalRequirements: InspectionFinding[];
  uncertainties: InspectionFinding[];
  sourceLimitations: {
    local: InspectionFinding;
    githubOnly: InspectionFinding;
  };
};

export type StackInfo = {
  framework: string | null;
  deploy: string | null;
  database: string | null;
  backend: string | null;
  inspectionFindings: InspectionFindings;
};

export function createEmptyInspectionFindings(): InspectionFindings {
  return {
    stack: [],
    scripts: [],
    providerHints: [],
    serviceHints: [],
    operationalRequirements: [],
    uncertainties: [],
    sourceLimitations: {
      local: {
        id: "source_local",
        label: "Inspection source",
        value: "Local project supports deeper static inspection",
        confidence: "confirmed",
        evidence: ["local filesystem access"],
      },
      githubOnly: {
        id: "source_github_only",
        label: "Inspection source",
        value: "GitHub-only mode cannot fully verify runtime readiness",
        confidence: "not_verified",
        evidence: ["no remote repository file scan"],
      },
    },
  };
}

function readPackageJson(projectRoot: string): Record<string, unknown> | null {
  const packagePath = path.resolve(projectRoot, "package.json");
  if (!existsSync(packagePath)) {
    return null;
  }

  try {
    const raw = readFileSync(packagePath, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function collectDeps(pkg: Record<string, unknown> | null): Record<string, string> {
  if (!pkg) {
    return {};
  }

  const deps = pkg.dependencies;
  const devDeps = pkg.devDependencies;
  return {
    ...(typeof deps === "object" && deps ? (deps as Record<string, string>) : {}),
    ...(typeof devDeps === "object" && devDeps ? (devDeps as Record<string, string>) : {}),
  };
}

function readEnvKeyNames(projectRoot: string): string[] {
  const files = [".env.example", ".env.local", ".env"];
  const names = new Set<string>();
  for (const file of files) {
    const filePath = path.resolve(projectRoot, file);
    if (!existsSync(filePath)) {
      continue;
    }
    try {
      const raw = readFileSync(filePath, "utf8");
      const lines = raw.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          continue;
        }
        const match = trimmed.match(/^([A-Z][A-Z0-9_]*)\s*=/);
        if (match && match[1]) {
          names.add(match[1]);
        }
      }
    } catch {
      // Ignore unreadable env files.
    }
  }
  return [...names];
}

function detectPackageManager(projectRoot: string): { name: string; confidence: InspectionConfidence; evidence: string[] } {
  if (existsSync(path.resolve(projectRoot, "pnpm-lock.yaml"))) {
    return { name: "pnpm", confidence: "confirmed", evidence: ["pnpm-lock.yaml"] };
  }
  if (existsSync(path.resolve(projectRoot, "yarn.lock"))) {
    return { name: "yarn", confidence: "confirmed", evidence: ["yarn.lock"] };
  }
  if (existsSync(path.resolve(projectRoot, "package-lock.json"))) {
    return { name: "npm", confidence: "confirmed", evidence: ["package-lock.json"] };
  }
  if (existsSync(path.resolve(projectRoot, "bun.lockb")) || existsSync(path.resolve(projectRoot, "bun.lock"))) {
    return { name: "bun", confidence: "confirmed", evidence: ["bun lockfile"] };
  }
  return { name: "not detected", confidence: "not_verified", evidence: ["no lockfile found"] };
}

function addFinding(
  findings: InspectionFinding[],
  id: string,
  label: string,
  value: string,
  confidence: InspectionConfidence,
  evidence: string[],
): void {
  findings.push({
    id,
    label,
    value,
    confidence,
    evidence: evidence.filter(Boolean),
  });
}

export function detectStack(projectRoot: string): StackInfo {
  const pkg = readPackageJson(projectRoot);
  const deps = collectDeps(pkg);
  const scripts = (pkg && typeof pkg.scripts === "object" && pkg.scripts)
    ? (pkg.scripts as Record<string, unknown>)
    : {};
  const scriptNames = Object.keys(scripts);
  const envKeys = readEnvKeyNames(projectRoot);
  const packageManager = detectPackageManager(projectRoot);
  const stackFindings: InspectionFinding[] = [];
  const scriptFindings: InspectionFinding[] = [];
  const providerHints: InspectionFinding[] = [];
  const serviceHints: InspectionFinding[] = [];
  const operationalRequirements: InspectionFinding[] = [];
  const uncertainties: InspectionFinding[] = [];

  let framework: string | null = null;
  if (deps.next) {
    framework = "next";
    addFinding(stackFindings, "framework_next", "Framework", "Next.js", "confirmed", ["dependency: next"]);
  } else if (deps.react) {
    if (deps.vite || existsSync(path.resolve(projectRoot, "vite.config.ts")) || existsSync(path.resolve(projectRoot, "vite.config.js"))) {
      framework = "vite";
      addFinding(stackFindings, "framework_vite_react", "Framework", "React with Vite", "confirmed", ["dependency: react", "dependency/config: vite"]);
    } else {
      framework = "react";
      addFinding(stackFindings, "framework_react", "Framework", "React app", "confirmed", ["dependency: react"]);
    }
  } else if (deps.vite) {
    framework = "vite";
    addFinding(stackFindings, "framework_vite", "Framework", "Vite app", "confirmed", ["dependency: vite"]);
  } else if (deps.express || deps.fastify || deps.koa || deps.hono || deps.nestjs) {
    framework = "node-backend";
    addFinding(stackFindings, "framework_node_backend", "Runtime shape", "Node backend", "likely", ["server dependency detected"]);
  } else if (existsSync(path.resolve(projectRoot, "index.html"))) {
    framework = "static";
    addFinding(stackFindings, "framework_static", "Runtime shape", "Static web app", "likely", ["index.html"]);
  } else {
    addFinding(stackFindings, "framework_unknown", "Framework", "Not detected", "not_verified", ["no strong framework signal"]);
  }

  let deploy: string | null = null;
  if (existsSync(path.resolve(projectRoot, "vercel.json"))) {
    deploy = "vercel";
    addFinding(providerHints, "provider_vercel_config", "Deploy provider", "Vercel", "confirmed", ["vercel.json"]);
  } else if (existsSync(path.resolve(projectRoot, "netlify.toml"))) {
    deploy = "netlify";
    addFinding(providerHints, "provider_netlify_config", "Deploy provider", "Netlify", "confirmed", ["netlify.toml"]);
  } else if (existsSync(path.resolve(projectRoot, "wrangler.toml"))) {
    deploy = "cloudflare";
    addFinding(providerHints, "provider_cloudflare", "Deploy provider", "Cloudflare", "confirmed", ["wrangler.toml"]);
  } else {
    if (String(scripts.deploy || "").toLowerCase().includes("vercel")) {
      addFinding(providerHints, "provider_vercel_script", "Deploy provider", "Vercel", "likely", ["package.json scripts.deploy"]);
      deploy = "vercel";
    } else if (String(scripts.deploy || "").toLowerCase().includes("netlify")) {
      addFinding(providerHints, "provider_netlify_script", "Deploy provider", "Netlify", "likely", ["package.json scripts.deploy"]);
      deploy = "netlify";
    } else {
      addFinding(providerHints, "provider_unknown", "Deploy provider", "Not detected", "not_verified", ["no deploy config file found"]);
    }
  }

  const hasSupabase = existsSync(path.resolve(projectRoot, "supabase")) || Boolean(deps["@supabase/supabase-js"]);
  const database: string | null = hasSupabase ? "supabase" : null;
  if (hasSupabase) {
    addFinding(serviceHints, "service_supabase", "Database/service", "Supabase", "confirmed", [
      existsSync(path.resolve(projectRoot, "supabase")) ? "supabase/ directory" : "",
      deps["@supabase/supabase-js"] ? "dependency: @supabase/supabase-js" : "",
    ]);
  }
  if (deps.prisma || existsSync(path.resolve(projectRoot, "prisma", "schema.prisma"))) {
    addFinding(serviceHints, "service_prisma", "Database/service", "Prisma", "likely", [
      deps.prisma ? "dependency: prisma" : "",
      existsSync(path.resolve(projectRoot, "prisma", "schema.prisma")) ? "prisma/schema.prisma" : "",
    ]);
  }
  if (deps.drizzle || existsSync(path.resolve(projectRoot, "drizzle.config.ts")) || existsSync(path.resolve(projectRoot, "drizzle.config.js"))) {
    addFinding(serviceHints, "service_drizzle", "Database/service", "Drizzle", "likely", [
      deps.drizzle ? "dependency: drizzle" : "",
      existsSync(path.resolve(projectRoot, "drizzle.config.ts")) || existsSync(path.resolve(projectRoot, "drizzle.config.js")) ? "drizzle config" : "",
    ]);
  }
  if (serviceHints.length === 0) {
    addFinding(serviceHints, "service_unknown", "Database/service", "No strong DB clue found", "not_verified", ["no database-specific file/dependency found"]);
  }

  const hasSupabaseFunctions = existsSync(path.resolve(projectRoot, "supabase", "functions"));
  const backend: string | null = hasSupabaseFunctions ? "supabase-functions" : null;
  if (hasSupabaseFunctions) {
    addFinding(stackFindings, "backend_supabase_functions", "Backend shape", "Supabase edge functions", "confirmed", ["supabase/functions"]);
  } else if (deps.express || deps.fastify || deps.koa || deps.hono || deps.nestjs) {
    addFinding(stackFindings, "backend_node_server", "Backend shape", "Node server runtime", "likely", ["server dependency detected"]);
  } else {
    addFinding(stackFindings, "backend_unknown", "Backend shape", "Not verified", "not_verified", ["no backend directory or server dependency signal"]);
  }

  addFinding(scriptFindings, "package_manager", "Package manager", packageManager.name, packageManager.confidence, packageManager.evidence);
  if (scriptNames.length > 0) {
    for (const name of ["dev", "build", "start", "deploy"]) {
      if (scriptNames.includes(name)) {
        addFinding(scriptFindings, `script_${name}`, "Script", `${name}: ${String(scripts[name] || "").trim()}`, "confirmed", ["package.json scripts"]);
      }
    }
  }
  if (scriptFindings.length <= 1) {
    addFinding(scriptFindings, "scripts_missing", "Scripts", "Build/start scripts are not clearly defined", "likely", ["package.json scripts missing build/start"]);
  }

  if (envKeys.length > 0) {
    addFinding(
      operationalRequirements,
      "env_expected",
      "Likely requirement",
      `Environment variables expected (${envKeys.slice(0, 6).join(", ")}${envKeys.length > 6 ? ", …" : ""})`,
      "likely",
      [".env* files"],
    );
  } else {
    addFinding(
      operationalRequirements,
      "env_not_detected",
      "Likely requirement",
      "Environment requirements are not fully verified",
      "not_verified",
      ["no .env.example/.env key names detected"],
    );
  }

  if (!deploy) {
    addFinding(
      operationalRequirements,
      "deploy_target_unknown",
      "Likely requirement",
      "Deploy target may need confirmation",
      "likely",
      ["no deploy config found"],
    );
  }

  if (!scriptNames.includes("build")) {
    addFinding(
      operationalRequirements,
      "build_script_uncertain",
      "Likely requirement",
      "Build command may need confirmation",
      "likely",
      ["scripts.build missing"],
    );
  }

  addFinding(
    uncertainties,
    "runtime_not_verified",
    "Not verified yet",
    "Runtime readiness still needs execution checks",
    "not_verified",
    ["static inspection only"],
  );
  addFinding(
    uncertainties,
    "provider_access_not_verified",
    "Not verified yet",
    "Provider account access and permissions are not confirmed",
    "not_verified",
    ["requires CLI auth check"],
  );
  if (envKeys.length > 0) {
    addFinding(
      uncertainties,
      "env_values_not_verified",
      "Not verified yet",
      "Environment values are not verified from project files",
      "not_verified",
      ["env key names only"],
    );
  }

  return {
    framework,
    deploy,
    database,
    backend,
    inspectionFindings: {
      ...createEmptyInspectionFindings(),
      stack: stackFindings,
      scripts: scriptFindings,
      providerHints,
      serviceHints,
      operationalRequirements,
      uncertainties,
    },
  };
}

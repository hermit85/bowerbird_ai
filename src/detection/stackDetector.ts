import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type StackInfo = {
  framework: string | null;
  deploy: string | null;
  database: string | null;
  backend: string | null;
};

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

export function detectStack(projectRoot: string): StackInfo {
  const pkg = readPackageJson(projectRoot);
  const deps = collectDeps(pkg);

  let framework: string | null = null;
  if (deps.next) {
    framework = "next";
  } else if (deps.react) {
    framework = "react";
  } else if (deps.vite) {
    framework = "vite";
  }

  let deploy: string | null = null;
  if (existsSync(path.resolve(projectRoot, "vercel.json"))) {
    deploy = "vercel";
  } else if (existsSync(path.resolve(projectRoot, "netlify.toml"))) {
    deploy = "netlify";
  }

  const hasSupabase = existsSync(path.resolve(projectRoot, "supabase"));
  const database: string | null = hasSupabase ? "supabase" : null;

  const hasSupabaseFunctions = existsSync(path.resolve(projectRoot, "supabase", "functions"));
  const backend: string | null = hasSupabaseFunctions ? "supabase-functions" : null;

  return {
    framework,
    deploy,
    database,
    backend,
  };
}


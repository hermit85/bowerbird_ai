import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ProjectState = {
  project: {
    name: string;
    root: string;
  };
  git: {
    branch: string | null;
  };
  vercel: {
    connected: boolean;
    lastDeployUrl: string | null;
    lastDeployAt: string | null;
  };
  supabase: {
    connected: boolean;
    projectRef: string | null;
    functions: string[];
  };
  env: {
    knownKeys: string[];
  };
  activity: {
    lastAction: string | null;
    lastActionAt: string | null;
  };
};

export type ProjectStatePatch = Partial<{
  project: Partial<ProjectState["project"]>;
  git: Partial<ProjectState["git"]>;
  vercel: Partial<ProjectState["vercel"]>;
  supabase: Partial<ProjectState["supabase"]>;
  env: Partial<ProjectState["env"]>;
  activity: Partial<ProjectState["activity"]>;
}>;

function statePath(projectRoot: string): string {
  return path.resolve(projectRoot, ".bowerbird", "state.json");
}

function defaultState(projectRoot: string): ProjectState {
  return {
    project: {
      name: path.basename(projectRoot),
      root: projectRoot,
    },
    git: {
      branch: null,
    },
    vercel: {
      connected: false,
      lastDeployUrl: null,
      lastDeployAt: null,
    },
    supabase: {
      connected: false,
      projectRef: null,
      functions: [],
    },
    env: {
      knownKeys: [],
    },
    activity: {
      lastAction: null,
      lastActionAt: null,
    },
  };
}

function normalizeState(projectRoot: string, state: Partial<ProjectState>): ProjectState {
  const base = defaultState(projectRoot);
  return {
    project: {
      name: state.project?.name ?? base.project.name,
      root: state.project?.root ?? base.project.root,
    },
    git: {
      branch: state.git?.branch ?? base.git.branch,
    },
    vercel: {
      connected: state.vercel?.connected ?? base.vercel.connected,
      lastDeployUrl: state.vercel?.lastDeployUrl ?? base.vercel.lastDeployUrl,
      lastDeployAt: state.vercel?.lastDeployAt ?? base.vercel.lastDeployAt,
    },
    supabase: {
      connected: state.supabase?.connected ?? base.supabase.connected,
      projectRef: state.supabase?.projectRef ?? base.supabase.projectRef,
      functions: Array.isArray(state.supabase?.functions)
        ? [...new Set(state.supabase?.functions)]
        : base.supabase.functions,
    },
    env: {
      knownKeys: Array.isArray(state.env?.knownKeys)
        ? [...new Set(state.env?.knownKeys)]
        : base.env.knownKeys,
    },
    activity: {
      lastAction: state.activity?.lastAction ?? base.activity.lastAction,
      lastActionAt: state.activity?.lastActionAt ?? base.activity.lastActionAt,
    },
  };
}

export async function ensureState(projectRoot: string): Promise<ProjectState> {
  const filePath = statePath(projectRoot);
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ProjectState>;
    const normalized = normalizeState(projectRoot, parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await writeState(projectRoot, normalized);
    }
    return normalized;
  } catch {
    const state = defaultState(projectRoot);
    await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    return state;
  }
}

export async function readState(projectRoot: string): Promise<ProjectState> {
  return ensureState(projectRoot);
}

export async function writeState(projectRoot: string, state: ProjectState): Promise<void> {
  const filePath = statePath(projectRoot);
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const normalized = normalizeState(projectRoot, state);
  await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export async function patchState(projectRoot: string, partial: ProjectStatePatch): Promise<ProjectState> {
  const current = await ensureState(projectRoot);
  const next: ProjectState = {
    project: { ...current.project, ...(partial.project ?? {}) },
    git: { ...current.git, ...(partial.git ?? {}) },
    vercel: { ...current.vercel, ...(partial.vercel ?? {}) },
    supabase: {
      ...current.supabase,
      ...(partial.supabase ?? {}),
      functions: partial.supabase?.functions
        ? [...new Set(partial.supabase.functions)]
        : current.supabase.functions,
    },
    env: {
      ...current.env,
      ...(partial.env ?? {}),
      knownKeys: partial.env?.knownKeys
        ? [...new Set(partial.env.knownKeys)]
        : current.env.knownKeys,
    },
    activity: { ...current.activity, ...(partial.activity ?? {}) },
  };
  await writeState(projectRoot, next);
  return next;
}


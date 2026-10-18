import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import { BridgeError } from "./errors.js";
import { readSession as defaultReadSession, type SessionInfo } from "./session.js";

/**
 * Several projects behind one server registration (#12): `--projects-root <dir>` (repeatable) allows
 * `project_connect` to point the running server at any Godot project below those folders.
 */

export interface ServerArgs {
  project: string;
  projectsRoots: string[];
  /** Godot executable for editor_launch (--godot). */
  godot?: string;
  version: boolean;
  help: boolean;
}

/** `~` and `~/x` → the home folder. */
export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith(`~${sep}`)) return join(homedir(), p.slice(2));
  return p;
}

export function parseServerArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): ServerArgs {
  let project = env.GODOT_PROJECT_PATH ?? cwd;
  const roots: string[] = [];
  let godot: string | undefined;
  let version = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--project" && argv[i + 1] !== undefined) project = argv[++i] as string;
    else if (a.startsWith("--project=")) project = a.slice("--project=".length);
    else if (a === "--projects-root" && argv[i + 1] !== undefined) roots.push(argv[++i] as string);
    else if (a.startsWith("--projects-root=")) roots.push(a.slice("--projects-root=".length));
    else if (a === "--godot" && argv[i + 1] !== undefined) godot = argv[++i] as string;
    else if (a.startsWith("--godot=")) godot = a.slice("--godot=".length);
    else if (a === "--version") version = true;
    else if (a === "--help" || a === "-h") help = true;
  }
  if (roots.length === 0 && env.GODOT_PROJECTS_ROOT) roots.push(...env.GODOT_PROJECTS_ROOT.split(delimiter).filter((r) => r !== ""));
  return {
    project: resolve(cwd, expandHome(project)),
    projectsRoots: roots.map((r) => resolve(cwd, expandHome(r))),
    ...(godot !== undefined ? { godot: resolve(cwd, expandHome(godot)) } : {}),
    version,
    help,
  };
}

/** Real paths of the roots that exist, in order. */
function realRoots(roots: string[]): string[] {
  const out: string[] = [];
  for (const r of roots) {
    try {
      if (statSync(r).isDirectory()) out.push(realpathSync(r));
    } catch {
      /* a missing root allows nothing */
    }
  }
  return out;
}

const inside = (root: string, p: string): boolean => {
  const r = relative(root, p);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};

const PROTECTED = new Set([".godot", ".git"]);

/**
 * The real path of the project folder `path` names: absolute (or ~/…), or relative to a projects root (tried in
 * order). It must resolve — symbolic links included — inside a root, not under .godot/ or .git/, and contain
 * project.godot.
 */
export function resolveProjectTarget(roots: string[], path: string): string {
  if (roots.length === 0) {
    throw new BridgeError(
      "PROJECT_SWITCH_DISABLED",
      "This server is bound to one project.",
      "Start the server with --projects-root <folder> (repeatable) to allow switching to the Godot projects below it.",
    );
  }
  if (typeof path !== "string" || path.trim() === "") throw new BridgeError("INVALID_PARAMS", "Give the project folder in 'path'.");
  const allowed = realRoots(roots);
  const given = expandHome(path.trim());
  const candidates = isAbsolute(given) ? [given] : allowed.map((r) => resolve(r, given));
  if (candidates.length === 0) {
    throw new BridgeError("PROJECT_NOT_FOUND", `None of the projects roots exists (${roots.join(", ")}).`, "Check --projects-root.");
  }
  const rootsText = allowed.join(", ");
  let notProject: string | undefined;
  for (const c of candidates) {
    // Lexical check first, so a missing folder outside the roots is reported as forbidden, not as missing.
    if (!allowed.some((r) => inside(r, resolve(c)))) {
      throw new BridgeError("PATH_FORBIDDEN", `${path} is outside the projects roots (${rootsText}).`, "Use a project below one of the roots (project_list shows them).");
    }
    if (!existsSync(c)) continue;
    const real = realpathSync(c);
    const root = allowed.find((r) => inside(r, real));
    if (root === undefined) {
      throw new BridgeError("PATH_FORBIDDEN", `${path} resolves outside the projects roots (symbolic link).`, "Use a project below one of the roots (project_list shows them).");
    }
    if (relative(root, real).split(sep).some((part) => PROTECTED.has(part))) {
      throw new BridgeError("PATH_FORBIDDEN", `${path} is inside a .godot/ or .git/ folder.`);
    }
    if (!statSync(real).isDirectory() || !existsSync(join(real, "project.godot"))) {
      notProject = real;
      continue;
    }
    return real;
  }
  if (notProject !== undefined) {
    throw new BridgeError("NOT_A_PROJECT", `${notProject} is not a Godot project (no project.godot).`, "Give the folder that contains project.godot (project_list shows them).");
  }
  throw new BridgeError("PROJECT_NOT_FOUND", `Project folder not found: ${path}.`, "project_list shows the projects below the roots.");
}

/** config/name from project.godot, if readable. */
export function readProjectName(dir: string): string | undefined {
  try {
    const m = /^config\/name="((?:[^"\\]|\\.)*)"/m.exec(readFileSync(join(dir, "project.godot"), "utf8"));
    return m?.[1]?.replace(/\\(.)/g, "$1");
  } catch {
    return undefined;
  }
}

export const addonInstalled = (dir: string): boolean => existsSync(join(dir, "addons", "mcp_loop", "plugin.cfg"));

export function editorRunning(dir: string, read: (dir: string) => SessionInfo = defaultReadSession): boolean {
  try {
    read(dir);
    return true;
  } catch {
    return false;
  }
}

export interface ProjectEntry {
  path: string;
  name: string | undefined;
  current: boolean;
  addon_installed: boolean;
  editor_running: boolean;
}

const SKIP = new Set(["node_modules", "addons"]);

/**
 * Godot projects below the roots (the roots themselves included), at most maxDepth folders down, sorted by path.
 * Hidden folders, node_modules, addons, symbolic links and folders inside a project are not searched.
 */
export function listProjects(
  roots: string[],
  opts: { current?: string; maxDepth?: number; limit?: number; readSession?: (dir: string) => SessionInfo } = {},
): { projects: ProjectEntry[]; truncated: boolean } {
  const maxDepth = opts.maxDepth ?? 3;
  const limit = opts.limit ?? 200;
  const found = new Set<string>();
  let truncated = false;
  const walk = (dir: string, depth: number): void => {
    if (truncated) return;
    if (existsSync(join(dir, "project.godot"))) {
      if (found.size >= limit) {
        truncated = true;
        return;
      }
      found.add(dir);
      return;
    }
    if (depth >= maxDepth) return;
    let names: string[];
    try {
      names = readdirSync(dir).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    } catch {
      return;
    }
    for (const n of names) {
      if (n.startsWith(".") || SKIP.has(n)) continue;
      const p = join(dir, n);
      try {
        if (!lstatSync(p).isDirectory()) continue; // symbolic links are not followed
      } catch {
        continue;
      }
      walk(p, depth + 1);
    }
  };
  for (const r of realRoots(roots)) walk(r, 0);
  const projects = [...found]
    .sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))
    .map((path) => ({
      path,
      name: readProjectName(path),
      current: path === opts.current,
      addon_installed: addonInstalled(path),
      editor_running: editorRunning(path, opts.readSession),
    }));
  return { projects, truncated };
}

import { execFile, spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { GodotConnection } from "./connection.js";
import { BridgeError } from "./errors.js";

/**
 * Opening and closing the Godot editor for the current project (editor_launch / editor_quit). The executable comes
 * from the server's configuration (--godot, $GODOT_BIN) or the usual install locations — never from the agent — and
 * is started with a fixed argument list and no shell.
 */

export const MIN_GODOT = { major: 4, minor: 5 };

export interface GodotVersion {
  major: number;
  minor: number;
  patch: number;
  text: string;
}

export function parseGodotVersion(output: string): GodotVersion | undefined {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?\.[a-z]+[\w.-]*/i.exec(output);
  if (!m) return undefined;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] ?? 0), text: m[0] };
}

export interface GodotCandidate {
  path: string;
  source: "--godot" | "GODOT_BIN" | "PATH" | "default";
}

export interface FindOptions {
  /** --godot from the server's command line. */
  flag?: string;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  home?: string;
  /** macOS application folders to look in (default /Applications and ~/Applications). */
  appDirs?: string[];
}

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Where to look for Godot, in order. A configured executable (--godot, else $GODOT_BIN) is the only candidate. */
export function godotCandidates(opts: FindOptions = {}): GodotCandidate[] {
  const env = opts.env ?? process.env;
  if (opts.flag) return [{ path: opts.flag, source: "--godot" }];
  if (env.GODOT_BIN) return [{ path: env.GODOT_BIN, source: "GODOT_BIN" }];
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? homedir();
  const out: GodotCandidate[] = [];
  const seen = new Set<string>();
  const add = (path: string, source: GodotCandidate["source"]) => {
    if (!isFile(path)) return;
    // Same file under another name (case-insensitive file systems, symbolic links such as Homebrew's): once.
    let key = path;
    try {
      key = realpathSync.native(path);
    } catch {
      /* keep the path */
    }
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ path, source });
  };
  const names = platform === "win32" ? ["godot.exe", "godot4.exe", "Godot.exe"] : ["godot", "godot4", "Godot"];
  for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter).filter((d) => d !== "")) {
    for (const n of names) add(join(dir, n), "PATH");
  }
  if (platform === "darwin") {
    for (const dir of opts.appDirs ?? ["/Applications", join(home, "Applications")]) {
      for (const app of ["Godot.app", "Godot_mono.app"]) add(join(dir, app, "Contents", "MacOS", "Godot"), "default");
    }
  } else if (platform === "linux") {
    for (const p of ["/usr/local/bin/godot", "/usr/bin/godot", join(home, ".local", "bin", "godot"), "/var/lib/flatpak/exports/bin/org.godotengine.Godot"]) {
      add(p, "default");
    }
  }
  return out;
}

const runVersionDefault = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(path, ["--headless", "--version"], { timeout: 20_000, windowsHide: true }, (err, stdout) => {
      if (err && !stdout) reject(err);
      else resolve(String(stdout));
    });
  });

export interface FoundGodot {
  path: string;
  version: string;
  source: GodotCandidate["source"];
}

/** The first candidate that runs and reports Godot 4.5 or newer. */
export async function findGodot(opts: FindOptions & { runVersion?: (path: string) => Promise<string> } = {}): Promise<FoundGodot> {
  const run = opts.runVersion ?? runVersionDefault;
  const tried: string[] = [];
  for (const c of godotCandidates(opts)) {
    if (!isFile(c.path)) {
      tried.push(`${c.path} (not found; from ${c.source})`);
      continue;
    }
    let out: string;
    try {
      out = await run(c.path);
    } catch (e) {
      tried.push(`${c.path} (does not run: ${e instanceof Error ? e.message.split("\n")[0] : String(e)})`);
      continue;
    }
    const v = parseGodotVersion(out);
    if (!v) {
      tried.push(`${c.path} (not Godot: "${out.trim().slice(0, 60)}")`);
      continue;
    }
    if (v.major < MIN_GODOT.major || (v.major === MIN_GODOT.major && v.minor < MIN_GODOT.minor)) {
      tried.push(`${c.path} (Godot ${v.text}; ${MIN_GODOT.major}.${MIN_GODOT.minor} or newer is needed)`);
      continue;
    }
    return { path: c.path, version: v.text, source: c.source };
  }
  throw new BridgeError(
    "GODOT_NOT_FOUND",
    tried.length > 0 ? `No usable Godot editor executable. Tried: ${tried.join("; ")}.` : "No Godot editor executable found on PATH or in the usual places.",
    "Ask the user to install Godot 4.5+ or to start the MCP server with --godot /path/to/godot (or set GODOT_BIN).",
  );
}

/** The bits of a child process the launcher uses (a fake in tests). */
export interface EditorProcess {
  pid?: number | undefined;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
  unref(): void;
}

export type SpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => EditorProcess;

interface Launched {
  proc: EditorProcess;
  exited: boolean;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  godot: FoundGodot;
}

export interface LauncherOptions {
  /** --godot from the command line. */
  godot?: string;
  find?: () => Promise<FoundGodot>;
  spawn?: SpawnFn;
  pollMs?: number;
}

const PLUGIN_ENTRY = '"res://addons/mcp_loop/plugin.cfg"';
const shq = (s: string): string => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function realOr(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

export function logPath(project: string): string {
  return join(project, ".godot", "mcp_loop", "editor.log");
}

function logTail(project: string, lines = 15): string {
  try {
    const text = readFileSync(logPath(project), "utf8").trimEnd();
    return text.split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

/** The checks editor_launch makes before starting anything. */
export function checkProject(project: string): void {
  if (!existsSync(join(project, "project.godot"))) {
    throw new BridgeError("NOT_A_PROJECT", `${project} is not a Godot project (no project.godot).`, "Use project_connect to pick a project first.");
  }
  const install = `Ask the user to run \`npx godot-mcp-loop install-addon ${shq(project)}\` (it copies the addon and enables it).`;
  if (!existsSync(join(project, "addons", "mcp_loop", "plugin.cfg"))) {
    throw new BridgeError("ADDON_NOT_INSTALLED", `The MCP Loop addon is not installed in ${project}.`, install);
  }
  const text = readFileSync(join(project, "project.godot"), "utf8");
  const section = /^\[editor_plugins\][ \t]*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text)?.[1] ?? "";
  if (!/^enabled=PackedStringArray\(.*\)/m.test(section) || !section.includes(PLUGIN_ENTRY)) {
    throw new BridgeError("ADDON_NOT_ENABLED", `The MCP Loop plugin is not enabled in ${project}/project.godot.`, install);
  }
}

export class EditorLauncher {
  private readonly findFn: () => Promise<FoundGodot>;
  private readonly spawnFn: SpawnFn;
  private readonly pollMs: number;
  /** Editors started by this server process, by real project path. */
  private readonly launched = new Map<string, Launched>();

  constructor(opts: LauncherOptions = {}) {
    this.findFn = opts.find ?? (() => findGodot(opts.godot !== undefined ? { flag: opts.godot } : {}));
    this.spawnFn = opts.spawn ?? ((cmd, args, o) => nodeSpawn(cmd, args, o));
    this.pollMs = opts.pollMs ?? 250;
  }

  private alive(project: string): Launched | undefined {
    const l = this.launched.get(realOr(project));
    return l && !l.exited ? l : undefined;
  }

  /** Starts the editor; resolves once its bridge answers. Assumes no editor is running for the project. */
  async launch(
    conn: GodotConnection,
    opts: { headless?: boolean; timeoutMs: number; onWait?: () => void },
  ): Promise<{ pid: number | undefined; godot: FoundGodot; log: string }> {
    const project = conn.projectPath;
    checkProject(project);
    const godot = await this.findFn();
    const log = logPath(project);
    mkdirSync(join(project, ".godot", "mcp_loop"), { recursive: true, mode: 0o700 });
    const fd = openSync(log, "w", 0o600);
    let proc: EditorProcess;
    try {
      const args = [...(opts.headless ? ["--headless"] : []), "-e", "--path", project];
      // Detached with its output in a file: the editor must outlive this server and never block on a closed pipe.
      proc = this.spawnFn(godot.path, args, { cwd: project, detached: true, shell: false, stdio: ["ignore", fd, fd], windowsHide: false });
    } finally {
      closeSync(fd);
    }
    const entry: Launched = {
      proc,
      exited: false,
      godot,
      exit: new Promise((resolve) => {
        proc.once("exit", (code, signal) => {
          entry.exited = true;
          resolve({ code, signal });
        });
      }),
    };
    this.launched.set(realOr(project), entry);
    proc.unref();

    const deadline = Date.now() + opts.timeoutMs;
    for (;;) {
      if (entry.exited) {
        const { code, signal } = await entry.exit;
        const tail = logTail(project);
        throw new BridgeError(
          "EDITOR_EXITED",
          `The Godot editor exited (${signal ? `signal ${signal}` : `exit code ${code}`}) before its MCP Loop bridge started.` +
            (tail ? `\nLast lines of ${log}:\n${tail}` : ""),
          "Read the log lines above; a project made with another Godot version or a broken addon script are common causes.",
        );
      }
      try {
        conn.readSessionOf(project);
        await conn.call("ping", {}, { timeoutMs: 5000 });
        return { pid: proc.pid, godot, log };
      } catch {
        /* not up yet */
      }
      if (Date.now() >= deadline) {
        throw new BridgeError(
          "TIMEOUT",
          `The Godot editor (pid ${proc.pid}) did not start its MCP Loop bridge within ${opts.timeoutMs} ms. It is still running; its output goes to ${log}.`,
          "The first start of a project imports every asset and can take long: call godot_status again in a while.",
        );
      }
      opts.onWait?.();
      await sleep(this.pollMs);
    }
  }

  /** Closes an editor this server launched for the current project. */
  async quit(conn: GodotConnection, opts: { save: boolean; timeoutMs: number }): Promise<Record<string, unknown>> {
    const project = conn.projectPath;
    const entry = this.alive(project);
    let sessionPid: number | undefined;
    try {
      sessionPid = conn.readSessionOf(project).pid;
    } catch {
      sessionPid = undefined;
    }
    if (!entry || (sessionPid !== undefined && entry.proc.pid !== undefined && sessionPid !== entry.proc.pid)) {
      if (sessionPid === undefined && !entry) {
        throw new BridgeError("GODOT_NOT_RUNNING", `No Godot editor is running for ${project}.`);
      }
      throw new BridgeError(
        "EDITOR_NOT_LAUNCHED",
        "This server did not open the running editor, so it will not close it (it may hold someone's unsaved work).",
        "Ask the user to close it.",
      );
    }
    let saved: unknown = false;
    let bridgeError: string | undefined;
    try {
      const r = (await conn.call("editor.quit", { save: opts.save }, { timeoutMs: 15_000 })) as { saved?: unknown };
      saved = r?.saved ?? false;
    } catch (e) {
      bridgeError = e instanceof BridgeError ? `${e.code}: ${e.message}` : String(e);
    }
    const timeout = sleep(opts.timeoutMs).then(() => "timeout" as const);
    let killed = false;
    if (bridgeError !== undefined || (await Promise.race([entry.exit, timeout])) === "timeout") {
      entry.proc.kill("SIGTERM");
      killed = true;
      const late = await Promise.race([entry.exit, sleep(5000).then(() => "timeout" as const)]);
      if (late === "timeout") entry.proc.kill("SIGKILL");
    }
    conn.close();
    this.launched.delete(realOr(project));
    return {
      quit: true,
      project_path: project,
      saved,
      ...(killed ? { killed: true } : {}),
      ...(bridgeError ? { bridge_error: bridgeError } : {}),
    };
  }
}

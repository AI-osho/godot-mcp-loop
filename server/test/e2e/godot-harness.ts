import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GodotConnection } from "../../src/connection.js";
import { readSession, sessionFilePath } from "../../src/session.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const GODOT_BIN = process.env.GODOT_BIN ?? "godot";

/** Set E2E_GAME_WINDOW=1 to run games with a real window (enables screenshot checks). */
export const WINDOWED = process.env.E2E_GAME_WINDOW === "1";

/**
 * project.godot text that runs the games in a window, with E2E_GAME_ARGS as their extra arguments (CI under xvfb:
 * "--rendering-driver opengl3"). Empty when there are no extra arguments.
 */
export function windowedGameSettings(): string {
  const args = process.env.E2E_GAME_ARGS?.trim();
  return args ? `[editor]\n\nrun/main_run_args="${args.replace(/["\\]/g, "")}"\n` : "";
}

/** The examples/ folder as a project with the platformer as main scene and its input actions. */
export const PLATFORMER_PROJECT: HarnessOptions = {
  copyDirs: ["examples"],
  applicationExtra: ['run/main_scene="res://examples/platformer/main.tscn"'],
  projectGodotExtra: [
    "[input]",
    "",
    'move_left={\n"deadzone": 0.2,\n"events": []\n}',
    'move_right={\n"deadzone": 0.2,\n"events": []\n}',
    'jump={\n"deadzone": 0.2,\n"events": []\n}',
    "",
    ...(WINDOWED ? [] : ["[editor]", "", 'run/main_run_args="--headless"', ""]),
  ].join("\n"),
};

export interface GodotHarness {
  projectPath: string;
  conn: GodotConnection;
  output: string[];
  stop(): Promise<void>;
}

/**
 * Creates a throwaway Godot project containing the addon (plus optional extra
 * files), launches a headless editor on it and waits until the bridge is up.
 */
export interface HarnessOptions {
  /** Files to create, relative to the project root. */
  extraFiles?: Record<string, string>;
  /** Repo-relative directories to copy into the project (e.g. "examples/platformer"). */
  copyDirs?: string[];
  /** Directories from anywhere, copied to a project-relative path (e.g. a downloaded test framework). */
  copyFrom?: Array<{ from: string; to: string }>;
  /** Extra text appended to project.godot (e.g. an [input] section). */
  projectGodotExtra?: string;
  /** Extra [application] lines, e.g. 'run/main_scene="res://main.tscn"'. */
  applicationExtra?: string[];
  /** Use the repository's own project.godot (sample input actions, main scene) instead of a generated one. */
  repoProjectGodot?: boolean;
}

/** Creates a throwaway Godot project containing the addon (plus optional extra files); returns its folder. */
export function createTestProject(opts: HarnessOptions = {}): string {
  const projectPath = mkdtempSync(join(tmpdir(), "gml-e2e-"));
  cpSync(join(REPO_ROOT, "addons"), join(projectPath, "addons"), { recursive: true });
  for (const d of opts.copyDirs ?? []) {
    cpSync(join(REPO_ROOT, d), join(projectPath, d), { recursive: true });
  }
  for (const c of opts.copyFrom ?? []) {
    cpSync(c.from, join(projectPath, c.to), { recursive: true });
  }
  const repoGodot = opts.repoProjectGodot ? readFileSync(join(REPO_ROOT, "project.godot"), "utf8") : undefined;
  writeFileSync(
    join(projectPath, "project.godot"),
    repoGodot !== undefined ? `${repoGodot}\n${opts.projectGodotExtra ?? ""}` : [
      "config_version=5",
      "",
      "[application]",
      "",
      'config/name="e2e"',
      ...(opts.applicationExtra ?? []),
      "",
      "[editor_plugins]",
      "",
      'enabled=PackedStringArray("res://addons/mcp_loop/plugin.cfg")',
      "",
      opts.projectGodotExtra ?? "",
    ].join("\n"),
  );
  for (const [rel, content] of Object.entries(opts.extraFiles ?? {})) {
    mkdirSync(dirname(join(projectPath, rel)), { recursive: true });
    writeFileSync(join(projectPath, rel), content);
  }
  return projectPath;
}

export async function startHeadlessEditor(opts: HarnessOptions = {}): Promise<GodotHarness> {
  const projectPath = createTestProject(opts);
  const output: string[] = [];
  const port = 17510 + Math.floor(Math.random() * 400) * 10;
  const proc: ChildProcess = spawn(GODOT_BIN, ["--headless", "-e", "--path", projectPath], {
    env: { ...process.env, MCP_LOOP_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Games launched by the editor run in their own session and survive the editor,
  // so find them by the "--editor-pid <pid>" argument Godot passes them.
  const killAll = (signal: NodeJS.Signals) => {
    if (!proc.pid) return;
    spawnSync("pkill", [`-${signal.replace("SIG", "")}`, "-f", "--", `--editor-pid ${proc.pid}( |$)`]);
    if (proc.exitCode === null) proc.kill(signal);
  };
  proc.stdout?.on("data", (b: Buffer) => output.push(...b.toString().split("\n")));
  proc.stderr?.on("data", (b: Buffer) => output.push(...b.toString().split("\n")));

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) break;
    if (existsSync(sessionFilePath(projectPath))) {
      try {
        readSession(projectPath);
        break;
      } catch {
        /* not ready yet */
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!existsSync(sessionFilePath(projectPath))) {
    killAll("SIGKILL");
    throw new Error(`Godot editor did not start the bridge.\n${output.slice(-40).join("\n")}`);
  }

  const conn = new GodotConnection({ projectPath });
  return {
    projectPath,
    conn,
    output,
    async stop() {
      conn.close();
      if (process.env.E2E_DUMP_GODOT_LOG) {
        process.stderr.write(`\n===== Godot output (${projectPath}) =====\n${output.join("\n")}\n===== end =====\n`);
      }
      if (proc.exitCode === null) {
        const exited = new Promise((r) => proc.once("exit", r));
        killAll("SIGTERM");
        await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
      }
      killAll("SIGKILL");
      proc.stdout?.destroy();
      proc.stderr?.destroy();
      rmSync(projectPath, { recursive: true, force: true });
    },
  };
}

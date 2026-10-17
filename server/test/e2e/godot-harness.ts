import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GodotConnection } from "../../src/connection.js";
import { readSession, sessionFilePath } from "../../src/session.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const GODOT_BIN = process.env.GODOT_BIN ?? "godot";

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
export async function startHeadlessEditor(opts: { extraFiles?: Record<string, string>; copyDirs?: string[] } = {}): Promise<GodotHarness> {
  const projectPath = mkdtempSync(join(tmpdir(), "gml-e2e-"));
  cpSync(join(REPO_ROOT, "addons"), join(projectPath, "addons"), { recursive: true });
  for (const d of opts.copyDirs ?? []) {
    cpSync(join(REPO_ROOT, d), join(projectPath, d), { recursive: true });
  }
  writeFileSync(
    join(projectPath, "project.godot"),
    [
      "config_version=5",
      "",
      "[application]",
      "",
      'config/name="e2e"',
      "",
      "[editor_plugins]",
      "",
      'enabled=PackedStringArray("res://addons/mcp_loop/plugin.cfg")',
      "",
    ].join("\n"),
  );
  for (const [rel, content] of Object.entries(opts.extraFiles ?? {})) {
    writeFileSync(join(projectPath, rel), content);
  }

  const output: string[] = [];
  const port = 17510 + Math.floor(Math.random() * 400) * 10;
  const proc: ChildProcess = spawn(GODOT_BIN, ["--headless", "-e", "--path", projectPath], {
    env: { ...process.env, MCP_LOOP_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
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
    proc.kill("SIGKILL");
    throw new Error(`Godot editor did not start the bridge.\n${output.slice(-40).join("\n")}`);
  }

  const conn = new GodotConnection({ projectPath });
  return {
    projectPath,
    conn,
    output,
    async stop() {
      conn.close();
      if (proc.exitCode === null) {
        const exited = new Promise((r) => proc.once("exit", r));
        proc.kill("SIGTERM");
        await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
        if (proc.exitCode === null) proc.kill("SIGKILL");
      }
      rmSync(projectPath, { recursive: true, force: true });
    },
  };
}

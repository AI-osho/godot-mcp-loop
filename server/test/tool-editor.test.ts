import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { EventEmitter } from "node:events";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GodotConnection } from "../src/connection.js";
import { EditorLauncher, type EditorProcess } from "../src/editor-launcher.js";
import { BridgeError } from "../src/errors.js";
import { FakeAddon } from "./fake-addon.js";
import { connectClient, jsonOf, textOf } from "./helpers.js";

class FakeProc extends EventEmitter implements EditorProcess {
  pid: number | undefined = 4242;
  signals: string[] = [];
  unref(): void {}
  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.signals.push(signal);
    setTimeout(() => this.emit("exit", null, signal), 10);
    return true;
  }
}

const ENABLED = '[editor_plugins]\n\nenabled=PackedStringArray("res://addons/mcp_loop/plugin.cfg")\n';

describe("editor_launch / editor_quit", () => {
  let project: string;
  let addon: FakeAddon;
  let port: number;
  /** pid of the editor whose session file is "on disk"; undefined = no editor running. */
  let sessionPid: number | undefined;
  let spawned: Array<{ cmd: string; args: string[]; opts: Record<string, unknown>; proc: FakeProc }>;
  /** What the fake Godot does after being spawned. */
  let onSpawn: (proc: FakeProc) => void;
  let conn: GodotConnection;
  let client: Client;

  const logFile = () => join(project, ".godot", "mcp_loop", "editor.log");

  async function start(): Promise<void> {
    conn = new GodotConnection({
      projectPath: project,
      readSession: () => {
        if (sessionPid === undefined) throw new BridgeError("GODOT_NOT_RUNNING", "No running Godot editor found.", "Open it.");
        return { port, token: addon.token, protocol: 1, pid: sessionPid };
      },
    });
    const launcher = new EditorLauncher({
      find: async () => ({ path: "/fake/godot", version: "4.7.2.stable.official", source: "PATH" }),
      spawn: (cmd, args, opts) => {
        const proc = new FakeProc();
        spawned.push({ cmd, args, opts: opts as Record<string, unknown>, proc });
        onSpawn(proc);
        return proc;
      },
      pollMs: 20,
    });
    client = await connectClient(conn, { launcher });
  }

  beforeEach(async () => {
    project = realpathSync(mkdtempSync(join(tmpdir(), "gml-launch-")));
    mkdirSync(join(project, "addons", "mcp_loop"), { recursive: true });
    writeFileSync(join(project, "addons", "mcp_loop", "plugin.cfg"), '[plugin]\nversion="0.0.0"\n');
    writeFileSync(join(project, "project.godot"), `config_version=5\n\n[application]\n\nconfig/name="Demo"\n\n${ENABLED}`);
    addon = new FakeAddon();
    port = await addon.start();
    addon.handlers.set("editor.status", () => ({ ok: true, result: { project_name: "Demo", playing: false } }));
    sessionPid = undefined;
    spawned = [];
    onSpawn = (proc) => setTimeout(() => (sessionPid = proc.pid), 60); // the editor comes up after a moment
  });

  afterEach(async () => {
    await client?.close();
    conn?.close();
    await addon.stop();
    rmSync(project, { recursive: true, force: true });
  });

  it("are listed with descriptions", async () => {
    await start();
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "editor_launch")?.description).toMatch(/Godot editor/);
    expect(tools.find((t) => t.name === "editor_quit")?.description).toMatch(/editor_launch/);
  });

  it("opens the editor on the current project (no shell, detached, output to a log) and waits for its bridge", async () => {
    await start();
    const res = await client.callTool({ name: "editor_launch", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(jsonOf(res)).toMatchObject({
      launched: true,
      pid: 4242,
      godot_path: "/fake/godot",
      godot_version: "4.7.2-fake",
      connected: true,
      project_name: "Demo",
      project_path: project,
    });
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.cmd).toBe("/fake/godot");
    expect(spawned[0]!.args).toEqual(["-e", "--path", project]);
    expect(spawned[0]!.opts).toMatchObject({ detached: true, shell: false, cwd: project });
    expect((spawned[0]!.opts.stdio as unknown[])[0]).toBe("ignore");
    expect(existsSync(logFile())).toBe(true);
  });

  it("headless: true adds --headless", async () => {
    await start();
    await client.callTool({ name: "editor_launch", arguments: { headless: true } });
    expect(spawned[0]!.args).toEqual(["--headless", "-e", "--path", project]);
  });

  it("does not start a second editor when one is running for the project", async () => {
    sessionPid = 999;
    await start();
    const res = await client.callTool({ name: "editor_launch", arguments: {} });
    expect(jsonOf(res)).toMatchObject({ launched: false, already_running: true, connected: true, project_name: "Demo" });
    expect(spawned).toHaveLength(0);
  });

  it("refuses a project without the addon, or with the plugin disabled, before starting anything", async () => {
    writeFileSync(join(project, "project.godot"), 'config_version=5\n\n[application]\n\nconfig/name="Demo"\n');
    await start();
    let res = await client.callTool({ name: "editor_launch", arguments: {} });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/ADDON_NOT_ENABLED[\s\S]*install-addon/);
    rmSync(join(project, "addons"), { recursive: true });
    res = await client.callTool({ name: "editor_launch", arguments: {} });
    expect(textOf(res)).toMatch(/ADDON_NOT_INSTALLED[\s\S]*install-addon/);
    rmSync(join(project, "project.godot"));
    res = await client.callTool({ name: "editor_launch", arguments: {} });
    expect(textOf(res)).toMatch(/NOT_A_PROJECT/);
    expect(spawned).toHaveLength(0);
  });

  it("reports an editor that exits before its bridge is up, with the end of its log", async () => {
    onSpawn = (proc) => {
      appendFileSync(logFile(), "Godot Engine v4.7.2\nERROR: Can't open project: boom\n");
      setTimeout(() => proc.emit("exit", 1, null), 30);
    };
    await start();
    const res = await client.callTool({ name: "editor_launch", arguments: {} });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/EDITOR_EXITED[\s\S]*exit code 1[\s\S]*Can't open project: boom/);
  });

  it("times out without killing an editor that is still starting", async () => {
    onSpawn = () => {};
    await start();
    const res = await client.callTool({ name: "editor_launch", arguments: { timeout_ms: 1000 } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/TIMEOUT[\s\S]*Hint:.*godot_status/);
    expect(spawned[0]!.proc.signals).toEqual([]);
  });

  it("passes GODOT_NOT_FOUND through", async () => {
    await start();
    // A launcher whose search fails:
    await client.close();
    const launcher = new EditorLauncher({
      find: async () => {
        throw new BridgeError("GODOT_NOT_FOUND", "No Godot found.", "Pass --godot.");
      },
    });
    client = await connectClient(conn, { launcher });
    const res = await client.callTool({ name: "editor_launch", arguments: {} });
    expect(textOf(res)).toMatch(/GODOT_NOT_FOUND[\s\S]*--godot/);
  });

  it("editor_quit closes an editor it launched: saves, quits through the bridge and waits for the process", async () => {
    await start();
    await client.callTool({ name: "editor_launch", arguments: {} });
    const proc = spawned[0]!.proc;
    addon.handlers.set("editor.quit", (p) => {
      setTimeout(() => {
        sessionPid = undefined;
        proc.emit("exit", 0, null);
      }, 30);
      return { ok: true, result: { quitting: true, saved: p.save !== false } };
    });
    const res = await client.callTool({ name: "editor_quit", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(jsonOf(res)).toMatchObject({ quit: true, saved: true, project_path: project });
    expect(addon.received.find((r) => r.method === "editor.quit")?.params).toEqual({ save: true });
    expect(proc.signals).toEqual([]);
  });

  it("editor_quit stops the process when the editor does not exit in time", async () => {
    await start();
    await client.callTool({ name: "editor_launch", arguments: {} });
    addon.handlers.set("editor.quit", () => ({ ok: true, result: { quitting: true, saved: false } }));
    const res = await client.callTool({ name: "editor_quit", arguments: { save: false, timeout_ms: 1000 } });
    expect(jsonOf(res)).toMatchObject({ quit: true, killed: true });
    expect(spawned[0]!.proc.signals).toEqual(["SIGTERM"]);
  });

  it("editor_quit refuses an editor this server did not launch", async () => {
    sessionPid = 999;
    await start();
    const res = await client.callTool({ name: "editor_quit", arguments: {} });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/EDITOR_NOT_LAUNCHED[\s\S]*Hint:.*user/);
    expect(addon.received.some((r) => r.method === "editor.quit")).toBe(false);
  });
});

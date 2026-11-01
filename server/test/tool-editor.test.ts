import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { EventEmitter } from "node:events";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GodotConnection } from "../src/connection.js";
import { EditorLauncher, type EditorProcess, type FoundGodot } from "../src/editor-launcher.js";
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

  async function start(find?: () => Promise<FoundGodot>): Promise<void> {
    conn = new GodotConnection({
      projectPath: project,
      readSession: () => {
        if (sessionPid === undefined) throw new BridgeError("GODOT_NOT_RUNNING", "No running Godot editor found.", "Open it.");
        return { port, token: addon.token, protocol: 1, pid: sessionPid };
      },
    });
    const launcher = new EditorLauncher({
      find: find ?? (async () => ({ path: "/fake/godot", version: "4.7.2.stable.official", source: "PATH" })),
      spawn: (cmd, args, opts) => {
        const proc = new FakeProc();
        proc.pid = 4242 + spawned.length;
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

  it("accepts a valid whitespace-formatted plugin assignment when launching", async () => {
    writeFileSync(join(project, "project.godot"), `config_version=5\n\n${ENABLED.replace("enabled=", "  enabled = ")}`);
    await start();
    const res = await client.callTool({ name: "editor_launch", arguments: {} });
    expect(res.isError, textOf(res)).toBeFalsy();
    expect(jsonOf(res).launched).toBe(true);
  });

  it("does not kill an editor that explicitly refuses a save; ownership remains available for retry", async () => {
    await start();
    await client.callTool({ name: "editor_launch", arguments: {} });
    const proc = spawned[0]!.proc;
    addon.handlers.set("editor.quit", () => ({ ok: false, error: { code: "PATH_FORBIDDEN", message: "Unsafe native save destination." } }));
    const refused = await client.callTool({ name: "editor_quit", arguments: { timeout_ms: 1000 } });
    expect(proc.signals, "a save refusal is not permission to discard work by force-killing the editor").toEqual([]);
    expect(refused.isError, textOf(refused)).toBe(true);
    expect(textOf(refused)).toContain("PATH_FORBIDDEN");
    addon.handlers.set("editor.quit", () => { setTimeout(() => proc.emit("exit", 0, null), 10); return { ok: true, result: { saved: false } }; });
    const retry = await client.callTool({ name: "editor_quit", arguments: { save: false, timeout_ms: 1000 } });
    expect(retry.isError, textOf(retry)).toBeFalsy();
    expect(proc.signals).toEqual([]);
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

  it("converts an asynchronous spawn failure to a tool error and allows a later launch on the same server", async () => {
    onSpawn = (proc) => {
      proc.pid = undefined;
      setTimeout(() => proc.emit("error", Object.assign(new Error("controlled asynchronous ENOENT"), { code: "ENOENT" })), 0);
    };
    await start();
    const failed = await client.callTool({ name: "editor_launch", arguments: { timeout_ms: 1000 } });
    expect(failed.isError, textOf(failed)).toBe(true);
    expect(textOf(failed)).toMatch(/EDITOR_SPAWN_FAILED.*controlled asynchronous ENOENT/);
    onSpawn = (proc) => { sessionPid = proc.pid; };
    const recovered = await client.callTool({ name: "editor_launch", arguments: { timeout_ms: 1000 } });
    expect(recovered.isError, textOf(recovered)).toBeFalsy();
    expect(jsonOf(recovered).launched).toBe(true);
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

  it("reads only a bounded tail when a failed editor writes a huge single-line log", async () => {
    onSpawn = (proc) => {
      appendFileSync(logFile(), "x".repeat(256 * 1024) + "\nERROR: TAIL_MARKER\n");
      setTimeout(() => proc.emit("exit", 1, null), 30);
    };
    await start();
    const res = await client.callTool({ name: "editor_launch", arguments: {} });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("TAIL_MARKER");
    expect(textOf(res).length).toBeLessThan(20 * 1024);
  });

  it("times out without killing an editor that is still starting", async () => {
    onSpawn = () => {};
    await start();
    const res = await client.callTool({ name: "editor_launch", arguments: { timeout_ms: 1000 } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/TIMEOUT[\s\S]*Hint:.*godot_status/);
    expect(spawned[0]!.proc.signals).toEqual([]);
  });

  it("retains the first owner across timeout, retry, late readiness and normal quit", async () => {
    onSpawn = () => {};
    await start();
    const first = await client.callTool({ name: "editor_launch", arguments: { timeout_ms: 1000 } });
    expect(first.isError, textOf(first)).toBe(true);
    expect(textOf(first)).toContain("TIMEOUT");
    const proc = spawned[0]!.proc;
    appendFileSync(logFile(), "FIRST_OWNER_LOG\n");
    const retry = await client.callTool({ name: "editor_launch", arguments: { timeout_ms: 1000 } });
    expect(retry.isError, textOf(retry)).toBe(true);
    expect(textOf(retry)).toContain("BUSY");
    expect(spawned).toHaveLength(1);
    expect(readFileSync(logFile(), "utf8")).toContain("FIRST_OWNER_LOG");
    expect(proc.signals).toEqual([]);
    sessionPid = proc.pid;
    const ready = await client.callTool({ name: "godot_status", arguments: {} });
    expect(jsonOf(ready)).toMatchObject({ connected: true, project_name: "Demo" });
    addon.handlers.set("editor.quit", () => {
      setTimeout(() => { sessionPid = undefined; proc.emit("exit", 0, null); }, 10);
      return { ok: true, result: { saved: false } };
    });
    const quit = await client.callTool({ name: "editor_quit", arguments: { save: false, timeout_ms: 1000 } });
    expect(quit.isError, textOf(quit)).toBeFalsy();
    expect(jsonOf(quit).quit).toBe(true);
    expect(proc.signals).toEqual([]);
  });

  it("admits only one launch before asynchronous executable discovery finishes", async () => {
    let enter!: () => void, enterAgain!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => { enter = r; });
    const enteredAgain = new Promise<void>((r) => { enterAgain = r; });
    const gate = new Promise<void>((r) => { release = r; });
    let finds = 0;
    await start(async () => {
      finds++;
      if (finds === 1) enter(); else enterAgain();
      await gate;
      return { path: "/fake/godot", version: "4.7.2.stable.official", source: "PATH" };
    });
    const first = client.callTool({ name: "editor_launch", arguments: { timeout_ms: 1000 } });
    await entered;
    const second = client.callTool({ name: "editor_launch", arguments: { timeout_ms: 1000 } });
    try {
      const observation = await Promise.race([
        second.then((result) => ({ kind: "reply" as const, result })),
        enteredAgain.then(() => ({ kind: "duplicate_discovery" as const })),
      ]);
      expect(observation.kind).toBe("reply");
      if (observation.kind === "reply") expect(textOf(observation.result)).toContain("BUSY");
      expect(finds).toBe(1);
    } finally {
      release();
      await Promise.all([first, second]);
    }
    expect(spawned).toHaveLength(1);
  });

  it("does not accept a different session PID as readiness of its owned process", async () => {
    onSpawn = () => { sessionPid = 999; };
    await start();
    const result = await client.callTool({ name: "editor_launch", arguments: { timeout_ms: 1000 } });
    expect(result.isError, textOf(result)).toBe(true);
    expect(textOf(result)).toContain("TIMEOUT");
    expect(addon.received.some((r) => r.method === "ping")).toBe(false);
    const proc = spawned[0]!.proc;
    expect(proc.signals).toEqual([]);
    sessionPid = proc.pid;
    addon.handlers.set("editor.quit", () => {
      setTimeout(() => proc.emit("exit", 0, null), 10);
      return { ok: true, result: { saved: false } };
    });
    const quit = await client.callTool({ name: "editor_quit", arguments: { save: false, timeout_ms: 1000 } });
    expect(quit.isError, textOf(quit)).toBeFalsy();
  });

  it("never closes a published session when the owned process has no confirmed PID", async () => {
    onSpawn = (proc) => { proc.pid = undefined; sessionPid = 999; };
    await start();
    const first = await client.callTool({ name: "editor_launch", arguments: { timeout_ms: 1000 } });
    expect(textOf(first)).toContain("TIMEOUT");
    const quit = await client.callTool({ name: "editor_quit", arguments: { save: false, timeout_ms: 1000 } });
    expect(quit.isError, textOf(quit)).toBe(true);
    expect(textOf(quit)).toContain("EDITOR_NOT_LAUNCHED");
    expect(addon.received.some((r) => r.method === "editor.quit")).toBe(false);
    expect(spawned[0]!.proc.signals).toEqual([]);
    spawned[0]!.proc.emit("exit", 1, null);
  });

  it("allows a new launch on the same manager after the previous owner actually exited", async () => {
    onSpawn = (proc) => setTimeout(() => proc.emit("exit", 1, null), 10);
    await start();
    const failed = await client.callTool({ name: "editor_launch", arguments: { timeout_ms: 1000 } });
    expect(textOf(failed)).toContain("EDITOR_EXITED");
    onSpawn = (proc) => { sessionPid = proc.pid; };
    const retry = await client.callTool({ name: "editor_launch", arguments: { timeout_ms: 1000 } });
    expect(retry.isError, textOf(retry)).toBeFalsy();
    expect(jsonOf(retry).pid).toBe(4243);
    expect(spawned).toHaveLength(2);
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

  it("refuses an unknown owned PID even when session metadata is missing but an old peer is cached", async () => {
    sessionPid = 111; await start(); await conn.call("ping");
    const quitCalls: unknown[] = [];
    addon.handlers.set("editor.quit", (p) => { quitCalls.push(p); return { ok: true, result: { saved: false } }; });
    sessionPid = undefined;
    onSpawn = (proc) => { proc.pid = undefined; };
    const pending = await client.callTool({ name: "editor_launch", arguments: { timeout_ms: 1000 } });
    expect(pending.isError).toBe(true);
    const quit = await client.callTool({ name: "editor_quit", arguments: { timeout_ms: 1000 } });
    expect(quit.isError, textOf(quit)).toBe(true);
    expect(textOf(quit)).toContain("EDITOR_NOT_LAUNCHED");
    expect(quitCalls).toHaveLength(0);
    expect(spawned[0]!.proc.signals).toHaveLength(0);
  });

  it.each(["readiness", "quit"] as const)("does not use a cached bridge from an unowned editor for owned %s", async (phase) => {
    sessionPid = 111;
    await start();
    await conn.call("ping"); // keep the old, unowned A peer connected
    const unowned = addon;
    unowned.handlers.set("editor.quit", () => ({ ok: true, result: { saved: false } }));
    const owned = new FakeAddon("owned-fake-token");
    owned.handlers.set("project.info", () => ({ ok: true, result: { name: "Owned B", main_scene: "" } }));
    owned.handlers.set("editor.status", () => ({ ok: true, result: { project_name: "Owned B", playing: false } }));
    owned.handlers.set("editor.quit", () => {
      setTimeout(() => spawned[0]!.proc.emit("exit", 0, null), 10);
      return { ok: true, result: { saved: true } };
    });
    port = await owned.start(); addon = owned;
    sessionPid = undefined;
    onSpawn = (proc) => { sessionPid = proc.pid; };
    try {
      unowned.received.length = 0;
      const launched = await client.callTool({ name: "editor_launch", arguments: { timeout_ms: 1000 } });
      expect(launched.isError, textOf(launched)).toBeFalsy();
      if (phase === "readiness") {
        expect(unowned.received.filter((r) => r.method === "ping")).toHaveLength(0);
        expect(owned.received.some((r) => r.method === "ping")).toBe(true);
        expect(jsonOf(launched).project_name).toBe("Owned B");
      } else {
        unowned.received.length = 0;
        const quit = await client.callTool({ name: "editor_quit", arguments: { timeout_ms: 1000 } });
        expect(quit.isError, textOf(quit)).toBeFalsy();
        expect(unowned.received.filter((r) => r.method === "editor.quit")).toHaveLength(0);
        expect(owned.received.filter((r) => r.method === "editor.quit")).toHaveLength(1);
        expect(jsonOf(quit)).not.toHaveProperty("killed");
        expect(spawned[0]!.proc.signals).toHaveLength(0);
      }
    } finally {
      await unowned.stop();
    }
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

  it("never reports quit or forgets ownership when both termination signals fail", async () => {
    await start();
    await client.callTool({ name: "editor_launch", arguments: {} });
    addon.handlers.set("editor.quit", () => ({ ok: true, result: { quitting: true, saved: false } }));
    const proc = spawned[0]!.proc;
    proc.kill = (signal: NodeJS.Signals = "SIGTERM") => { proc.signals.push(signal); return false; };
    const failed = await client.callTool({ name: "editor_quit", arguments: { save: false, timeout_ms: 1000 } });
    expect(failed.isError, textOf(failed)).toBe(true);
    expect(textOf(failed)).toMatch(/TIMEOUT.*not confirmed/i);
    proc.kill = FakeProc.prototype.kill.bind(proc);
    const retry = await client.callTool({ name: "editor_quit", arguments: { save: false, timeout_ms: 1000 } });
    expect(retry.isError, textOf(retry)).toBeFalsy();
    expect(jsonOf(retry).quit).toBe(true);
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

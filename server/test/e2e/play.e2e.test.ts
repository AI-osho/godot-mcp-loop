import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectClient, textOf } from "../helpers.js";
import { PLATFORMER_PROJECT, startHeadlessEditor, WINDOWED, type GodotHarness } from "./godot-harness.js";

describe("e2e: run / observe loop", () => {
  let h: GodotHarness;
  let client: Client;

  async function ok(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const res = await client.callTool({ name, arguments: args });
    if (res.isError) throw new Error(`${name} failed: ${textOf(res)}`);
    const first = (res.content as Array<{ type: string; text?: string }>)[0];
    return first?.type === "text" ? JSON.parse(first.text ?? "null") : res;
  }
  async function fails(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const res = await client.callTool({ name, arguments: args });
    expect(res.isError, `${name} should fail`).toBe(true);
    return textOf(res);
  }

  beforeAll(async () => {
    h = await startHeadlessEditor(PLATFORMER_PROJECT);
    client = await connectClient(h.conn);
  }, 120_000);
  afterAll(async () => {
    await client?.close();
    await h?.stop();
  });

  it("game tools fail cleanly before the game runs", async () => {
    expect((await ok("godot_status")).playing).toBe(false);
    expect(await fails("game_query", { node: "Player" })).toContain("GAME_NOT_RUNNING");
  });

  it("game_run starts the main scene and connects the runtime", async () => {
    const r = await ok("game_run");
    expect(r.running).toBe(true);
    expect(r.scene).toBe("res://examples/platformer/main.tscn");
    const s = await ok("godot_status");
    expect(s.playing).toBe(true);
    expect(s.game.connected).toBe(true);
  }, 40_000);

  it("refuses a second game_run without restart", async () => {
    expect(await fails("game_run")).toContain("GAME_ALREADY_RUNNING");
  });

  it("game_wait_for sees the player land on the floor", async () => {
    const r = await ok("game_wait_for", { node: "Player", property: "position:y", op: ">=", value: 370, timeout_ms: 5000 });
    expect(r.met).toBe(true);
  });

  it("game_wait_for accepts a number sent as a string", async () => {
    const r = await ok("game_wait_for", { node: "Player", property: "position:y", op: ">=", value: "370", timeout_ms: 5000 });
    expect(r.met).toBe(true);
  });

  it("game_wait_for with timeout_ms 0 fails as an assertion with the actual value", async () => {
    const msg = await fails("game_wait_for", { node: "Player", property: "position:x", op: ">", value: 5000, timeout_ms: 0 });
    expect(msg).toContain("ASSERTION_FAILED");
    expect(msg).toMatch(/Actual value: \d+/);
  });

  it("game_query reads live values and script variables", async () => {
    const q = await ok("game_query", { node: "Player" });
    expect(q.type).toBe("CharacterBody2D");
    expect(q.properties.position[0]).toBeCloseTo(100, 0);
    expect(q.properties.jumps).toBe(0);
    expect(q.children).toContain("CollisionShape2D");
  });

  it("game_input moves the player right", async () => {
    await ok("game_input", { steps: [{ action: "move_right", hold_ms: 1000 }] });
    const q = await ok("game_query", { node: "Player", properties: ["position:x"] });
    expect(q.properties["position:x"]).toBeGreaterThan(250);
  });

  it("jump is observed through state and logs", async () => {
    const before = await ok("logs_read", { source: "game" });
    await ok("game_input", { steps: [{ action: "jump", hold_ms: 100 }] });
    await ok("game_wait_for", { node: "Player", property: "jumps", op: "==", value: 1, timeout_ms: 3000 });
    const logs = await ok("logs_read", { source: "game", since: before.next });
    expect(logs.entries.map((e: any) => e.message)).toContain("jump #1");
  });

  it("game_input record captures the top of a jump in one call", async () => {
    await ok("game_wait_for", { node: "Player", property: "position:y", op: ">=", value: 370, timeout_ms: 3000 });
    const r = await ok("game_input", {
      steps: [{ action: "jump", hold_ms: 100 }, { wait_ms: 800 }],
      record: { node: "Player", properties: ["position:y"] },
    });
    const y = r.record.summary["position:y"];
    expect(y.first).toBeGreaterThan(370); // on the floor
    expect(y.min).toBeLessThan(320); // the apex (about 286) was captured
    expect(y.min_at_ms).toBeGreaterThan(200);
    expect(y.min_at_ms).toBeLessThan(700);
    expect(r.record.samples.length).toBeGreaterThan(5);
    expect(r.record.samples.length).toBeLessThanOrEqual(50);
  });

  it("game_set changes live state and game_call calls methods with converted arguments", async () => {
    const set = await ok("game_set", { node: "Player", properties: { "position:x": 300 } });
    expect(set.changes["position:x"].after).toBeCloseTo(300, 0);
    const pos = await ok("game_call", { node: "Player", method: "get_position" });
    expect(pos.returned[0]).toBeCloseTo(300, 0);
    await ok("game_call", { node: "Player", method: "set_position", args: [[150, 200]] });
    const q = await ok("game_query", { node: "Player", properties: ["position:x"] });
    expect(q.properties["position:x"]).toBeCloseTo(150, 0);
    expect(await fails("game_call", { node: "Player", method: "no_such_method" })).toContain("no method");
    expect(await fails("game_set", { node: "Player", properties: { "position:x": 1, nope: 2 } })).toContain("nope");
  });

  it("game_pause freezes the game; game_step runs exact frames; inline steps run atomically", async () => {
    await ok("game_input", { steps: [{ action: "move_right", press: true }] });
    await ok("game_pause", { paused: true });
    const x0 = (await ok("game_query", { node: "Player", properties: ["position"] })).properties.position[0];
    await new Promise((r) => setTimeout(r, 300));
    const x1 = (await ok("game_query", { node: "Player", properties: ["position"] })).properties.position[0];
    expect(x1).toBe(x0); // nothing moves while paused, even with the action held
    const step1 = await ok("game_step", { frames: 30 });
    expect(step1.stepped_frames).toBe(30);
    const x2 = (await ok("game_query", { node: "Player", properties: ["position"] })).properties.position[0];
    expect(x2).toBeGreaterThan(x0);
    await ok("game_step", { frames: 30 });
    const x3 = (await ok("game_query", { node: "Player", properties: ["position"] })).properties.position[0];
    expect(x3 - x2).toBeCloseTo(x2 - x0, 1); // same frames, same distance (at top speed)
    await ok("game_pause", { paused: false });
    // set + frame wait + assert inside one call, with a tolerance and a message
    const r = await ok("game_input", {
      steps: [
        { action: "move_right", release: true },
        { set: { node: "Player", properties: { "position:x": 300 } } },
        { assert: { node: "Player", property: "position:x", op: "==", value: 300, tolerance: 0.5, message: "teleported" } },
      ],
    });
    expect(r.results).toHaveLength(2);
  });

  it("game_input pause_at_end freezes the game so a later call measures the same state", async () => {
    const r = await ok("game_input", { steps: [{ action: "move_right", hold_frames: 10 }], pause_at_end: true });
    expect(r.paused).toBe(true);
    const x0 = (await ok("game_query", { node: "Player", properties: ["position:x"] })).properties["position:x"];
    await new Promise((resolve) => setTimeout(resolve, 800));
    const x1 = (await ok("game_query", { node: "Player", properties: ["position:x"] })).properties["position:x"];
    expect(x1).toBe(x0);
    await ok("game_pause", { paused: false });
  });

  it("game_step tap reaches is_action_just_pressed; method conditions; record per physics frame (#6, #7, #9)", async () => {
    await ok("game_wait_for", { node: "Player", method: "is_on_floor", op: "==", value: true, timeout_ms: 3000 });
    const j0 = (await ok("game_query", { node: "Player", properties: ["jumps"] })).properties.jumps;
    await ok("game_pause", { paused: true });
    await ok("game_step", { frames: 1, tap: ["jump"] }); // even a one-frame step delivers the press
    const q = await ok("game_query", { node: "Player", properties: ["jumps", "velocity:y"] });
    expect(q.properties.jumps).toBe(j0 + 1); // the player jumps on Input.is_action_just_pressed("jump")
    expect(q.properties["velocity:y"]).toBeLessThan(0);
    await ok("game_pause", { paused: false });
    const landed = await ok("game_wait_for", { node: "Player", method: "get_position", property: "y", op: ">=", value: 370, timeout_ms: 3000 });
    expect(landed.value).toBeGreaterThanOrEqual(370);
    expect(await fails("game_wait_for", { node: "Player", method: "no_such_method", op: "==", value: 1 })).toContain("no method");
    const r = await ok("game_input", { steps: [{ wait_frames: 20 }], record: { node: "Player", properties: ["position:x"], per: "physics" } });
    expect(r.record.per).toBe("physics");
    expect(r.record.samples_total).toBeGreaterThanOrEqual(20);
    expect(r.record.samples_total).toBeLessThanOrEqual(23);
    expect(r.record.samples[r.record.samples.length - 1].frame).toBeGreaterThanOrEqual(20);
  });

  it("game_wait_for times out with the last value", async () => {
    const msg = await fails("game_wait_for", { node: "Player", property: "jumps", op: ">", value: 5, timeout_ms: 300 });
    expect(msg).toContain("TIMEOUT");
    expect(msg).toMatch(/Last value: \d+/); // jump count so far (depends on earlier tests)
  });

  it("game_input rejects unknown actions without side effects", async () => {
    expect(await fails("game_input", { steps: [{ action: "teleport" }] })).toContain("unknown input action 'teleport'");
  });

  it("screenshot works with a window, reports RENDERING_UNAVAILABLE headless", async () => {
    const res = await client.callTool({ name: "screenshot", arguments: { max_width: 640 } });
    if (WINDOWED) {
      expect(res.isError).toBeFalsy();
      const img = (res.content as Array<{ type: string; data?: string }>)[0]!;
      expect(img.type).toBe("image");
      expect(Buffer.from(img.data!, "base64").subarray(1, 4).toString()).toBe("PNG");
      expect(textOf(res)).toContain("game screenshot 640x360"); // scaled to max_width
      const full = await client.callTool({ name: "screenshot", arguments: {} });
      expect(textOf(full)).toContain("game screenshot 1152x648"); // the project's viewport size
    } else {
      expect(textOf(res)).toContain("RENDERING_UNAVAILABLE");
    }
  });

  it("game_stop stops the game; logs remain readable", async () => {
    const r = await ok("game_stop");
    expect(r.stopped).toBe(true);
    expect((await ok("godot_status")).playing).toBe(false);
    expect(await fails("game_query", { node: "Player" })).toContain("GAME_NOT_RUNNING");
    const logs = await ok("logs_read", { source: "game" });
    expect(logs.entries.map((e: any) => e.message)).toContain("jump #1");
  });

  it("a script error is reported and auto-continued; the game stays responsive", async () => {
    await ok("game_run", { scene: "res://examples/fixtures/error_scene.tscn" });
    const errs = await waitForLogs("error", (entries) => entries.some((e: any) => /null/i.test(e.message)));
    expect(errs.some((e: any) => e.file?.includes("error_scene.gd") && e.line > 0)).toBe(true);
    const q = await ok("game_query", { node: ".", properties: ["ticks"] });
    expect(q.properties.ticks).toBeGreaterThan(0);
    expect((await ok("godot_status")).game.debugger_breaks).toBeGreaterThanOrEqual(1);
    await ok("game_stop");
  }, 40_000);

  it("input_action_set adds an action the restarted game understands; edit_undo removes it", async () => {
    await ok("game_run", { restart: true });
    expect(await fails("game_input", { steps: [{ action: "mcp_fire" }] })).toContain("unknown input action");
    const r = await ok("input_action_set", { name: "mcp_fire", keys: ["X", "Space"] });
    expect(r.events).toHaveLength(2);
    // Like actions created in the editor: matched on every device.
    const projectFile = readFileSync(join(h.projectPath, "project.godot"), "utf8");
    const fire = projectFile.slice(projectFile.indexOf("mcp_fire="), projectFile.indexOf("}", projectFile.indexOf("mcp_fire=")));
    expect(fire).toContain('"device":-1');
    expect(fire).not.toContain('"device":16');
    await ok("game_run", { restart: true });
    await ok("game_input", { steps: [{ action: "mcp_fire", hold_ms: 30 }] });
    await ok("edit_undo");
    await ok("game_run", { restart: true });
    expect(await fails("game_input", { steps: [{ action: "mcp_fire" }] })).toContain("unknown input action");
    await ok("game_stop"); // leave the game stopped, as the next test expects
  });

  it("game_run restart=true replaces a running game", async () => {
    await ok("game_run");
    const r = await ok("game_run", { restart: true });
    expect(r.running).toBe(true);
    await ok("game_stop");
  }, 60_000);

  async function waitForLogs(minLevel: string, pred: (entries: any[]) => boolean): Promise<any[]> {
    const deadline = Date.now() + 8000;
    for (;;) {
      const logs = await ok("logs_read", { source: "game", min_level: minLevel });
      if (pred(logs.entries)) return logs.entries;
      if (Date.now() > deadline) throw new Error(`log condition not met: ${JSON.stringify(logs.entries)}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
});

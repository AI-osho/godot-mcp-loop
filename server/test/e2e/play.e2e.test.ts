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

  it("game_wait_for times out with the last value", async () => {
    const msg = await fails("game_wait_for", { node: "Player", property: "jumps", op: ">", value: 5, timeout_ms: 300 });
    expect(msg).toContain("TIMEOUT");
    expect(msg).toContain("Last value: 1");
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

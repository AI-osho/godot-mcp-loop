import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GodotConnection } from "../src/connection.js";
import { PLAY_TOOLS, inputTimeoutMs } from "../src/tools/play.js";
import { FakeAddon } from "./fake-addon.js";
import { connectClient, jsonOf, textOf } from "./helpers.js";

describe("play/observe tools (forwarding layer)", () => {
  let addon: FakeAddon;
  let conn: GodotConnection;
  let client: Client;

  beforeEach(async () => {
    addon = new FakeAddon();
    const port = await addon.start();
    conn = new GodotConnection({
      projectPath: "/proj",
      readSession: () => ({ port, token: addon.token, protocol: 1, pid: process.pid }),
    });
    client = await connectClient(conn);
  });

  afterEach(async () => {
    await client.close();
    conn.close();
    await addon.stop();
  });

  it("registers every play tool plus screenshot", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const def of PLAY_TOOLS) expect(names).toContain(def.name);
    expect(names).toContain("screenshot");
  });

  it("game_wait_for declares typed values so clients don't stringify numbers", async () => {
    const tool = (await client.listTools()).tools.find((t) => t.name === "game_wait_for")!;
    const value = (tool.inputSchema.properties as Record<string, any>).value;
    const types = JSON.stringify(value);
    expect(types).toContain('"number"');
    expect(types).toContain('"boolean"');
    expect(types).toContain('"array"');
  });

  it("game_input forwards steps", async () => {
    addon.handlers.set("game.input", (p) => ({ ok: true, result: { got: p } }));
    const steps = [{ action: "move_right", hold_ms: 500 }, { wait_ms: 100 }, { key: "Space" }];
    const res = await client.callTool({ name: "game_input", arguments: { steps } });
    expect(jsonOf(res)).toEqual({ got: { steps } });
  });

  it("game_input forwards a record request", async () => {
    addon.handlers.set("game.input", (p) => ({ ok: true, result: { got: p } }));
    const args = {
      steps: [{ action: "jump", hold_ms: 100 }, { wait_ms: 600 }],
      record: { node: "Player", properties: ["position:y"], interval_ms: 0 },
    };
    const res = await client.callTool({ name: "game_input", arguments: args });
    expect(jsonOf(res)).toEqual({ got: args });
    const bad = await client.callTool({
      name: "game_input",
      arguments: { steps: [{ wait_ms: 1 }], record: { node: "Player", properties: [] } },
    });
    expect(bad.isError).toBe(true);
  });

  it("game_input forwards pause_at_end", async () => {
    addon.handlers.set("game.input", (p) => ({ ok: true, result: { got: p } }));
    const args = { steps: [{ action: "move_right", hold_frames: 10 }], pause_at_end: true };
    const res = await client.callTool({ name: "game_input", arguments: args });
    expect(jsonOf(res)).toEqual({ got: args });
  });

  it("rejects an argument the tool does not take instead of silently ignoring it", async () => {
    const res = await client.callTool({ name: "game_query", arguments: { node: ".", method: "summary" } });
    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).toContain("Unrecognized key");
    expect(text).toContain("method");
  });

  it("screenshot forwards normalize and reports the window size when the capture was scaled", async () => {
    let seen: Record<string, unknown> | undefined;
    addon.handlers.set("screenshot", (p) => {
      seen = p;
      return { ok: true, result: { png_base64: "QUJD", width: 1152, height: 648, target: "game", source_width: 960, source_height: 540 } };
    });
    const res = await client.callTool({ name: "screenshot", arguments: { normalize: "none" } });
    expect(seen).toEqual({ normalize: "none" });
    const text = (res.content as Array<{ type: string; text?: string }>).find((c) => c.type === "text")!.text!;
    expect(text).toBe("game screenshot 1152x648 (window 960x540, scaled to the viewport)");
  });

  it("game_ui_audit forwards node and include_hidden", async () => {
    addon.handlers.set("game.ui_audit", (p) => ({ ok: true, result: { got: p } }));
    const res = await client.callTool({ name: "game_ui_audit", arguments: { node: "HUD", include_hidden: true } });
    expect(jsonOf(res)).toEqual({ got: { node: "HUD", include_hidden: true } });
  });

  it("game_input's record description makes clear min/max use every frame, not just the 50 returned samples", async () => {
    const tool = (await client.listTools()).tools.find((t) => t.name === "game_input")!;
    const text = tool.description + JSON.stringify(tool.inputSchema);
    expect(text).toMatch(/every recorded frame/);
    expect(text).toMatch(/only the returned sample list/i);
    expect(text).toMatch(/interval_ms is not needed for accuracy/i);
  });

  it("game_set and game_call forward to the runtime", async () => {
    addon.handlers.set("game.set", (p) => ({ ok: true, result: { got: p } }));
    addon.handlers.set("game.call", (p) => ({ ok: true, result: { got: p } }));
    const set = await client.callTool({ name: "game_set", arguments: { node: "Game", properties: { score: 300, "items:1": 5 } } });
    expect(jsonOf(set)).toEqual({ got: { node: "Game", properties: { score: 300, "items:1": 5 } } });
    const called = await client.callTool({ name: "game_call", arguments: { node: "Game", method: "restart", args: [] } });
    expect(jsonOf(called)).toEqual({ got: { node: "Game", method: "restart", args: [] } });
  });

  it("game_input accepts frame timing, inline set/call/assert/wait_for steps and record expectations", async () => {
    addon.handlers.set("game.input", (p) => ({ ok: true, result: { got: p } }));
    const args = {
      steps: [
        { set: { node: "Game", properties: { score: 0 } } },
        { action: "jump", hold_frames: 6, wait_frames: 2 },
        { call: { node: "Game", method: "tick", args: [1] } },
        { assert: { node: "Game", property: "score", op: ">=", value: 0 } },
        { wait_for: { node: "Player", property: "position:y", op: "increased", timeout_ms: 1000 } },
      ],
      record: {
        node: "Player",
        properties: ["position:y"],
        expect: [{ property: "position:y", stat: "min", op: "<", value: 300 }],
      },
    };
    const res = await client.callTool({ name: "game_input", arguments: args });
    expect(res.isError).toBeFalsy();
    expect(jsonOf(res)).toEqual({ got: args });
  });

  it("game_wait_for accepts relative operators without a value", async () => {
    addon.handlers.set("game.wait_for", (p) => ({ ok: true, result: { got: p } }));
    const res = await client.callTool({
      name: "game_wait_for",
      arguments: { node: "Game", property: "score", op: "increased", timeout_ms: 500 },
    });
    expect(res.isError).toBeFalsy();
  });

  it("game_pause / game_step forward to the game; game_wait_for passes tolerance and message", async () => {
    addon.handlers.set("game.pause", (p) => ({ ok: true, result: { got: p } }));
    addon.handlers.set("game.step", (p) => ({ ok: true, result: { got: p } }));
    addon.handlers.set("game.wait_for", (p) => ({ ok: true, result: { got: p } }));
    expect(jsonOf(await client.callTool({ name: "game_pause", arguments: { paused: true } }))).toEqual({ got: { paused: true } });
    expect(jsonOf(await client.callTool({ name: "game_step", arguments: { frames: 12 } }))).toEqual({ got: { frames: 12 } });
    const wf = { node: "P", property: "position:x", op: "==", value: 10, tolerance: 0.5, message: "player at start" };
    expect(jsonOf(await client.callTool({ name: "game_wait_for", arguments: wf }))).toEqual({ got: wf });
    const bad = await client.callTool({ name: "game_step", arguments: { frames: 0 } });
    expect(bad.isError).toBe(true);
  });

  it("game_step forwards press/release/tap; game_wait_for accepts a method condition without property (#6, #7)", async () => {
    addon.handlers.set("game.step", (p) => ({ ok: true, result: { got: p } }));
    addon.handlers.set("game.wait_for", (p) => ({ ok: true, result: { got: p } }));
    const step = { frames: 8, tap: ["rpg_right"], press: ["rpg_run"], release: ["rpg_left"] };
    expect(jsonOf(await client.callTool({ name: "game_step", arguments: step }))).toEqual({ got: step });
    const wf = { node: ".", method: "summary", property: "state", op: "==", value: "battle" };
    expect(jsonOf(await client.callTool({ name: "game_wait_for", arguments: wf }))).toEqual({ got: wf });
    const noProp = { node: ".", method: "hp", args: [1], op: ">", value: 0 };
    expect(jsonOf(await client.callTool({ name: "game_wait_for", arguments: noProp }))).toEqual({ got: noProp });
    const neither = await client.callTool({ name: "game_wait_for", arguments: { node: ".", op: "==", value: 1 } });
    expect(neither.isError).toBe(true);
  });

  it("game_input passes record.per (#9)", async () => {
    addon.handlers.set("game.input", (p) => ({ ok: true, result: { got: p } }));
    const args = { steps: [{ wait_frames: 5 }], record: { node: "P", properties: ["position:x"], per: "physics" } };
    expect(jsonOf(await client.callTool({ name: "game_input", arguments: args }))).toMatchObject({ got: args });
    const bad = await client.callTool({ name: "game_input", arguments: { ...args, record: { ...args.record, per: "bogus" } } });
    expect(bad.isError).toBe(true);
  });

  it("game_input rejects an empty step list", async () => {
    const res = await client.callTool({ name: "game_input", arguments: { steps: [] } });
    expect(res.isError).toBe(true);
  });

  it("computes a generous timeout from hold/wait durations", () => {
    expect(inputTimeoutMs({ steps: [{ hold_ms: 2000 }, { wait_ms: 3000 }] })).toBeGreaterThanOrEqual(5000 + 5000);
    expect(inputTimeoutMs({ steps: [{ action: "x" }] })).toBeGreaterThanOrEqual(5000);
  });

  it("screenshot returns an MCP image content block", async () => {
    addon.handlers.set("screenshot", () => ({
      ok: true,
      result: { png_base64: "iVBORw0KGgo=", width: 640, height: 360, target: "game" },
    }));
    const res = await client.callTool({ name: "screenshot", arguments: {} });
    expect(res.isError).toBeFalsy();
    const content = res.content as Array<{ type: string; data?: string; mimeType?: string; text?: string }>;
    expect(content[0]).toEqual({ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" });
    expect(content[1]?.text).toContain("640x360");
  });

  it("screenshot passes RENDERING_UNAVAILABLE through as an error", async () => {
    addon.handlers.set("screenshot", () => ({
      ok: false,
      error: { code: "RENDERING_UNAVAILABLE", message: "headless", hint: "Run with a window." },
    }));
    const res = await client.callTool({ name: "screenshot", arguments: { target: "game" } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("RENDERING_UNAVAILABLE");
  });

  it("screenshot max_width is capped to keep payloads within the bridge buffer", async () => {
    const res = await client.callTool({ name: "screenshot", arguments: { max_width: 4096 } });
    expect(res.isError).toBe(true);
    expect(addon.received.some((r) => r.method === "screenshot")).toBe(false);
  });

  it("logs_read defaults are left to the addon", async () => {
    addon.handlers.set("logs.read", (p) => ({ ok: true, result: { p } }));
    expect(jsonOf(await client.callTool({ name: "logs_read", arguments: {} }))).toEqual({ p: {} });
  });
});

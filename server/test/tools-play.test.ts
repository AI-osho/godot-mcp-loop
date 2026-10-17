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

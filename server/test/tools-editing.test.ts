import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GodotConnection } from "../src/connection.js";
import { EDITING_TOOLS } from "../src/tools/editing.js";
import { FakeAddon } from "./fake-addon.js";
import { connectClient, jsonOf, textOf } from "./helpers.js";

describe("editing tools (forwarding layer)", () => {
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

  it("lists every editing tool with a description and an object input schema", async () => {
    const { tools } = await client.listTools();
    for (const def of EDITING_TOOLS) {
      const t = tools.find((x) => x.name === def.name);
      expect(t, def.name).toBeDefined();
      expect(t!.description!.length, def.name).toBeGreaterThan(20);
      expect(t!.inputSchema.type).toBe("object");
    }
  });

  it("marks read-only and destructive tools via annotations", async () => {
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "scene_tree")!.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "node_delete")!.annotations?.destructiveHint).toBe(true);
  });

  it("forwards arguments to the bridge method and returns its result as JSON", async () => {
    addon.handlers.set("node.set", (p) => ({ ok: true, result: { echoed: p } }));
    const res = await client.callTool({
      name: "node_set",
      arguments: { path: "Hero", properties: { position: [1, 2] } },
    });
    expect(res.isError).toBeFalsy();
    expect(jsonOf(res)).toEqual({ echoed: { path: "Hero", properties: { position: [1, 2] } } });
  });

  it("omits undefined optional arguments", async () => {
    addon.handlers.set("scene.tree", (p) => ({ ok: true, result: { keys: Object.keys(p) } }));
    const res = await client.callTool({ name: "scene_tree", arguments: {} });
    expect(jsonOf(res)).toEqual({ keys: [] });
  });

  it("rejects invalid arguments before contacting Godot", async () => {
    const res = await client.callTool({ name: "edit_undo", arguments: { steps: 0 } });
    expect(res.isError).toBe(true);
    expect(addon.received.filter((r) => r.method === "edit.undo")).toHaveLength(0);
  });

  it("surfaces bridge errors with code and hint", async () => {
    addon.handlers.set("node.delete", () => ({
      ok: false,
      error: { code: "INVALID_PARAMS", message: "The scene root cannot be deleted.", hint: "Delete children instead." },
    }));
    const res = await client.callTool({ name: "node_delete", arguments: { path: "." } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("INVALID_PARAMS");
    expect(textOf(res)).toContain("Delete children instead.");
  });
});

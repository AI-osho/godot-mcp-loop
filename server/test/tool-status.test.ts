import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GodotConnection } from "../src/connection.js";
import { FakeAddon } from "./fake-addon.js";
import { connectClient, textOf } from "./helpers.js";

describe("godot_status tool", () => {
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

  it("is listed with a description", async () => {
    const { tools } = await client.listTools();
    const t = tools.find((x) => x.name === "godot_status");
    expect(t?.description).toMatch(/Godot/);
  });

  it("reports connection and editor info", async () => {
    addon.handlers.set("editor.status", () => ({
      ok: true,
      result: { project_name: "demo", edited_scene: "res://main.tscn", playing: false },
    }));
    const res = await client.callTool({ name: "godot_status", arguments: {} });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(textOf(res));
    expect(data).toMatchObject({
      connected: true,
      godot_version: "4.7.2-fake",
      project_name: "demo",
      edited_scene: "res://main.tscn",
      playing: false,
    });
  });

  it("returns an actionable error when Godot is not running", async () => {
    await addon.stop();
    conn.close();
    const res = await client.callTool({ name: "godot_status", arguments: {} });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/GODOT_NOT_RUNNING/);
    expect(textOf(res)).toMatch(/Hint:/);
    addon = new FakeAddon();
    await addon.start();
  });
});

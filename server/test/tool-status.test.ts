import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GodotConnection } from "../src/connection.js";
import { SERVER_VERSION } from "../src/server.js";
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

  it("reports the server version from package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(SERVER_VERSION).toBe(pkg.version);
    expect(client.getServerVersion()?.version).toBe(pkg.version);
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

  it("reports the server version and no warning when addon and server match", async () => {
    addon.handlers.set("editor.status", () => ({ ok: true, result: {} }));
    const data = JSON.parse(textOf(await client.callTool({ name: "godot_status", arguments: {} })));
    expect(data.server_version).toBe(SERVER_VERSION);
    expect(data.addon_version).toBe(SERVER_VERSION);
    expect(data.warning).toBeUndefined();
  });

  it("warns when the addon and the server versions differ (e.g. a stale server process)", async () => {
    addon.addonVersion = "0.0.9";
    addon.handlers.set("editor.status", () => ({ ok: true, result: {} }));
    const data = JSON.parse(textOf(await client.callTool({ name: "godot_status", arguments: {} })));
    expect(data.warning).toContain("0.0.9");
    expect(data.warning).toContain(SERVER_VERSION);
    expect(data.warning).toMatch(/restart|Reconnect/i);
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

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectClient, textOf } from "../helpers.js";
import { startHeadlessEditor, type GodotHarness } from "./godot-harness.js";

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("e2e: bridge against a real headless Godot editor", () => {
  let h: GodotHarness;

  beforeAll(async () => {
    h = await startHeadlessEditor();
  });
  afterAll(async () => {
    await h?.stop();
  });

  it("handshakes and answers ping", async () => {
    await expect(h.conn.call("ping")).resolves.toEqual({ pong: true });
    expect(h.conn.serverInfo()?.godot_version).toMatch(/^4\./);
  });

  it("godot_status works through the MCP layer", async () => {
    const client = await connectClient(h.conn);
    const res = await client.callTool({ name: "godot_status", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(textOf(res))).toMatchObject({ connected: true, project_name: "e2e", playing: false });
    await client.close();
  });

  it("the built stdio binary serves godot_status", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(SERVER_DIR, "dist", "index.js"), "--project", h.projectPath],
      stderr: "pipe",
    });
    const client = new Client({ name: "e2e", version: "0.0.0" });
    await client.connect(transport);
    const res = await client.callTool({ name: "godot_status", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(textOf(res))).toMatchObject({ connected: true, project_name: "e2e" });
    await client.close();
  });

  it("the built stdio binary switches to this editor's project with --projects-root (#12)", async () => {
    const start = mkdtempSync(join(dirname(h.projectPath), "gml-e2e-start-"));
    writeFileSync(join(start, "project.godot"), 'config_version=5\n\n[application]\n\nconfig/name="start"\n');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(SERVER_DIR, "dist", "index.js"), "--project", start, "--projects-root", dirname(h.projectPath)],
      stderr: "pipe",
    });
    const client = new Client({ name: "e2e", version: "0.0.0" });
    try {
      await client.connect(transport);
      const before = await client.callTool({ name: "godot_status", arguments: {} });
      expect(before.isError).toBe(true);
      expect(textOf(before)).toMatch(/GODOT_NOT_RUNNING[\s\S]*project_connect/);
      const res = await client.callTool({ name: "project_connect", arguments: { path: basename(h.projectPath) } });
      expect(res.isError).toBeFalsy();
      expect(JSON.parse(textOf(res))).toMatchObject({ changed: true, connected: true, project_name: "e2e" });
      const after = await client.callTool({ name: "godot_status", arguments: {} });
      expect(JSON.parse(textOf(after))).toMatchObject({ connected: true, project_name: "e2e" });
    } finally {
      await client.close();
      rmSync(start, { recursive: true, force: true });
    }
  });
});

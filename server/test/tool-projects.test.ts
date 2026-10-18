import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GodotConnection } from "../src/connection.js";
import { BridgeError } from "../src/errors.js";
import type { SessionInfo } from "../src/session.js";
import { FakeAddon } from "./fake-addon.js";
import { connectClient, jsonOf, textOf } from "./helpers.js";

function makeProject(dir: string, name: string): string {
  mkdirSync(join(dir, "addons", "mcp_loop"), { recursive: true });
  writeFileSync(join(dir, "project.godot"), `config_version=5\n\n[application]\n\nconfig/name="${name}"\n`);
  writeFileSync(join(dir, "addons", "mcp_loop", "plugin.cfg"), '[plugin]\nversion="0.0.0"\n');
  return dir;
}

describe("project_list / project_connect (#12)", () => {
  let root: string;
  let a: string;
  let b: string;
  let c: string;
  let addonA: FakeAddon;
  let addonB: FakeAddon;
  let ports: Map<string, { port: number; token: string }>;
  let conn: GodotConnection;
  let client: Client;

  const readSession = (dir: string): SessionInfo => {
    const s = ports.get(dir);
    if (!s) throw new BridgeError("GODOT_NOT_RUNNING", `No running Godot editor found for ${dir}.`, "Open this project in the Godot editor.");
    return { ...s, protocol: 1, pid: process.pid };
  };

  async function start(roots: string[]): Promise<void> {
    conn = new GodotConnection({ projectPath: a, projectsRoots: roots, readSession });
    client = await connectClient(conn);
  }

  beforeEach(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "gml-projtool-")));
    a = makeProject(join(root, "alpha"), "Alpha");
    b = makeProject(join(root, "games", "beta"), "Beta");
    c = makeProject(join(root, "gamma"), "Gamma"); // no editor running
    addonA = new FakeAddon("token-a");
    addonB = new FakeAddon("token-b");
    ports = new Map([
      [a, { port: await addonA.start(), token: addonA.token }],
      [b, { port: await addonB.start(), token: addonB.token }],
    ]);
    addonA.handlers.set("editor.status", () => ({ ok: true, result: { project_name: "Alpha", playing: false } }));
    addonB.handlers.set("editor.status", () => ({ ok: true, result: { project_name: "Beta", playing: true } }));
  });

  afterEach(async () => {
    await client?.close();
    conn?.close();
    await addonA.stop();
    await addonB.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it("are listed, read-only for project_list", async () => {
    await start([root]);
    const { tools } = await client.listTools();
    const list = tools.find((t) => t.name === "project_list");
    const connect = tools.find((t) => t.name === "project_connect");
    expect(list?.annotations?.readOnlyHint).toBe(true);
    expect(connect?.description).toMatch(/--projects-root/);
    expect(connect?.inputSchema.required).toEqual(["path"]);
  });

  it("project_connect is refused without --projects-root and the project stays the same", async () => {
    await start([]);
    const res = await client.callTool({ name: "project_connect", arguments: { path: b } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/PROJECT_SWITCH_DISABLED/);
    expect(textOf(res)).toMatch(/Hint:.*--projects-root/);
    expect(conn.projectPath).toBe(a);
  });

  it("switches the running server to another project; later tools talk to that editor", async () => {
    await start([root]);
    expect(jsonOf(await client.callTool({ name: "godot_status", arguments: {} }))).toMatchObject({ project_name: "Alpha", project_path: a });
    const res = await client.callTool({ name: "project_connect", arguments: { path: "games/beta" } });
    expect(res.isError).toBeFalsy();
    expect(jsonOf(res)).toMatchObject({
      changed: true,
      previous_project: a,
      project_path: b,
      connected: true,
      editor_running: true,
      project_name: "Beta",
      playing: true,
    });
    const status = jsonOf(await client.callTool({ name: "godot_status", arguments: {} }));
    expect(status).toMatchObject({ project_name: "Beta", project_path: b, projects_roots: [root] });
    expect(addonB.received.filter((r) => r.method === "editor.status")).toHaveLength(2);
  });

  it("switches to a project whose editor is not open and says how to open it", async () => {
    await start([root]);
    const res = await client.callTool({ name: "project_connect", arguments: { path: c } });
    expect(res.isError).toBeFalsy();
    const data = jsonOf(res);
    expect(data).toMatchObject({ changed: true, project_path: c, connected: false, editor_running: false, addon_installed: true });
    expect(data.hint).toMatch(/godot -e --path/);
    expect(conn.projectPath).toBe(c);
    const status = await client.callTool({ name: "godot_status", arguments: {} });
    expect(status.isError).toBe(true);
    expect(textOf(status)).toMatch(/GODOT_NOT_RUNNING[\s\S]*project_connect/);
  });

  it("refuses a folder outside the roots and keeps the current project", async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "gml-projtool-out-")));
    try {
      makeProject(join(outside, "x"), "X");
      await start([join(root, "games")]);
      const res = await client.callTool({ name: "project_connect", arguments: { path: join(outside, "x") } });
      expect(res.isError).toBe(true);
      expect(textOf(res)).toMatch(/PATH_FORBIDDEN/);
      expect(conn.projectPath).toBe(a);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("project_list shows the projects below the roots with the current one marked", async () => {
    await start([root]);
    const data = jsonOf(await client.callTool({ name: "project_list", arguments: {} }));
    expect(data.current_project).toBe(a);
    expect(data.projects_roots).toEqual([root]);
    expect(data.projects).toEqual([
      { path: a, name: "Alpha", current: true, addon_installed: true, editor_running: true },
      { path: b, name: "Beta", current: false, addon_installed: true, editor_running: true },
      { path: c, name: "Gamma", current: false, addon_installed: true, editor_running: false },
    ]);
  });

  it("project_list without roots explains how to enable switching", async () => {
    await start([]);
    const data = jsonOf(await client.callTool({ name: "project_list", arguments: {} }));
    expect(data).toMatchObject({ current_project: a, projects_roots: [], switching_enabled: false });
    expect(data.hint).toMatch(/--projects-root/);
  });
});

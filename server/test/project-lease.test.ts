import { mkdirSync, mkdtempSync, existsSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { GodotConnection } from "../src/connection.js";
import { EditorLauncher } from "../src/editor-launcher.js";
import { BridgeError } from "../src/errors.js";
import { FakeAddon } from "./fake-addon.js";
import { connectClient, jsonOf, textOf } from "./helpers.js";

it("pins the project through a scenario's idle wait and evidence save, then permits switching again", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gml-project-lease-")));
  const a = join(root, "a"), b = join(root, "b");
  for (const p of [a, b]) { mkdirSync(p); writeFileSync(join(p, "project.godot"), "config_version=5\n"); }
  const first = new FakeAddon(), other = new FakeAddon("other-fixture-token");
  const firstPort = await first.start(), otherPort = await other.start();
  for (const addon of [first, other]) for (const [m, result] of Object.entries({ "game.run": { running: true }, "game.stop": { stopped: true }, "logs.read": { entries: [], next: 1 } })) {
    addon.handlers.set(m, () => ({ ok: true, result }));
  }
  let marker!: () => void;
  const entered = new Promise<void>((r) => { marker = r; });
  first.handlers.set("game.call", () => { marker(); return { ok: true, result: { returned: true } }; });
  const conn = new GodotConnection({ projectPath: a, projectsRoots: [root], readSession: (p) => ({ port: p === a ? firstPort : otherPort, token: p === a ? first.token : other.token, protocol: 1, pid: process.pid }) });
  const client = await connectClient(conn);
  let run: ReturnType<typeof client.callTool> | undefined;
  try {
    run = client.callTool({ name: "scenario_run", arguments: { scenario: { name: "lease", steps: [{ call: { node: ".", method: "marker" } }, { wait_ms: 500 }] }, save_to: "res://qa/lease" } });
    await entered;
    await conn.call("ping"); // the preceding step has replied; the scenario is now in its no-RPC wait
    const rejected = await client.callTool({ name: "project_connect", arguments: { path: b } });
    expect(rejected.isError, textOf(rejected)).toBe(true);
    expect(textOf(rejected)).toContain("BUSY");
    expect(conn.projectPath).toBe(a);
    expect(other.received).toHaveLength(0);
    expect(textOf(await run)).toContain("PASSED");
    expect(existsSync(join(a, "qa/lease/report.json"))).toBe(true);
    expect(existsSync(join(b, "qa"))).toBe(false);
    const switched = await client.callTool({ name: "project_connect", arguments: { path: b } });
    expect(switched.isError, textOf(switched)).toBeFalsy();
    expect(conn.projectPath).toBe(b);
  } finally {
    await run?.catch(() => {}); await client.close(); conn.close(); await first.stop(); await other.stop(); rmSync(root, { recursive: true, force: true });
  }
});

it.each(["already_running", "starting", "final_status"] as const)("pins the whole editor_launch request during %s", async (stage) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gml-launch-lease-")));
  const a = join(root, "a"), b = join(root, "b");
  for (const p of [a, b]) { mkdirSync(p); writeFileSync(join(p, "project.godot"), "config_version=5\n"); }
  const first = new FakeAddon(), other = new FakeAddon("other-synthetic-token");
  const firstPort = await first.start(), otherPort = await other.start();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => { enter = r; });
  const gate = new Promise<void>((r) => { release = r; });
  let published = stage === "already_running";
  for (const [addon, name] of [[first, "A"], [other, "B"]] as const) addon.handlers.set("editor.status", () => ({ ok: true, result: { project_name: name, playing: false } }));
  if (stage !== "starting") first.handlers.set("editor.status", async () => { enter(); await gate; return { ok: true, result: { project_name: "A", playing: false } }; });
  const conn = new GodotConnection({ projectPath: a, projectsRoots: [root], readSession: (p) => {
    if (p === a && !published) throw new BridgeError("GODOT_NOT_RUNNING", "Synthetic editor has not published yet");
    return { port: p === a ? firstPort : otherPort, token: p === a ? first.token : other.token, protocol: 1, pid: process.pid };
  } });
  const launcher = new EditorLauncher();
  launcher.launch = async () => {
    if (stage === "starting") return conn.withProjectLease(async () => { enter(); await gate; published = true; return { pid: process.pid, godot: { path: "/synthetic/godot", version: "4.7.2.stable", source: "PATH" }, log: join(a, "editor.log") }; });
    published = true;
    return { pid: process.pid, godot: { path: "/synthetic/godot", version: "4.7.2.stable", source: "PATH" }, log: join(a, "editor.log") };
  };
  const client = await connectClient(conn, { launcher });
  let run: ReturnType<typeof client.callTool> | undefined;
  try {
    run = client.callTool({ name: "editor_launch", arguments: {} });
    await entered;
    const refused = await client.callTool({ name: "project_connect", arguments: { path: b } });
    expect(refused.isError, textOf(refused)).toBe(true);
    expect(textOf(refused)).toContain("BUSY");
    expect(conn.projectPath).toBe(a);
    expect(other.received).toHaveLength(0);
    release();
    const result = await run;
    expect(result.isError, textOf(result)).toBeFalsy();
    expect(jsonOf(result)).toMatchObject({ project_path: a, project_name: "A" });
    const switched = await client.callTool({ name: "project_connect", arguments: { path: b } });
    expect(switched.isError, textOf(switched)).toBeFalsy();
    expect(conn.projectPath).toBe(b);
  } finally {
    release(); await run?.catch(() => {}); await client.close(); conn.close(); await first.stop(); await other.stop(); rmSync(root, { recursive: true, force: true });
  }
});

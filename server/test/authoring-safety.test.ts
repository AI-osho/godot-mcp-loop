import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GodotConnection } from "../src/connection.js";
import { runWorker } from "../src/authoring/worker.js";
import { encodePng } from "../src/media/png.js";
import { connectClient, jsonOf, textOf } from "./helpers.js";

const brief = { title: "Test", goal: "Test", controls: "Keys", art_direction: "Separate original art",
  scenes: [{ id: "scene", description: "Scene", assets: ["actor"] }], assets: [{ id: "actor", role: "character", description: "Actor", references: [] }] };
const pose = { id: "actor", source: "res://source.png", fit: "pose", key: "none", frame_size: [12, 16], foot_anchor: [6, 14], target_height: 8 };
const names = ["production_plan", "art_request", "art_register", "asset_build", "asset_preview", "asset_verify", "asset_scene_add"];

describe("production boundaries", () => {
  let project: string, conn: GodotConnection, client: Client;
  beforeEach(async () => {
    project = realpathSync(mkdtempSync(join(tmpdir(), "gml-art-safety-")));
    writeFileSync(join(project, "source.png"), encodePng({ width: 8, height: 12, data: new Uint8Array(8 * 12 * 4).fill(255) }));
    conn = new GodotConnection({ projectPath: project }); client = await connectClient(conn);
  });
  afterEach(async () => { vi.restoreAllMocks(); await client?.close(); conn?.close(); rmSync(project, { recursive: true, force: true }); });
  async function build(id: string, assets: object[] = [pose]): Promise<any> {
    const r = await client.callTool({ name: "asset_build", arguments: { output_root: `res://assets/generated/${id}`, recipe: { version: 1, assets } } });
    expect(r.isError, textOf(r)).toBeFalsy(); return jsonOf(r);
  }

  it.each(names)("%s declares strict typed input and safe annotations", async (name) => {
    const tool = (await client.listTools()).tools.find((t) => t.name === name)!;
    expect(tool).toBeDefined(); expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(tool.annotations).toMatchObject({ destructiveHint: false, openWorldHint: false, readOnlyHint: ["asset_verify", "asset_preview"].includes(name) });
    const wrong = await client.callTool({ name, arguments: { unexpected: "do not silently ignore this" } });
    expect(wrong.isError).toBe(true); expect(textOf(wrong)).toMatch(/Unrecognized key/);
  });

  it.each(["res://../escape.json", "res://nested/../../escape.json", "res://.GIT/keep.json", "res://.Godot/keep.json", "res://Addons/mcp_loop/keep.json", "res://.ClAuDe/keep.json", "res://.github/keep.json", "res://node_modules/keep.json", "res://C:/escape.json"])("refuses protected/escaping record path %s", async (path) => {
    for (const dir of [".git", ".godot", "addons/mcp_loop", ".claude", ".github", "node_modules"]) mkdirSync(join(project, dir), { recursive: true });
    writeFileSync(join(project, ".git/keep.json"), "preserve");
    const r = await client.callTool({ name: "production_plan", arguments: { path, brief } });
    expect(r.isError).toBe(true); expect(textOf(r)).toMatch(/PATH_FORBIDDEN/);
    expect(readFileSync(join(project, ".git/keep.json"), "utf8")).toBe("preserve");
  });

  it.skipIf(process.platform === "win32")("refuses symlinked sources and record destinations", async () => {
    mkdirSync(join(project, "real")); symlinkSync(join(project, "real"), join(project, "alias"));
    const plan = await client.callTool({ name: "production_plan", arguments: { path: "res://alias/plan.json", brief } });
    expect(plan.isError).toBe(true); expect(existsSync(join(project, "real/plan.json"))).toBe(false);
    symlinkSync(join(project, "source.png"), join(project, "linked.png"));
    const source = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/link", recipe: { version: 1, assets: [{ ...pose, source: "res://linked.png" }] } } });
    expect(source.isError).toBe(true); expect(textOf(source)).toMatch(/PATH_FORBIDDEN/);
    expect(existsSync(join(project, "assets"))).toBe(false);
  });

  it("the real Python boundary also rejects traversal when called without the server path precheck", async () => {
    await expect(runWorker(project, "inspect", { png: "res://../outside.png" })).rejects.toMatchObject({ code: "PATH_FORBIDDEN" });
  });

  it("preserves existing output folders and records, including dry-run", async () => {
    await client.callTool({ name: "production_plan", arguments: { path: "res://plan.json", brief } });
    const original = readFileSync(join(project, "plan.json"));
    for (const dry_run of [false, true]) {
      const r = await client.callTool({ name: "production_plan", arguments: { path: "res://plan.json", brief: { ...brief, goal: "Different" }, dry_run } });
      expect(r.isError).toBe(true); expect(textOf(r)).toMatch(/ALREADY_EXISTS/);
    }
    expect(readFileSync(join(project, "plan.json"))).toEqual(original);
    await build("once"); const image = readFileSync(join(project, "assets/generated/once/actor.png"));
    const r = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/once", recipe: { version: 1, assets: [pose] } } });
    expect(r.isError).toBe(true); expect(textOf(r)).toMatch(/ALREADY_EXISTS/);
    expect(readFileSync(join(project, "assets/generated/once/actor.png"))).toEqual(image);
  });

  it.each([
    { ...pose, crop: [0, 0, 9, 12] },
    { ...pose, key: "magenta", crop: [0, 0, 8, 12] },
    { ...pose, target_height: 100 },
  ])("rejects clipped/outside artwork before creating output directories: %j", async (asset) => {
    const r = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/bad", recipe: { version: 1, assets: [asset] } } });
    expect(r.isError).toBe(true); expect(existsSync(join(project, "assets"))).toBe(false);
  });

  it("rejects an output frame above the per-PNG pixel limit before publishing a completed build", async () => {
    const r = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/framepixels", recipe: { version: 1,
      assets: [{ ...pose, frame_size: [4096, 4096] }],
    } } });
    expect(r.isError, textOf(r)).toBe(true);
    expect(textOf(r)).toMatch(/pixel/i);
    expect(existsSync(join(project, "assets"))).toBe(false);
  });

  it("rejects non-PNG bytes rather than trusting the filename", async () => {
    writeFileSync(join(project, "not.png"), "not a PNG");
    const r = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/badpng", recipe: { version: 1, assets: [{ ...pose, source: "res://not.png" }] } } });
    expect(r.isError).toBe(true); expect(textOf(r)).toMatch(/INVALID_IMAGE/); expect(existsSync(join(project, "assets"))).toBe(false);
  });

  it("stops an oversized build-directory inventory with one bounded limit failure", async () => {
    const made = await build("inventory");
    const dir = join(project, "assets/generated/inventory");
    for (let i = 0; i < 300; i++) writeFileSync(join(dir, `unexpected-${i}.txt`), "");
    const r = await client.callTool({ name: "asset_verify", arguments: { manifest: made.manifest } });
    expect(r.isError, textOf(r)).toBeFalsy(); const checked = jsonOf(r);
    expect(checked.passed).toBe(false);
    expect(checked.failures.length).toBeLessThanOrEqual(257);
    expect(checked.failures.join(" ")).toMatch(/directory.*256.*limit/i);
    expect(existsSync(join(dir, "unexpected-299.txt"))).toBe(true);
  });

  it("detects changed sources and unexpected output files without rewriting them", async () => {
    const made = await build("changed");
    appendFileSync(join(project, "source.png"), "changed");
    writeFileSync(join(project, "assets/generated/changed/unexpected.txt"), "do not delete me");
    const r = await client.callTool({ name: "asset_verify", arguments: { manifest: made.manifest } });
    expect(r.isError, textOf(r)).toBeFalsy(); expect(jsonOf(r).passed).toBe(false);
    expect(jsonOf(r).failures.join(" ")).toMatch(/source.png changed/); expect(jsonOf(r).failures.join(" ")).toMatch(/Unexpected build entry/);
    expect(readFileSync(join(project, "assets/generated/changed/unexpected.txt"), "utf8")).toBe("do not delete me");
  });

  it("refuses preview of a changed artifact and an out-of-range atlas frame", async () => {
    const made = await build("previewguard");
    const frame = await client.callTool({ name: "asset_preview", arguments: { manifest: made.manifest, asset_id: "actor", frame: 1 } });
    expect(frame.isError).toBe(true); expect(textOf(frame)).toMatch(/Frame index/);
    appendFileSync(join(project, "assets/generated/previewguard/actor.png"), "changed");
    const changed = await client.callTool({ name: "asset_preview", arguments: { manifest: made.manifest, asset_id: "actor" } });
    expect(changed.isError).toBe(true); expect(textOf(changed)).toMatch(/ARTIFACT_CHANGED/);
  });

  it.each(["pillow", "python"])("refuses a changed recorded %s environment even with a controlled forged checksum", async (field) => {
    const made = await build("environment");
    const path = join(project, "assets/generated/environment/manifest.json");
    const doc = JSON.parse(readFileSync(path, "utf8")); doc.toolchain[field] = "0.0-test";
    const bytes = Buffer.from(JSON.stringify(doc)); writeFileSync(path, bytes);
    // Deliberately forge only this test copy's checksum to reach the inner environment guard.
    const seal = join(project, "assets/generated/environment/manifest.sha256");
    chmodSync(seal, 0o600); writeFileSync(seal, createHash("sha256").update(bytes).digest("hex") + "\n");
    const r = await client.callTool({ name: "asset_verify", arguments: { manifest: made.manifest } });
    expect(r.isError, textOf(r)).toBeFalsy(); expect(jsonOf(r).passed).toBe(false);
    expect(jsonOf(r).failures.join(" ")).toMatch(new RegExp(field, "i"));
  });

  it.skipIf(process.platform === "win32").each(["0.0-test", "12.3.0"])("refuses the unsupported Pillow %s runtime rather than merely recording it", async (version) => {
    const python = execFileSync("python3", ["-B", "-E", "-c", "import sys;print(sys.executable)"], { encoding: "utf8" }).trim();
    expect(python).not.toMatch(/\s/); // this fixture uses an absolute interpreter shebang
    const wrapper = join(project, "controlled-python");
    writeFileSync(wrapper, `#!${python} -B\nimport PIL,PIL.Image,runpy,sys,os\nPIL.__version__=${JSON.stringify(version)}\nworker=sys.argv[-1]\nsys.path.insert(0,os.path.dirname(worker))\nrunpy.run_path(worker,run_name="__main__")\n`, { mode: 0o700 });
    const old = process.env.GODOT_LOOP_PYTHON; process.env.GODOT_LOOP_PYTHON = wrapper;
    try {
      const r = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/wrongversion", recipe: { version: 1, assets: [pose] } } });
      expect(r.isError, textOf(r)).toBe(true); expect(textOf(r)).toMatch(/DEPENDENCY_MISSING/);
      expect(existsSync(join(project, "assets"))).toBe(false);
    } finally { if (old === undefined) delete process.env.GODOT_LOOP_PYTHON; else process.env.GODOT_LOOP_PYTHON = old; }
  });

  it.skipIf(process.platform === "win32")("rejects the retired Python 3.10 floor before inspecting or publishing artwork", async () => {
    const python = execFileSync("python3", ["-B", "-E", "-c", "import sys;print(sys.executable)"], { encoding: "utf8" }).trim();
    const wrapper = join(project, "controlled-legacy-python");
    writeFileSync(wrapper, `#!${python} -B\nimport PIL,PIL.Image,runpy,sys,os\nworker=sys.argv[-1]\nsys.path.insert(0,os.path.dirname(worker))\nsys.version_info=(3,10,0)\nrunpy.run_path(worker,run_name="__main__")\n`, { mode: 0o700 });
    const old = process.env.GODOT_LOOP_PYTHON; process.env.GODOT_LOOP_PYTHON = wrapper;
    try {
      const r = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/legacypython", recipe: { version: 1, assets: [pose] } } });
      expect(r.isError, textOf(r)).toBe(true); expect(textOf(r)).toMatch(/Python 3\.11/);
      expect(existsSync(join(project, "assets"))).toBe(false);
    } finally { if (old === undefined) delete process.env.GODOT_LOOP_PYTHON; else process.env.GODOT_LOOP_PYTHON = old; }
  });

  it("recovers on the same server after a real missing-executable failure", async () => {
    const old = process.env.GODOT_LOOP_PYTHON; process.env.GODOT_LOOP_PYTHON = "/missing-art-python";
    try { await expect(runWorker(project, "inspect", { png: "res://source.png" })).rejects.toMatchObject({ code: "DEPENDENCY_MISSING" }); }
    finally { if (old === undefined) delete process.env.GODOT_LOOP_PYTHON; else process.env.GODOT_LOOP_PYTHON = old; }
    await expect(runWorker(project, "inspect", { png: "res://source.png" })).resolves.toMatchObject({ width: 8, height: 12 });
  });

  it("cancels an actual worker, releases its project lease and permits a later retry", async () => {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 5);
    try { await expect(runWorker(project, "build", { output_root: "res://assets/generated/cancelled", recipe: { version: 1, assets: [pose] } }, controller.signal)).rejects.toMatchObject({ code: "CANCELLED" }); }
    finally { clearTimeout(timer); }
    await expect(runWorker(project, "inspect", { png: "res://source.png" })).resolves.toMatchObject({ width: 8 });
  });

  it("kills a real worker when its operational watchdog fires and recovers", async () => {
    const original = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => original(fn, delay === 120000 ? 1 : delay, ...args)) as typeof setTimeout);
    await expect(runWorker(project, "build", { output_root: "res://assets/generated/watchdog", recipe: { version: 1, assets: [pose] } })).rejects.toMatchObject({ code: "TIMEOUT" });
    vi.restoreAllMocks();
    await expect(runWorker(project, "inspect", { png: "res://source.png" })).resolves.toMatchObject({ height: 12 });
  });
  it("reports truthful elapsed-time heartbeats when the MCP caller requests progress", async () => {
    const original = globalThis.setInterval;
    vi.spyOn(globalThis, "setInterval").mockImplementation(((fn: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => original(fn, delay === 2000 ? 5 : delay, ...args)) as typeof setInterval);
    const progress: number[] = [];
    const result = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/progress", recipe: { version: 1, assets: [pose] } } }, undefined,
      { onprogress: (event) => progress.push(event.progress) });
    expect(result.isError, textOf(result)).toBeFalsy();
    expect(progress.some((v) => v > 0)).toBe(true);
  });
});

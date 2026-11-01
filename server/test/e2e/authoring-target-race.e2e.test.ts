import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as artworkWorker from "../../src/authoring/worker.js";
import { encodePng } from "../../src/media/png.js";
import { connectClient, textOf } from "../helpers.js";
import { startHeadlessEditor, type GodotHarness } from "./godot-harness.js";

// Controlled scheduling fixture: only the isolated addon's import wait is delayed.
// Validation, target selection, native editing and undo remain the production code.
// This is not evidence that a default import always races.
describe("e2e: artwork target freshness during an import wait", () => {
  let h: GodotHarness, client: Client;
  async function ok(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
    expect(r.isError, `${name}: ${textOf(r)}`).toBeFalsy();
    return JSON.parse(textOf(r));
  }
  beforeAll(async () => {
    const signature = "func _wait_until_importable(path: String, timeout_ms: int = 15000) -> bool:\n";
    const original = readFileSync(new URL("../../../addons/mcp_loop/commands/asset_commands.gd", import.meta.url), "utf8");
    expect(original.split(signature)).toHaveLength(2);
    const delayed = original.replace(signature, signature + '\tprint("AUTHORING_CONTROLLED_IMPORT_WAIT")\n\tawait (Engine.get_main_loop() as SceneTree).create_timer(1.0).timeout\n');
    h = await startHeadlessEditor({ extraFiles: { "addons/mcp_loop/commands/asset_commands.gd": delayed } });
    client = await connectClient(h.conn);
    writeFileSync(join(h.projectPath, "source.png"), encodePng({ width: 8, height: 12, data: new Uint8Array(8 * 12 * 4).fill(255) }));
  });
  afterAll(async () => { await client?.close(); await h?.stop(); });

  it("binds the scene before the actual worker verification wait", async () => {
    const built = await ok("asset_build", { output_root: "res://assets/generated/beforeworker", recipe: { version: 1,
      assets: [{ id: "actor", source: "res://source.png", key: "none", fit: "copy" }],
    } });
    await ok("scene_create", { path: "res://before-worker-a.tscn", root_type: "Node2D", root_name: "WorkerA" });
    let reached!: () => void, release!: () => void;
    const reachedWorker = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const realWorker = artworkWorker.runWorker;
    const spy = vi.spyOn(artworkWorker, "runWorker").mockImplementation(async (...args) => {
      const result = await realWorker(...args); // Real Python/Pillow verification, only delivery is delayed.
      if (args[1] === "verify") { reached(); await gate; }
      return result;
    });
    try {
      const pending = client.callTool({ name: "asset_scene_add", arguments: { manifest: built.manifest,
        name: "WrongScene", placements: [{ asset_id: "actor", name: "Actor", position: [0, 0] }],
      } }, undefined, { timeout: 180000 });
      await reachedWorker;
      await ok("scene_create", { path: "res://before-worker-b.tscn", root_type: "Node2D", root_name: "WorkerB" });
      release();
      const response = await pending;
      expect(response.isError, textOf(response)).toBe(true);
      expect(textOf(response)).toMatch(/target.*changed|scene.*changed/i);
      expect(JSON.stringify(await ok("scene_tree"))).not.toContain("WrongScene");
      await ok("scene_open", { path: "res://before-worker-a.tscn" });
      expect(JSON.stringify(await ok("scene_tree"))).not.toContain("WrongScene");
    } finally { release(); spy.mockRestore(); }
  });

  it("refuses a scene switch while importing instead of editing the no-longer-selected scene", async () => {
    const built = await ok("asset_build", { output_root: "res://assets/generated/freshness", recipe: { version: 1,
      assets: [{ id: "actor", source: "res://source.png", key: "none", fit: "copy" }],
    } });
    await ok("scene_create", { path: "res://original.tscn", root_type: "Node2D", root_name: "Original" });
    const start = h.output.length;
    const pending = client.callTool({ name: "asset_scene_add", arguments: { manifest: built.manifest,
      name: "MustNotBeAdded", placements: [{ asset_id: "actor", name: "Actor", position: [0, 0] }],
    } }, undefined, { timeout: 180000 });
    const deadline = Date.now() + 15000;
    while (!h.output.slice(start).some(x => x.includes("AUTHORING_CONTROLLED_IMPORT_WAIT")) && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 10));
    }
    expect(h.output.slice(start).some(x => x.includes("AUTHORING_CONTROLLED_IMPORT_WAIT")), "native import wait was reached").toBe(true);
    await ok("scene_create", { path: "res://selected.tscn", root_type: "Node2D", root_name: "Selected" });
    const response = await pending;
    expect(response.isError, textOf(response)).toBe(true);
    expect(textOf(response)).toMatch(/scene.*changed|target.*changed/i);
    expect(JSON.stringify(await ok("scene_tree"))).not.toContain("MustNotBeAdded");
    await ok("scene_open", { path: "res://original.tscn" });
    expect(JSON.stringify(await ok("scene_tree"))).not.toContain("MustNotBeAdded");
    expect((await ok("asset_verify", { manifest: built.manifest })).passed).toBe(true);
  });
  it("refuses PNG bytes replaced during import even when dimensions and byte length stay the same", async () => {
    const initial = new Uint8Array(8 * 12 * 4);
    for (let i = 0; i < initial.length; i += 4) initial.set([20, 80, 170, 255], i);
    writeFileSync(join(h.projectPath, "swappable.png"), encodePng({ width: 8, height: 12, data: initial }));
    const built = await ok("asset_build", { output_root: "res://assets/generated/pngswap", recipe: { version: 1,
      assets: [{ id: "actor", source: "res://swappable.png", key: "none", fit: "copy" }],
    } });
    await ok("scene_create", { path: "res://pngswap.tscn", root_type: "Node2D" });
    const pngPath = join(h.projectPath, "assets/generated/pngswap/actor.png");
    const original = readFileSync(pngPath);
    let replacement: Buffer | undefined;
    for (let r = 0; r < 255 && !replacement; r++) {
      const pixels = new Uint8Array(initial);
      for (let i = 0; i < pixels.length; i += 4) pixels[i] = r;
      const candidate = encodePng({ width: 8, height: 12, data: pixels });
      if (candidate.length === original.length && !candidate.equals(original)) replacement = candidate;
    }
    expect(replacement, "controlled same-size PNG replacement exists").toBeDefined();
    const start = h.output.length;
    const pending = client.callTool({ name: "asset_scene_add", arguments: { manifest: built.manifest,
      name: "ChangedPixels", placements: [{ asset_id: "actor", name: "Actor", position: [0, 0] }],
    } }, undefined, { timeout: 180000 });
    const deadline = Date.now() + 15000;
    while (!h.output.slice(start).some(x => x.includes("AUTHORING_CONTROLLED_IMPORT_WAIT")) && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
    expect(h.output.slice(start).some(x => x.includes("AUTHORING_CONTROLLED_IMPORT_WAIT"))).toBe(true);
    writeFileSync(pngPath, replacement!);
    const response = await pending;
    expect(response.isError, textOf(response)).toBe(true); expect(textOf(response)).toMatch(/PNG.*changed|digest/i);
    expect(JSON.stringify(await ok("scene_tree"))).not.toContain("ChangedPixels");
    expect(readFileSync(pngPath)).toEqual(replacement);
  });

  it("refuses a group-name collision introduced during import without silently renaming", async () => {
    const built = await ok("asset_build", { output_root: "res://assets/generated/namecollision", recipe: { version: 1,
      assets: [{ id: "actor", source: "res://source.png", key: "none", fit: "copy" }],
    } });
    await ok("scene_create", { path: "res://collision.tscn", root_type: "Node2D" });
    const start = h.output.length;
    const pending = client.callTool({ name: "asset_scene_add", arguments: { manifest: built.manifest,
      name: "Collision", placements: [{ asset_id: "actor", name: "Actor", position: [0, 0] }],
    } }, undefined, { timeout: 180000 });
    const deadline = Date.now() + 15000;
    while (!h.output.slice(start).some(x => x.includes("AUTHORING_CONTROLLED_IMPORT_WAIT")) && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 10));
    }
    expect(h.output.slice(start).some(x => x.includes("AUTHORING_CONTROLLED_IMPORT_WAIT"))).toBe(true);
    await ok("node_add", { type: "Node2D", name: "Collision" });
    const response = await pending;
    expect(response.isError, textOf(response)).toBe(true);
    expect(textOf(response)).toMatch(/ALREADY_EXISTS/);
    expect(JSON.stringify(await ok("scene_tree"))).not.toContain('"name":"Actor"');
    expect((await ok("node_get", { path: "Collision" })).type).toBe("Node2D");
  });
});

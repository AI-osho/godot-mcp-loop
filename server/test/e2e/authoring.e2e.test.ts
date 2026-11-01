import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodePng } from "../../src/media/png.js";
import { connectClient, textOf } from "../helpers.js";
import { startHeadlessEditor, type GodotHarness } from "./godot-harness.js";

describe("e2e: artwork build to native scene", () => {
  let h: GodotHarness, client: Client, manifest: string;
  async function ok(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
    expect(r.isError, `${name}: ${textOf(r)}`).toBeFalsy();
    return JSON.parse(textOf(r));
  }
  beforeAll(async () => {
    h = await startHeadlessEditor({ projectGodotExtra: '[editor]\nrun/main_run_args="--headless"\n' }); client = await connectClient(h.conn);
    writeFileSync(join(h.projectPath, "source.png"), encodePng({ width: 8, height: 12, data: new Uint8Array(8 * 12 * 4).fill(255) }));
    const brief = { title: "Native artwork fixture", goal: "Registered PNG to undoable scene", controls: "Right and E", art_direction: "Synthetic test PNG, no image generation",
      scenes: [{ id: "scene", description: "Fixture", assets: ["actor"] }], assets: [{ id: "actor", role: "character", description: "Synthetic PNG", references: [] }] };
    await ok("production_plan", { path: "res://production/plan.json", brief });
    await ok("art_request", { plan: "res://production/plan.json", asset_id: "actor", path: "res://production/request.json" });
    await ok("art_register", { request: "res://production/request.json", png: "res://source.png", path: "res://production/accepted.json", decision: "accepted", notes: "Synthetic test PNG from encodePng, not a newly generated illustration." });
    const built = await ok("asset_build", { output_root: "res://assets/generated/native", recipe: { version: 1,
      assets: [{ id: "actor", source: "res://source.png", art_record: "res://production/accepted.json", key: "none", fit: "pose", frame_size: [12, 16], foot_anchor: [6, 14], target_height: 8 }],
    } });
    manifest = built.manifest;
    await ok("scene_create", { path: "res://artwork.tscn", root_type: "Node2D", root_name: "ArtTest" });
  });
  afterAll(async () => { await client?.close(); await h?.stop(); });

  it("adds real PNG artwork with an explicit foot anchor then saves and undoes only the new group", async () => {
    const result = await ok("asset_scene_add", { manifest, name: "Artwork", placements: [{ asset_id: "actor", name: "Actor", position: [160, 200] }] });
    expect(result.path).toBe("Artwork");
    const props = await ok("node_get", { path: "Artwork/Actor", properties: ["position", "offset", "centered", "texture_filter"] });
    expect(props.properties).toMatchObject({ position: [160, 200], offset: [-6, -14], centered: false, texture_filter: 1 });
    await ok("scene_save");
    const scene = readFileSync(join(h.projectPath, "artwork.tscn"), "utf8");
    expect(scene).toContain("actor.png"); expect(scene).toContain('name="Actor"');
    await ok("edit_undo");
    expect(JSON.stringify(await ok("scene_tree"))).not.toContain('"name":"Artwork"');
    const checked = await ok("asset_verify", { manifest }); expect(checked.passed).toBe(true);
  });
  it("creates a native SpriteFrames atlas with the requested frame and persists it across scene reopen", async () => {
    const pixels = new Uint8Array(8 * 12 * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([20, 120, 220, 128], i);
    writeFileSync(join(h.projectPath, "blue.png"), encodePng({ width: 8, height: 12, data: pixels }));
    const built = await ok("asset_build", { output_root: "res://assets/generated/animated", recipe: { version: 1,
      assets: [{ id: "idle", source: "res://source.png", key: "none", fit: "copy", export: false, foot_anchor: [4, 12] },
        { id: "loaded", source: "res://blue.png", key: "none", fit: "copy", export: false, foot_anchor: [4, 12] }],
      atlases: [{ id: "robot", frames: ["idle", "loaded"], fps: 4, loop: false }],
    } });
    await ok("asset_scene_add", { manifest: built.manifest, name: "Animation", placements: [{ asset_id: "robot", name: "Robot", position: [300, 220], frame: 1, scale: 2, z_index: 4 }] });
    const props = await ok("node_get", { path: "Animation/Robot", properties: ["position", "offset", "frame", "scale", "z_index", "autoplay"] });
    expect(props.type).toBe("AnimatedSprite2D");
    expect(props.properties).toMatchObject({ offset: [-4, -12], frame: 1, scale: [2, 2], z_index: 4, autoplay: "" });
    await ok("scene_save");
    expect(readFileSync(join(h.projectPath, "artwork.tscn"), "utf8")).toContain('type="SpriteFrames"');
    await ok("scene_create", { path: "res://another.tscn", root_type: "Node2D" });
    await ok("scene_open", { path: "res://artwork.tscn" });
    expect((await ok("node_get", { path: "Animation/Robot", properties: ["frame", "offset"] })).properties).toMatchObject({ frame: 1, offset: [-4, -12] });
  });
  it("dry-run does not add nodes or consume an undo entry", async () => {
    await ok("node_add", { type: "Node2D", name: "KeepUntilUndo" });
    const result = await ok("asset_scene_add", { manifest, name: "DryArtwork", placements: [{ asset_id: "actor", name: "Actor", position: [20, 30] }], dry_run: true });
    expect(result.dry_run).toBe(true);
    expect(JSON.stringify(await ok("scene_tree"))).not.toContain('"name":"DryArtwork"');
    await ok("edit_undo");
    expect(JSON.stringify(await ok("scene_tree"))).not.toContain('"name":"KeepUntilUndo"');
  });

  it("validates every placement before adding any scene nodes", async () => {
    const before = await ok("scene_tree");
    const result = await client.callTool({ name: "asset_scene_add", arguments: { manifest, name: "Partial", placements: [
      { asset_id: "actor", name: "First", position: [20, 30] }, { asset_id: "actor", name: "WrongFrame", position: [40, 30], frame: 1 },
    ] } });
    expect(result.isError).toBe(true); expect(textOf(result)).toMatch(/Frame index/);
    expect(await ok("scene_tree")).toEqual(before);
  });

  it("rejects a forged PNG hash at the native boundary before adding a group", async () => {
    const doc = JSON.parse(readFileSync(join(h.projectPath, "assets/generated/native/manifest.json"), "utf8"));
    const before = await ok("scene_tree");
    await expect(h.conn.call("asset.scene_add", { name: "Forged", assets: [{ ...doc.outputs[0], sha256: "0".repeat(64) }], placements: [{ asset_id: "actor", name: "Actor", position: [0, 0] }] })).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    expect(await ok("scene_tree")).toEqual(before);
  });

  it("runs saved imported artwork through ordinary key input in a fresh game process", async () => {
    const source = `extends Node2D
@export var right_presses: int = 0
@export var right_releases: int = 0
func _input(event: InputEvent) -> void:
\tif event is InputEventKey and not event.echo:
\t\tif event.physical_keycode == KEY_RIGHT:
\t\t\tif event.pressed: right_presses += 1
\t\t\telse: right_releases += 1
\t\telif event.physical_keycode == KEY_E and event.pressed:
\t\t\t$Animation/Robot.frame = 1 - $Animation/Robot.frame
func _physics_process(delta: float) -> void:
\tif Input.is_action_pressed("art_move_right"):
\t\t$Animation/Robot.position.x += 120.0 * delta
`;
    await ok("script_write", { path: "res://move_art.gd", content: source });
    await ok("script_attach", { node: ".", script: "res://move_art.gd" });
    await ok("input_action_set", { name: "art_move_right", keys: ["Right"] });
    await ok("scene_save");
    await ok("game_run", { scene: "res://artwork.tscn" });
    try {
      const before = await ok("game_query", { node: "Animation/Robot", properties: ["position", "frame"] });
      expect(before.properties.frame).toBe(1);
      await ok("game_input", { steps: [{ key: "Right", hold_frames: 12 }, { key: "E", hold_frames: 1 }, { wait_frames: 2 }], pause_at_end: true });
      const after = await ok("game_query", { node: "Animation/Robot", properties: ["position", "frame"] });
      expect(after.properties.position[0]).toBeGreaterThan(before.properties.position[0]);
      expect(after.properties.position[1]).toBe(before.properties.position[1]);
      expect(after.properties.frame).toBe(0);
      const received = await ok("game_query", { properties: ["right_presses", "right_releases"] });
      expect(received.properties).toMatchObject({ right_presses: 1, right_releases: 1 });
    } finally { await ok("game_stop"); }
  });

});

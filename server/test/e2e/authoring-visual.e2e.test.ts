import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { decodePng } from "../../src/media/png.js";
import { connectClient, textOf } from "../helpers.js";
import { startHeadlessEditor, type GodotHarness, WINDOWED } from "./godot-harness.js";

/** Optional private real-art fixture: source-art/, recipe.json, visual.json. No artwork is shipped by this test. */
it.skipIf(!WINDOWED || !process.env.GODOT_LOOP_ART_FIXTURE)("real artwork renders and responds to ordinary keys in a native game window", async () => {
  const fixture = process.env.GODOT_LOOP_ART_FIXTURE!;
  const evidence = process.env.GODOT_LOOP_ART_EVIDENCE!;
  expect(evidence).toBeTruthy(); mkdirSync(evidence, { recursive: true });
  const spec = JSON.parse(readFileSync(join(fixture, "visual.json"), "utf8"));
  const recipe = JSON.parse(readFileSync(join(fixture, "recipe.json"), "utf8"));
  let h: GodotHarness | undefined, client: Client | undefined;
  const receipts: Array<{ tool: string; result: unknown }> = [];
  async function ok(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const response = await client!.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
    expect(response.isError, `${name}: ${textOf(response)}`).toBeFalsy();
    const result = JSON.parse(textOf(response)); receipts.push({ tool: name, result }); return result;
  }
  try {
    h = await startHeadlessEditor({ copyFrom: [{ from: join(fixture, "source-art"), to: "source-art" }], projectGodotExtra:
      '[rendering]\nrenderer/rendering_method="gl_compatibility"\nrenderer/rendering_method.mobile="gl_compatibility"\n' });
    client = await connectClient(h.conn);
    await ok("project_setting_set", { key: "application/config/name", value: "MCP素材制作連携・動作検証" });
    for (const [key, value] of Object.entries({ "display/window/size/viewport_width": spec.width, "display/window/size/viewport_height": spec.height,
      "display/window/size/window_width_override": spec.width, "display/window/size/window_height_override": spec.height })) await ok("project_setting_set", { key, value });
    await ok("scene_create", { path: "res://verification.tscn", root_type: "Node2D", root_name: "ArtworkVerification" });
    const built = await ok("asset_build", { output_root: "res://assets/generated/visual", recipe });
    await ok("asset_scene_add", { manifest: built.manifest, name: "Artwork", placements: spec.placements });
    await ok("node_add", { type: "Label", name: "Explanation", properties: { position: [20, 10], text: "MCP素材連携の動作検証（ゲーム本編ではありません）\n通常キー：右＝移動、E＝状態差分、Q＝正常終了", mouse_filter: 2 } });
    const target = JSON.stringify(spec.movable);
    const source = `extends Node2D\n@export var right_presses: int = 0\n@export var right_releases: int = 0\n@export var state_presses: int = 0\n@export var actual_unfocusable: bool = false\nfunc _ready() -> void:\n\tget_window().unfocusable = true\n\t_check_window.call_deferred()\nfunc _check_window() -> void:\n\tawait get_tree().process_frame\n\tactual_unfocusable = get_window().unfocusable\nfunc _input(event: InputEvent) -> void:\n\tif not event is InputEventKey or event.echo: return\n\tif event.physical_keycode == KEY_RIGHT:\n\t\tif event.pressed: right_presses += 1\n\t\telse: right_releases += 1\n\telif event.physical_keycode == KEY_E and event.pressed:\n\t\tstate_presses += 1\n\t\tget_node(${target}).frame = 1 - get_node(${target}).frame\n\telif event.physical_keycode == KEY_Q and event.pressed:\n\t\t_finish_normally.call_deferred()\nfunc _physics_process(delta: float) -> void:\n\tif Input.is_action_pressed("art_move_right"):\n\t\tget_node(${target}).position.x += 120.0 * delta\nfunc _finish_normally() -> void:\n\tawait get_tree().process_frame\n\tawait get_tree().process_frame\n\tprint("AUTHORING_FIXTURE_NORMAL_QUIT")\n\tget_tree().quit()\n`;
    await ok("script_write", { path: "res://verify_input.gd", content: source });
    await ok("script_attach", { node: ".", script: "res://verify_input.gd" });
    await ok("input_action_set", { name: "art_move_right", keys: ["Right"] });
    await ok("scene_save");
    await ok("game_run", { scene: "res://verification.tscn" });
    await ok("game_wait_for", { node: ".", property: "actual_unfocusable", op: "==", value: true, timeout_ms: 5000 });
    const before = await ok("game_query", { node: spec.movable, properties: ["position", "frame", "offset", "scale"] });
    const input = await ok("game_input", { steps: [{ key: "Right", hold_frames: 12 }, { key: "E", hold_frames: 1 }, { wait_frames: 2 }], pause_at_end: true,
      record: { node: spec.movable, properties: ["position:x", "frame"], per: "physics" } });
    const after = await ok("game_query", { node: spec.movable, properties: ["position", "frame", "offset", "scale"] });
    const received = await ok("game_query", { properties: ["right_presses", "right_releases", "state_presses", "actual_unfocusable"] });
    expect(after.properties.position[0]).toBeGreaterThan(before.properties.position[0]);
    expect(after.properties.position[1]).toBe(before.properties.position[1]);
    expect(after.properties.frame).toBe(1 - before.properties.frame);
    expect(received.properties).toMatchObject({ right_presses: 1, right_releases: 1, state_presses: 1, actual_unfocusable: true });
    const shot = await client.callTool({ name: "screenshot", arguments: { target: "game", max_width: spec.width, normalize: "viewport" } });
    expect(shot.isError, textOf(shot)).toBeFalsy();
    const image = (shot.content as Array<{ type: string; data?: string }>).find((c) => c.type === "image")!;
    const bytes = Buffer.from(image.data!, "base64"); const decoded = decodePng(bytes);
    expect([decoded.width, decoded.height]).toEqual([spec.width, spec.height]);
    writeFileSync(join(evidence, "native-artwork.png"), bytes);
    const errorsBeforeQuit = await ok("logs_read", { source: "game", min_level: "error", limit: 2000 });
    expect(errorsBeforeQuit.entries).toEqual([]);
    await ok("game_pause", { paused: false });
    const quitCall = await client.callTool({ name: "game_input", arguments: { steps: [{ key: "Q", hold_frames: 1 }] } });
    let status: any;
    for (let i = 0; i < 60; i++) {
      status = await ok("godot_status");
      if (!status.playing) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(status.playing).toBe(false);
    const log = await ok("logs_read", { source: "game", limit: 2000 });
    // Immediate native quit can end the debugger channel before its print relay drains.
    // The owned editor's captured child stdout is a second actual observation, not a synthetic marker.
    const quitInBridge = JSON.stringify(log).includes("AUTHORING_FIXTURE_NORMAL_QUIT");
    const quitInChildStdout = h.output.some((line) => line.trim() === "AUTHORING_FIXTURE_NORMAL_QUIT");
    expect(quitInBridge || quitInChildStdout).toBe(true);
    expect((await ok("asset_verify", { manifest: built.manifest })).passed).toBe(true);
    writeFileSync(join(evidence, "result.json"), JSON.stringify({ passed: true, kind: "tool integration fixture, not a new game or human playtest", viewport: [decoded.width, decoded.height], before, after, received, input,
      screenshot: "native-artwork.png", quit_call: quitCall, normal_quit_marker_observed: true, normal_quit_marker_source: quitInBridge ? "MCP game logs" : "owned child stdout", status_after_quit: status, receipts }, null, 2) + "\n");
  } finally {
    if (h) writeFileSync(join(evidence, "godot.log"), h.output.join("\n"));
    await client?.close(); await h?.stop();
  }
}, 180000);

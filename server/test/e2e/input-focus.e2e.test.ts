import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectClient, jsonOf, textOf } from "../helpers.js";
import { startHeadlessEditor, type GodotHarness } from "./godot-harness.js";

const WINDOWED = process.platform === "darwin" || process.env.E2E_GAME_WINDOW === "1";

const MAIN = `extends Node
var child_pid := -1

func focus_loss_probe() -> Dictionary:
	var ev := InputEventAction.new()
	ev.action = "focus_control"
	ev.pressed = true
	ev.strength = 1.0
	Input.parse_input_event(ev)
	Input.flush_buffered_events()
	var before := Input.is_action_pressed("focus_hold")
	var control_before := Input.is_action_pressed("focus_control")
	child_pid = OS.create_process(OS.get_executable_path(), PackedStringArray([
		"--path", ProjectSettings.globalize_path("res://"), "--script", "res://focus_child.gd",
		"--rendering-method", "gl_compatibility"]))
	await get_tree().create_timer(0.7, true).timeout
	var result := {"before":before, "control_before":control_before,
		"after":Input.is_action_pressed("focus_hold"), "control_after":Input.is_action_pressed("focus_control"),
		"child_started":child_pid > 0}
	if child_pid > 0 and OS.is_process_running(child_pid):
		OS.kill(child_pid)
	var deadline := Time.get_ticks_msec() + 2000
	while child_pid > 0 and OS.is_process_running(child_pid) and Time.get_ticks_msec() < deadline:
		await get_tree().process_frame
	result["child_exited"] = child_pid > 0 and not OS.is_process_running(child_pid)
	return result

func held() -> bool:
	return Input.is_action_pressed("focus_hold")

func _exit_tree() -> void:
	if child_pid > 0 and OS.is_process_running(child_pid):
		OS.kill(child_pid)
`;

const CHILD = `extends SceneTree
func _init() -> void:
	_show.call_deferred()
func _show() -> void:
	root.title = "MCP focus regression control"
	root.size = Vector2i(240, 140)
	root.grab_focus()
	await create_timer(1.5).timeout
	quit()
`;

describe.skipIf(!WINDOWED)("e2e: synthetic action ownership across application focus loss", () => {
  let h: GodotHarness;
  let client: Client;

  beforeAll(async () => {
    h = await startHeadlessEditor({
      projectGodotExtra: `[input]\nfocus_hold={"deadzone":0.2,"events":[]}\nfocus_control={"deadzone":0.2,"events":[]}\n[display]\nwindow/size/viewport_width=280\nwindow/size/viewport_height=180\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n`,
      extraFiles: {
        "main.gd": MAIN,
        "focus_child.gd": CHILD,
        "main.tscn": '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://main.gd" id="1"]\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n',
      },
    });
    client = await connectClient(h.conn);
  });
  afterAll(async () => { await client?.close(); await h?.stop(); });

  it.each(["game_input", "game_step"])("%s keeps its explicit press until release, not only until focus changes", async (tool) => {
    const run = await client.callTool({ name: "game_run", arguments: { scene: "res://main.tscn" } });
    expect(run.isError, textOf(run)).toBeFalsy();
    try {
      const press = await client.callTool({ name: tool, arguments: tool === "game_input"
        ? { steps: [{ action: "focus_hold", press: true }] }
        : { frames: 1, press: ["focus_hold"] } });
      expect(press.isError, textOf(press)).toBeFalsy();
      const result = await client.callTool({ name: "game_call", arguments: { node: ".", method: "focus_loss_probe" } });
      expect(result.isError, textOf(result)).toBeFalsy();
      const state = jsonOf(result).returned;
      expect(state).toMatchObject({ before: true, control_before: true, child_started: true, child_exited: true });
      // The raw-event control must actually be cleared: otherwise this run did not exercise the native focus fault.
      expect(state.control_after, JSON.stringify(state)).toBe(false);
      expect(state.after, JSON.stringify(state)).toBe(true);
      const release = await client.callTool({ name: tool, arguments: tool === "game_input"
        ? { steps: [{ action: "focus_hold", release: true }] }
        : { frames: 1, release: ["focus_hold"] } });
      expect(release.isError, textOf(release)).toBeFalsy();
      const held = await client.callTool({ name: "game_call", arguments: { node: ".", method: "held" } });
      expect(jsonOf(held).returned).toBe(false);
    } finally {
      await client.callTool({ name: "game_stop", arguments: {} });
    }
  }, 60_000);
});

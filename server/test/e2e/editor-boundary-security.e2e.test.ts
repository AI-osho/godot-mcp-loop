import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectClient, textOf } from "../helpers.js";
import { startHeadlessEditor, type GodotHarness } from "./godot-harness.js";

const scene = '[gd_scene format=3]\n[node name="Probe" type="Node2D"]\n';

describe("e2e: native editor boundaries", () => {
  let h: GodotHarness;
  let client: Client;
  const ok = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError, textOf(result)).toBeFalsy();
    return JSON.parse(textOf(result));
  };
  beforeAll(async () => {
    h = await startHeadlessEditor({ projectGodotExtra: '[editor]\nrun/main_run_args="--headless"\n', extraFiles: {
      "qa/literal%20scene.tscn": scene,
      "qa/literal scene.tscn": scene,
      "qa/通常 scene.tscn": scene,
      "qa/edit.tscn": scene,
      "qa/icon.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>',
    } });
    client = await connectClient(h.conn);
  });
  afterAll(async () => { await client?.callTool({ name: "game_stop", arguments: {} }).catch(() => {}); await client?.close(); await h?.stop(); });

  it("refuses a scene argument Godot would decode before starting the child", async () => {
    try {
      const result = await client.callTool({ name: "game_run", arguments: { scene: "res://qa/literal%20scene.tscn" } });
      expect(result.isError, textOf(result)).toBe(true);
      expect(textOf(result)).toContain("INVALID_PARAMS");
      expect((await ok("godot_status")).playing).toBe(false);
    } finally { await client.callTool({ name: "game_stop", arguments: {} }); }
  });

  it("keeps ordinary Unicode and spaces literal, and a rejected restart leaves the running scene alone", async () => {
    try {
      expect((await ok("game_run", { scene: "res://qa/通常 scene.tscn" })).scene).toBe("res://qa/通常 scene.tscn");
      const refused = await client.callTool({ name: "game_run", arguments: { scene: "res://qa/literal%20scene.tscn", restart: true } });
      expect(refused.isError, textOf(refused)).toBe(true);
      expect((await ok("game_query", { node: ".", properties: ["scene_file_path"] })).properties.scene_file_path).toBe("res://qa/通常 scene.tscn");
    } finally { await client.callTool({ name: "game_stop", arguments: {} }); }
  });

  it("previews, applies and undoes an indexed Resource edit without changing the preview's before value", async () => {
    await ok("scene_open", { path: "res://qa/edit.tscn" });
    await ok("node_add", { parent: ".", type: "CollisionShape2D", name: "Collider", properties: { shape: { new: "RectangleShape2D", properties: { size: [10, 20] } } } });
    const args = { path: "Collider", properties: { "shape:size": [50, 60] } };
    const preview = await ok("node_set", { ...args, dry_run: true });
    expect(preview.changes["shape:size"].before).toEqual([10, 20]);
    expect((await ok("node_get", { path: "Collider", properties: ["shape:size"] })).properties["shape:size"]).toEqual([10, 20]);
    await ok("node_set", args);
    expect((await ok("node_get", { path: "Collider", properties: ["shape:size"] })).properties["shape:size"]).toEqual([50, 60]);
    await ok("edit_undo");
    expect((await ok("node_get", { path: "Collider", properties: ["shape:size"] })).properties["shape:size"]).toEqual([10, 20]);
  });

  it("disables an inline @tool annotation during native editor compile validation", async () => {
    const content = '@icon("res://qa/icon.svg") @tool\nextends Node\nstatic var fixture := mark()\nstatic func mark() -> int:\n\tvar f := FileAccess.open("res://qa/compile-side-effect.txt", FileAccess.WRITE)\n\tf.store_string("VALIDATION EXECUTED THE STATIC INITIALIZER")\n\tf.close()\n\treturn 1\n';
    const result = await ok("script_write", { path: "res://qa/inline_tool.gd", content, dry_run: true });
    expect(existsSync(join(h.projectPath, "qa/compile-side-effect.txt")), "native compilation must not execute the inline @tool initializer").toBe(false);
    expect(result.warnings?.join(" ")).toContain("@tool");
    expect(existsSync(join(h.projectPath, "qa/inline_tool.gd"))).toBe(false);
  });
});

it.each([["main", false], ["current", false], ["main", true], ["current", true]] as const)("refuses a changed %s target across native launch/restart=%s wait, then permits repair", async (kind, restart) => {
  const plugin = readFileSync(new URL("../../../addons/mcp_loop/plugin.gd", import.meta.url), "utf8");
  const h = await startHeadlessEditor({
    applicationExtra: ['run/main_scene="res://qa/first.tscn"'],
    projectGodotExtra: '[editor]\nrun/main_run_args="--headless"\n',
    extraFiles: {
      "addons/mcp_loop/plugin.gd": plugin.replace('preload("res://addons/mcp_loop/commands/play_commands.gd")', 'preload("res://addons/mcp_loop/qa_changed_target.gd")'),
      "addons/mcp_loop/qa_changed_target.gd": `@tool
extends "res://addons/mcp_loop/commands/play_commands.gd"
var injected := false
var requested := "main"
var observations: Array[Dictionary] = []
func _qa_state(event: String) -> Dictionary:
  var root := EditorInterface.get_edited_scene_root()
  return {"event": event, "time_ms": Time.get_ticks_msec(), "root_id": root.get_instance_id() if root != null else 0, "root_path": root.scene_file_path if root != null else "", "main_scene": String(ProjectSettings.get_setting("application/run/main_scene", "")), "scanning": EditorInterface.get_resource_filesystem().is_scanning(), "playing": EditorInterface.is_playing_scene()}
func _init(context: RefCounted, bridge: EditorDebuggerPlugin, scene_tree: SceneTree) -> void:
  super(context, bridge, scene_tree)
func _run(p: Dictionary) -> Dictionary:
  requested = String(p.get("scene", "main"))
  observations.clear()
  observations.append(_qa_state("run_enter"))
  var result: Dictionary = await super._run(p)
  observations.append(_qa_state("run_return"))
  if requested in ["main", "current"]:
    # Write only after the operation, not inside its target-change window.
    var trace := FileAccess.open("res://qa/target-observations.json", FileAccess.WRITE)
    if trace != null:
      trace.store_string(JSON.stringify(observations))
      trace.close()
  return result
func _preflight_run_target(kind: String, target: String, current_id: int) -> Dictionary:
  var state := _qa_state("preflight")
  state["target"] = target
  state["captured_root_id"] = current_id
  var result: Dictionary = super._preflight_run_target(kind, target, current_id)
  state["accepted"] = result.ok
  observations.append(state)
  return result
func _wait_until(cond: Callable, timeout_ms: int) -> bool:
  observations.append(_qa_state("wait_enter"))
  # Keep the target captured before the wait, but do not let initial import's
  # scene restoration undo the deliberate change before the checked boundary.
  var ready: bool = await super._wait_until(cond, timeout_ms)
  if not injected and requested in ["main", "current"]:
    injected = true
    if requested == "current":
      EditorInterface.open_scene_from_path("res://qa/other.tscn")
      var deadline := Time.get_ticks_msec() + 5000
      while Time.get_ticks_msec() < deadline:
        var root := EditorInterface.get_edited_scene_root()
        if root != null and root.scene_file_path == "res://qa/other.tscn":
          break
        await tree.process_frame
    else:
      ProjectSettings.set_setting("application/run/main_scene", "res://qa/other.tscn")
    observations.append(_qa_state("after_injection"))
  observations.append(_qa_state("wait_return"))
  return ready
`,
      "qa/first.tscn": scene,
      "qa/other.tscn": '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://qa/other.gd" id="1"]\n[node name="Other" type="Node"]\nscript = ExtResource("1")\n',
      "qa/other.gd": 'extends Node\nfunc _ready() -> void:\n\tif not Engine.is_editor_hint():\n\t\tvar f := FileAccess.open("res://unvalidated-run.txt", FileAccess.WRITE)\n\t\tf.store_string("UNVALIDATED")\n\t\tf.close()\n',
    },
  });
  const client = await connectClient(h.conn);
  try {
    if (kind === "current") {
      const opened = await client.callTool({ name: "scene_open", arguments: { path: "res://qa/first.tscn" } });
      expect(opened.isError, textOf(opened)).toBeFalsy();
    }
    if (restart) {
      const initial = await client.callTool({ name: "game_run", arguments: { scene: "res://qa/first.tscn" } });
      expect(initial.isError, textOf(initial)).toBeFalsy();
    }
    const refused = await client.callTool({ name: "game_run", arguments: { scene: kind, restart } });
    const tracePath = join(h.projectPath, "qa/target-observations.json");
    const observations = existsSync(tracePath) ? JSON.parse(readFileSync(tracePath, "utf8")) : "missing fixture trace";
    expect(Array.isArray(observations), "fixture must retain its native target-change observation").toBe(true);
    const injected = observations.find((entry: any) => entry.event === "after_injection");
    expect(kind === "current" ? injected?.root_path : injected?.main_scene,
      "fixture must actually select the changed target after initial restoration").toBe("res://qa/other.tscn");
    expect(refused.isError, JSON.stringify({ result: textOf(refused), observations })).toBe(true);
    expect(textOf(refused)).toMatch(/changed/i);
    const status = await client.callTool({ name: "godot_status", arguments: {} });
    expect(JSON.parse(textOf(status)).playing).toBe(false);
    expect(existsSync(join(h.projectPath, "unvalidated-run.txt"))).toBe(false);
    const repaired = kind === "current"
      ? await client.callTool({ name: "scene_open", arguments: { path: "res://qa/first.tscn" } })
      : await client.callTool({ name: "project_setting_set", arguments: { key: "application/run/main_scene", value: "res://qa/first.tscn" } });
    expect(repaired.isError, textOf(repaired)).toBeFalsy();
    const retry = await client.callTool({ name: "game_run", arguments: { scene: kind } });
    expect(retry.isError, textOf(retry)).toBeFalsy();
    expect(JSON.parse(textOf(retry)).scene).toBe("res://qa/first.tscn");
  } finally {
    await client.callTool({ name: "game_stop", arguments: {} }).catch(() => {});
    await client.close();
    await h.stop();
  }
}, 120_000);

it("keeps native main-scene UIDs literal for Unicode and percent-spelled resource names", async () => {
  const cfg = readFileSync(new URL("../../../addons/mcp_loop/plugin.cfg", import.meta.url), "utf8");
  const h = await startHeadlessEditor({
    projectGodotExtra: '[editor]\nrun/main_run_args="--headless"\n',
    extraFiles: {
      "addons/mcp_loop/plugin.cfg": cfg.replace('script="plugin.gd"', 'script="qa_scene_uid.gd"'),
      "addons/mcp_loop/qa_scene_uid.gd": `@tool
extends "res://addons/mcp_loop/plugin.gd"
func _enter_tree() -> void:
  super()
  _router.register("qa.uid", _qa_uid)
func _qa_uid(p: Dictionary) -> Dictionary:
  var path := String(p.path)
  var uid := ResourceLoader.get_resource_uid(path)
  if uid == ResourceUID.INVALID_ID:
    return {"ok": false, "error": {"code": "INTERNAL", "message": "Saved fixture scene has no UID"}}
  if not ResourceUID.has_id(uid):
    ResourceUID.add_id(uid, path)
  if p.get("make_main", false):
    ProjectSettings.set_setting("application/run/main_scene", ResourceUID.id_to_text(uid))
    if ProjectSettings.save() != OK:
      return {"ok": false, "error": {"code": "INTERNAL", "message": "Could not save fixture main-scene UID"}}
  return {"ok": true, "result": {"uid": ResourceUID.id_to_text(uid)}}
`,
      "qa/通常 scene.tscn": scene,
      "qa/literal%20scene.tscn": scene,
      "qa/literal scene.tscn": scene,
    },
  });
  const client = await connectClient(h.conn);
  try {
    const uids: string[] = [];
    for (const path of ["res://qa/通常 scene.tscn", "res://qa/literal%20scene.tscn"]) {
      for (const name of ["scene_open", "scene_save"]) {
        const saved = await client.callTool({ name, arguments: name === "scene_open" ? { path } : {} });
        expect(saved.isError, textOf(saved)).toBeFalsy();
      }
      const value = (await h.conn.call("qa.uid", { path })) as { uid: string };
      expect(value.uid).toMatch(/^uid:\/\/[a-z0-9]+$/);
      uids.push(value.uid);
    }
    const setMain = async (path: string, expected: string) => {
      // Model the editor's native UID setting, not the public setting tool's intentionally res://-only schema.
      const result = (await h.conn.call("qa.uid", { path, make_main: true })) as { uid: string };
      expect(result.uid).toBe(expected);
    };
    await setMain("res://qa/通常 scene.tscn", uids[0]!);
    const first = await client.callTool({ name: "game_run", arguments: { scene: "main" } });
    expect(first.isError, textOf(first)).toBeFalsy();
    expect(JSON.parse(textOf(first)).scene).toBe("res://qa/通常 scene.tscn");
    await setMain("res://qa/literal%20scene.tscn", uids[1]!);
    // A valid native UID is the argument, not its resolved filename. Godot preserves this resource's literal spelling.
    const restarted = await client.callTool({ name: "game_run", arguments: { scene: "main", restart: true } });
    expect(restarted.isError, textOf(restarted)).toBeFalsy();
    expect(JSON.parse(textOf(restarted)).scene).toBe("res://qa/literal%20scene.tscn");
    const live = await client.callTool({ name: "game_query", arguments: { node: ".", properties: ["scene_file_path"] } });
    expect(live.isError, textOf(live)).toBeFalsy();
    expect(JSON.parse(textOf(live)).properties.scene_file_path).toBe("res://qa/literal%20scene.tscn");
  } finally {
    await client.callTool({ name: "game_stop", arguments: {} }).catch(() => {});
    await client.close();
    await h.stop();
  }
}, 120_000);

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectClient, textOf } from "../helpers.js";
import { startHeadlessEditor, type GodotHarness } from "./godot-harness.js";

const VALID_SCRIPT = `extends Sprite2D

@export var speed: float = 120.0

func _process(delta: float) -> void:
\tposition.x += speed * delta
`;

const VALID_SCRIPT_V2 = VALID_SCRIPT.replace("120.0", "240.0");

const BROKEN_SCRIPT = `extends Sprite2D

func _ready() -> void:
\tvar x: int = "not an int"
\tthis is not gdscript
`;

describe("e2e: safe editing tools", () => {
  let h: GodotHarness;
  let client: Client;

  async function ok(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const res = await client.callTool({ name, arguments: args });
    if (res.isError) throw new Error(`${name} failed: ${textOf(res)}`);
    return JSON.parse(textOf(res));
  }
  async function fails(name: string, args: Record<string, unknown>): Promise<string> {
    const res = await client.callTool({ name, arguments: args });
    expect(res.isError, `${name} should fail`).toBe(true);
    return textOf(res);
  }
  const file = (rel: string) => join(h.projectPath, rel);

  beforeAll(async () => {
    h = await startHeadlessEditor({
      projectGodotExtra: ["[input]", "", "move_right={", '"deadzone": 0.2,', '"events": []', "}", ""].join("\n"),
    });
    client = await connectClient(h.conn);
  });
  afterAll(async () => {
    await client?.close();
    await h?.stop();
  });

  it("project_info lists name and files by glob", async () => {
    const info = await ok("project_info", { glob: "addons/mcp_loop/*.cfg" });
    expect(info.name).toBe("e2e");
    expect(info.files).toContain("res://addons/mcp_loop/plugin.cfg");
    expect(info.input_actions.map((a: any) => a.name)).toContain("move_right");
    // Godot's ~90 built-in ui_* actions are hidden unless asked for.
    expect(info.input_actions.map((a: any) => a.name)).not.toContain("ui_accept");
    expect(info.builtin_actions_hidden).toBeGreaterThan(10);
    const all = await ok("project_info", { include_builtin_actions: true });
    expect(all.input_actions.map((a: any) => a.name)).toContain("ui_accept");
  });

  it("scene_create creates the file and opens it", async () => {
    const r = await ok("scene_create", { path: "res://levels/test_level.tscn", root_type: "Node2D", root_name: "Level" });
    expect(r.path).toBe("res://levels/test_level.tscn");
    expect(existsSync(file("levels/test_level.tscn"))).toBe(true);
    const status = await ok("godot_status");
    expect(status.edited_scene).toBe("res://levels/test_level.tscn");
  });

  it("scene_create refuses to overwrite", async () => {
    expect(await fails("scene_create", { path: "res://levels/test_level.tscn", root_type: "Node2D" })).toContain("ALREADY_EXISTS");
  });

  it("scene_create rejects non-Node classes", async () => {
    expect(await fails("scene_create", { path: "res://x.tscn", root_type: "Resource" })).toContain("INVALID_PARAMS");
  });

  it("node_add with properties, then node_get reads them back", async () => {
    const r = await ok("node_add", {
      type: "Sprite2D",
      name: "Hero",
      properties: { position: [10, 20], modulate: "#ff0000" },
    });
    expect(r.path).toBe("Hero");
    const props = await ok("node_get", { path: "Hero", properties: ["position", "modulate"] });
    expect(props.properties).toEqual({ position: [10, 20], modulate: "#ff0000ff" });
  });

  it("node_add with an invalid property changes nothing", async () => {
    const msg = await fails("node_add", { type: "Node2D", name: "Bad", properties: { position: "nope" } });
    expect(msg).toContain("INVALID_PARAMS");
    expect(msg).toContain("position");
    const tree = await ok("scene_tree");
    expect(JSON.stringify(tree)).not.toContain("Bad");
  });

  it("node_add rejects unknown property names", async () => {
    expect(await fails("node_add", { type: "Node2D", name: "Bad2", properties: { not_a_prop: 1 } })).toContain("not_a_prop");
  });

  it("node_add dry_run describes but does not add", async () => {
    const r = await ok("node_add", { type: "Node2D", name: "Ghost", dry_run: true });
    expect(r.dry_run).toBe(true);
    expect(JSON.stringify(await ok("scene_tree"))).not.toContain("Ghost");
  });

  it("node_set returns before/after and supports indexed properties", async () => {
    const r = await ok("node_set", { path: "Hero", properties: { position: [50, 60] } });
    expect(r.changes.position).toEqual({ before: [10, 20], after: [50, 60] });
    await ok("node_set", { path: "Hero", properties: { "position:x": 70 } });
    const props = await ok("node_get", { path: "Hero", properties: ["position"] });
    expect(props.properties.position).toEqual([70, 60]);
  });

  it("node_get on a missing node gives NODE_NOT_FOUND", async () => {
    expect(await fails("node_get", { path: "Nobody" })).toContain("NODE_NOT_FOUND");
  });

  it("node_add under a child, scene_tree shows hierarchy", async () => {
    await ok("node_add", { parent: "Hero", type: "Node2D", name: "Child" });
    const tree = await ok("scene_tree");
    expect(tree.name).toBe("Level");
    expect(tree.type).toBe("Node2D");
    const hero = tree.children.find((c: any) => c.name === "Hero");
    expect(hero.type).toBe("Sprite2D");
    expect(hero.children.map((c: any) => c.path)).toEqual(["Hero/Child"]);
  });

  it("edit_undo reverts MCP actions newest first", async () => {
    const u1 = await ok("edit_undo");
    expect(u1.undone).toHaveLength(1);
    expect(JSON.stringify(await ok("scene_tree"))).not.toContain("Child");
    await ok("edit_undo");
    const props = await ok("node_get", { path: "Hero", properties: ["position"] });
    expect(props.properties.position).toEqual([50, 60]);
  });

  it("node_delete removes the node and edit_undo restores it with its state", async () => {
    await ok("node_delete", { path: "Hero" });
    expect(JSON.stringify(await ok("scene_tree"))).not.toContain("Hero");
    await ok("edit_undo");
    const props = await ok("node_get", { path: "Hero", properties: ["position"] });
    expect(props.properties.position).toEqual([50, 60]);
  });

  it("node_delete refuses the scene root", async () => {
    expect(await fails("node_delete", { path: "." })).toContain("INVALID_PARAMS");
  });

  it("script_write creates a valid script and returns a summary", async () => {
    const r = await ok("script_write", { path: "res://scripts/hero.gd", content: VALID_SCRIPT });
    expect(r.created).toBe(true);
    // A new file is summarised instead of echoing every line back as a diff.
    expect(r.diff).toBeUndefined();
    expect(r.summary).toMatch(/^created res:\/\/scripts\/hero\.gd \(\d+ lines\)$/);
    expect(readFileSync(file("scripts/hero.gd"), "utf8")).toBe(VALID_SCRIPT);
  });

  it("script_write rejects broken code with line numbers and leaves the file untouched", async () => {
    const msg = await fails("script_write", { path: "res://scripts/hero.gd", content: BROKEN_SCRIPT });
    expect(msg).toContain("SCRIPT_PARSE_ERROR");
    expect(msg).toMatch(/line \d+/i);
    expect(readFileSync(file("scripts/hero.gd"), "utf8")).toBe(VALID_SCRIPT);
  });

  it("script_write dry_run returns a diff without writing", async () => {
    const r = await ok("script_write", { path: "res://scripts/hero.gd", content: VALID_SCRIPT_V2, dry_run: true });
    expect(r.diff).toContain("-@export var speed: float = 120.0");
    expect(r.diff).toContain("+@export var speed: float = 240.0");
    expect(readFileSync(file("scripts/hero.gd"), "utf8")).toBe(VALID_SCRIPT);
  });

  it("script_write is undoable", async () => {
    await ok("script_write", { path: "res://scripts/hero.gd", content: VALID_SCRIPT_V2 });
    expect(readFileSync(file("scripts/hero.gd"), "utf8")).toBe(VALID_SCRIPT_V2);
    await ok("edit_undo");
    expect(readFileSync(file("scripts/hero.gd"), "utf8")).toBe(VALID_SCRIPT);
  });

  it("compile-checking a @tool script does not execute it in the editor, and the result warns", async () => {
    const marker = join(tmpdir(), `gml-marker-${process.pid}-${Date.now()}`);
    const toolScript = [
      "@tool",
      "extends Node",
      "",
      "static var _boom := _touch()",
      "",
      "static func _touch() -> int:",
      `\tvar f := FileAccess.open("${marker}", FileAccess.WRITE)`,
      '\tf.store_string("ran")',
      "\treturn 1",
      "",
    ].join("\n");
    const preview = await ok("script_write", { path: "res://scripts/tool_probe.gd", content: toolScript, dry_run: true });
    expect(existsSync(marker), "dry_run must not run the script").toBe(false);
    expect(JSON.stringify(preview.warnings ?? [])).toContain("@tool");
    const written = await ok("script_write", { path: "res://scripts/tool_probe.gd", content: toolScript });
    expect(existsSync(marker), "validation must not run the script").toBe(false);
    expect(JSON.stringify(written.warnings ?? [])).toContain("@tool");
  });

  it("script paths are sandboxed", async () => {
    expect(await fails("script_write", { path: "res://../evil.gd", content: "extends Node\n" })).toContain("PATH_FORBIDDEN");
    expect(await fails("script_write", { path: "res://addons/mcp_loop/evil.gd", content: "extends Node\n" })).toContain("PATH_FORBIDDEN");
    expect(await fails("script_write", { path: "res://evil.sh", content: "rm -rf /" })).toContain("PATH_FORBIDDEN");
    expect(await fails("script_read", { path: "/etc/hosts" })).toContain("PATH_FORBIDDEN");
  });

  it("script_attach + script_read + scene_save persist to disk", async () => {
    await ok("script_attach", { node: "Hero", script: "res://scripts/hero.gd" });
    const props = await ok("node_get", { path: "Hero", properties: ["script", "speed"] });
    expect(props.properties.script).toMatchObject({ res: "res://scripts/hero.gd" });
    expect(props.properties.speed).toBe(120);
    const src = await ok("script_read", { path: "res://scripts/hero.gd" });
    expect(src.content).toBe(VALID_SCRIPT);
    await ok("scene_save");
    const tscn = readFileSync(file("levels/test_level.tscn"), "utf8");
    expect(tscn).toContain('name="Hero"');
    expect(tscn).toContain("res://scripts/hero.gd");
  });

  it("embedded resources ({new}) can be created, read back and saved into the scene", async () => {
    await ok("node_add", { parent: ".", type: "StaticBody2D", name: "Wall" });
    await ok("node_add", {
      parent: "Wall",
      type: "CollisionShape2D",
      name: "Shape",
      properties: { shape: { new: "RectangleShape2D", properties: { size: [32, 48] } } },
    });
    const got = await ok("node_get", { path: "Wall/Shape", properties: ["shape"] });
    expect(got.properties.shape).toEqual({ new: "RectangleShape2D", properties: { size: [32, 48] } });
    expect(await fails("node_set", { path: "Wall/Shape", properties: { shape: { new: "GDScript" } } })).toContain(
      "script_write",
    );
    expect(await fails("node_set", { path: "Wall/Shape", properties: { shape: { new: "StyleBoxFlat" } } })).toContain(
      "Shape2D",
    );
    await ok("scene_save");
    const tscn = readFileSync(file("levels/test_level.tscn"), "utf8");
    expect(tscn).toContain('type="RectangleShape2D"');
    expect(tscn).toContain("size = Vector2(32, 48)");
  });

  it("node_get reads indexed paths (array elements, members) and explains bad ones", async () => {
    const got = await ok("node_get", { path: "Wall/Shape", properties: ["shape:size:y"] });
    expect(got.properties["shape:size:y"]).toBe(48);
    expect(await fails("node_get", { path: "Wall/Shape", properties: ["shape:size:q"] })).toContain("no member 'q'");
  });

  it("property values sent as strings are decoded to the property's type", async () => {
    await ok("node_set", { path: "Hero", properties: { position: "[5, 6]", rotation: "0.5" } });
    const got = await ok("node_get", { path: "Hero", properties: ["position", "rotation"] });
    expect(got.properties.position).toEqual([5, 6]);
    expect(got.properties.rotation).toBeCloseTo(0.5);
  });

  it("script_edit replaces exact text, compile-checks, returns a diff and is undoable", async () => {
    const before = readFileSync(file("scripts/hero.gd"), "utf8");
    const r = await ok("script_edit", {
      path: "res://scripts/hero.gd",
      edits: [{ old: "@export var speed: float = 120.0", new: "@export var speed: float = 200.0" }],
    });
    expect(r.diff).toContain("-@export var speed: float = 120.0");
    expect(r.diff).toContain("+@export var speed: float = 200.0");
    expect(readFileSync(file("scripts/hero.gd"), "utf8")).toContain("speed: float = 200.0");
    await ok("edit_undo");
    expect(readFileSync(file("scripts/hero.gd"), "utf8")).toBe(before);
  });

  it("script_edit leaves the file untouched when an edit doesn't match or breaks compilation", async () => {
    const before = readFileSync(file("scripts/hero.gd"), "utf8");
    expect(
      await fails("script_edit", { path: "res://scripts/hero.gd", edits: [{ old: "no such line", new: "x" }] }),
    ).toContain("not found");
    expect(
      await fails("script_edit", {
        path: "res://scripts/hero.gd",
        edits: [{ old: "@export var speed: float = 120.0", new: "@export var speed: float = " }],
      }),
    ).toContain("SCRIPT_PARSE_ERROR");
    expect(await fails("script_edit", { path: "res://scripts/missing.gd", edits: [{ old: "a", new: "b" }] })).toContain(
      "FILE_NOT_FOUND",
    );
    expect(readFileSync(file("scripts/hero.gd"), "utf8")).toBe(before);
  });

  it("file_write writes, validates and edits text files, undoably", async () => {
    const r = await ok("file_write", { path: "res://tests/s.yaml", content: "name: s\nsteps:\n  - wait_ms: 5\n" });
    expect(r.created).toBe(true);
    expect(r.warnings).toBeUndefined();
    expect(readFileSync(file("tests/s.yaml"), "utf8")).toContain("wait_ms: 5");
    const edited = await ok("file_write", { path: "res://tests/s.yaml", edits: [{ old: "wait_ms: 5", new: "wait_ms: 7" }] });
    expect(edited.diff).toContain("+  - wait_ms: 7");
    expect(await fails("file_write", { path: "res://tests/bad.json", content: "{oops" })).toContain("Invalid JSON");
    expect(await fails("file_write", { path: "res://tests/x.gd", content: "extends Node" })).toContain("PATH_FORBIDDEN");
    expect(await fails("file_write", { path: "res://addons/mcp_loop/x.md", content: "hi" })).toContain("PATH_FORBIDDEN");
    await ok("edit_undo");
    expect(readFileSync(file("tests/s.yaml"), "utf8")).toContain("wait_ms: 5");
  });

  it("image_write creates an imported pixel-art PNG usable as a texture, undoably", async () => {
    const before = await ok("logs_read", { source: "editor" });
    const r = await ok("image_write", {
      path: "res://art/hero.png",
      palette: { k: "#000000", r: "#d82800" },
      frames: [
        ["krk", "rrr"],
        ["k.k", "rrr"],
      ],
      scale: 2,
    });
    expect(r).toMatchObject({ width: 12, height: 4, frames: 2, frame_width: 6, frame_height: 4 });
    expect(existsSync(file("art/hero.png"))).toBe(true);
    // Writing into a folder the editor hadn't seen must not log import errors.
    const logs = await ok("logs_read", { source: "editor", since: before.next });
    expect(logs.entries.map((x: any) => x.message).join("\n")).not.toContain("Can't find file");
    const mirrored = await ok("image_write", { path: "res://art/ship.png", palette: { w: "white" }, rows: ["w.", "ww"], mirror: "x", dry_run: true });
    expect(mirrored).toMatchObject({ width: 4, height: 2 });
    await ok("node_add", {
      parent: ".",
      type: "Sprite2D",
      name: "HeroSprite",
      properties: { texture: { res: "res://art/hero.png" }, hframes: 2, texture_filter: 1 },
    });
    const got = await ok("node_get", { path: "HeroSprite", properties: ["texture", "hframes"] });
    expect(got.properties.texture).toMatchObject({ res: "res://art/hero.png" });
    expect(got.properties.hframes).toBe(2);
    await ok("edit_undo");
    await ok("edit_undo");
    expect(existsSync(file("art/hero.png"))).toBe(false);
  });

  it("scene_open switches the edited scene", async () => {
    await ok("scene_create", { path: "res://levels/other.tscn", root_type: "Node3D" });
    expect((await ok("godot_status")).edited_scene).toBe("res://levels/other.tscn");
    await ok("scene_open", { path: "res://levels/test_level.tscn" });
    expect((await ok("godot_status")).edited_scene).toBe("res://levels/test_level.tscn");
    expect(await fails("scene_open", { path: "res://missing.tscn" })).toContain("FILE_NOT_FOUND");
  });
});

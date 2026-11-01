import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectClient, jsonOf, textOf } from "../helpers.js";
import { startHeadlessEditor, type GodotHarness } from "./godot-harness.js";

/** Reach the real native save sink, not a mocked ResourceSaver. */
describe("e2e: scene save revalidates its mutable root destination", () => {
  let h: GodotHarness;
  let client: Client;
  let outside: string;
  // Trusted fixture code can still change native metadata; sink checks must not rely only on generic-property refusal.
  const scene = '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://save_fixture.gd" id="1"]\n[node name="Probe" type="Node2D"]\nscript = ExtResource("1")\n';
  beforeAll(async () => {
    outside = mkdtempSync(join(tmpdir(), "gml-scene-save-outside-"));
    h = await startHeadlessEditor({ projectGodotExtra: '[editor]\nrun/main_run_args="--headless"\n', extraFiles: { "probe.tscn": scene,
      "save_fixture.gd": '@tool\nextends Node2D\n@export var audit_save_target: String:\n\tset(value):\n\t\tscene_file_path = value\n\tget:\n\t\treturn scene_file_path\n',
    } });
    client = await connectClient(h.conn);
  });
  afterAll(async () => { await client?.close(); await h?.stop(); rmSync(outside, { recursive: true, force: true }); });

  it("refuses an external scene_file_path without overwriting its sentinel", async () => {
    const sentinel = join(outside, "keep.tscn");
    const keep = "DO NOT OVERWRITE THE EXTERNAL SCENE\n";
    writeFileSync(sentinel, keep);
    const opened = await client.callTool({ name: "scene_open", arguments: { path: "res://probe.tscn" } });
    expect(opened.isError, textOf(opened)).toBeFalsy();
    const changed = await client.callTool({ name: "node_set", arguments: { path: ".", properties: { audit_save_target: sentinel } } });
    expect(changed.isError, textOf(changed)).toBeFalsy();
    try {
      const saved = await client.callTool({ name: "scene_save", arguments: {} });
      expect(readFileSync(sentinel, "utf8"), textOf(saved)).toBe(keep);
      expect(saved.isError, textOf(saved)).toBe(true);
      expect(textOf(saved)).toContain("PATH_FORBIDDEN");
    } finally {
      await client.callTool({ name: "node_set", arguments: { path: ".", properties: { audit_save_target: "res://probe.tscn" } } });
    }
  });

  it("refuses a mutable external scene destination before native game-launch autosave", async () => {
    const sentinel = join(outside, "run-keep.tscn"), keep = "DO NOT AUTOSAVE AN EXTERNAL SCENE\n";
    writeFileSync(sentinel, keep);
    await client.callTool({ name: "scene_open", arguments: { path: "res://probe.tscn" } });
    await client.callTool({ name: "node_set", arguments: { path: ".", properties: { audit_save_target: sentinel } } });
    try {
      const result = await client.callTool({ name: "game_run", arguments: { scene: "current" } });
      expect(readFileSync(sentinel, "utf8"), textOf(result)).toBe(keep);
      expect(result.isError, textOf(result)).toBe(true);
      expect(textOf(result)).toContain("PATH_FORBIDDEN");
    } finally {
      await client.callTool({ name: "game_stop", arguments: {} });
      await client.callTool({ name: "node_set", arguments: { path: ".", properties: { audit_save_target: "res://probe.tscn" } } });
    }
  }, 40_000);

  it.each([
    ["project_setting_set", { key: "application/config/name", value: "Refused fixture change" }],
    ["input_action_set", { name: "audit_refused_action", keys: ["Space"] }],
  ] as const)("reports a refused project.godot save without changing the external file (%s)", async (name, args) => {
    const file = join(h.projectPath, "project.godot"), backup = file + ".audit-backup";
    const sentinel = join(outside, "keep.godot"), keep = 'config_version=5\n[application]\nconfig/name="OUTSIDE_KEEP"\n';
    writeFileSync(sentinel, keep);
    renameSync(file, backup); symlinkSync(sentinel, file);
    try {
      const result = await client.callTool({ name, arguments: args });
      expect(readFileSync(sentinel, "utf8"), textOf(result)).toBe(keep);
      expect(result.isError, textOf(result)).toBe(true);
      expect(textOf(result)).toContain("PATH_FORBIDDEN");
    } finally { rmSync(file, { force: true }); renameSync(backup, file); }
  });

  it.each([
    ["project_setting_set", { key: "application/config/name", value: "Pending guarded undo" }],
    ["input_action_set", { name: "audit_pending_undo", keys: ["Space"] }],
  ] as const)("keeps a refused project-setting undo pending until its path is repaired (%s)", async (name, args) => {
    const changed = await client.callTool({ name, arguments: args });
    expect(changed.isError, textOf(changed)).toBeFalsy();
    const file = join(h.projectPath, "project.godot"), backup = file + ".undo-backup";
    const sentinel = join(outside, "undo-keep.godot"), keep = 'config_version=5\n[application]\nconfig/name="UNDO_OUTSIDE_KEEP"\n';
    writeFileSync(sentinel, keep);
    renameSync(file, backup); symlinkSync(sentinel, file);
    try {
      const refused = await client.callTool({ name: "edit_undo", arguments: {} });
      expect(readFileSync(sentinel, "utf8"), textOf(refused)).toBe(keep);
      expect(refused.isError, textOf(refused)).toBe(true);
      expect(textOf(refused)).toContain("File path changed");
      const info = jsonOf(await client.callTool({ name: "project_info", arguments: {} }));
      if (name === "project_setting_set") expect(info.name).toBe("Pending guarded undo");
      else expect(info.input_actions.some((action: { name: string }) => action.name === "audit_pending_undo")).toBe(true);
    } finally { rmSync(file, { force: true }); renameSync(backup, file); }
    const retried = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(retried.isError, textOf(retried)).toBeFalsy();
    const info = jsonOf(await client.callTool({ name: "project_info", arguments: {} }));
    if (name === "project_setting_set") expect(info.name).not.toBe("Pending guarded undo");
    else expect(info.input_actions.some((action: { name: string }) => action.name === "audit_pending_undo")).toBe(false);
  });

  it("checks inactive scene roots before native save-all on editor quit", async () => {
    const sentinel = join(outside, "inactive-keep.tscn"), keep = "DO NOT SAVE AN INACTIVE EXTERNAL SCENE\n";
    writeFileSync(sentinel, keep);
    const extraFiles: Record<string, string> = {
      "bad.tscn": scene,
      "safe.tscn": '[gd_scene format=3]\n[node name="Safe" type="Node2D"]\n',
      "save_fixture.gd": readFileSync(join(h.projectPath, "save_fixture.gd"), "utf8"),
    };
    if (process.env.GML_MUTATE_ALL_SCENE_GUARD === "1") {
      const source = readFileSync(new URL("../../../addons/mcp_loop/commands/context.gd", import.meta.url), "utf8");
      expect(source).toContain("EditorInterface.get_open_scene_roots()");
      // Negative control changes only this disposable editor's addon, never the writer tree.
      extraFiles["addons/mcp_loop/commands/context.gd"] = source.replace("EditorInterface.get_open_scene_roots()", "[EditorInterface.get_edited_scene_root()]");
    }
    const second = await startHeadlessEditor({ extraFiles });
    const c = await connectClient(second.conn);
    try {
      await c.callTool({ name: "scene_open", arguments: { path: "res://bad.tscn" } });
      const changed = await c.callTool({ name: "node_set", arguments: { path: ".", properties: { audit_save_target: sentinel } } });
      expect(changed.isError, textOf(changed)).toBeFalsy();
      await c.callTool({ name: "scene_open", arguments: { path: "res://safe.tscn" } });
      let refusal: unknown;
      try { await second.conn.call("editor.quit", { save: true }); } catch (e) { refusal = e; }
      expect(readFileSync(sentinel, "utf8")).toBe(keep);
      expect(refusal).toMatchObject({ code: "PATH_FORBIDDEN" });
      expect(second.conn.isConnected()).toBe(true);
    } finally { await c.close(); await second.stop(); }
  });

  it("still saves an ordinary project scene", async () => {
    const opened = await client.callTool({ name: "scene_open", arguments: { path: "res://probe.tscn" } });
    expect(opened.isError, textOf(opened)).toBeFalsy();
    const changed = await client.callTool({ name: "node_set", arguments: { path: ".", properties: { position: [17, 23] } } });
    expect(changed.isError, textOf(changed)).toBeFalsy();
    const saved = await client.callTool({ name: "scene_save", arguments: {} });
    expect(saved.isError, textOf(saved)).toBeFalsy();
    expect(readFileSync(join(h.projectPath, "probe.tscn"), "utf8")).toContain("Vector2(17, 23)");
  });
});

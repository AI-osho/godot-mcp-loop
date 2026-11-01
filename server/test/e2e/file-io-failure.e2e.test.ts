import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { connectClient, textOf } from "../helpers.js";
import { startHeadlessEditor } from "./godot-harness.js";

// Private fixture only: use native UI history calls without adding a product tool.
function nativeHistoryFiles(): Record<string, string> {
  const cfg = readFileSync(new URL("../../../addons/mcp_loop/plugin.cfg", import.meta.url), "utf8");
  return {
    "addons/mcp_loop/plugin.cfg": cfg.replace('script="plugin.gd"', 'script="qa_history.gd"'),
    "addons/mcp_loop/qa_history.gd": `@tool
extends "res://addons/mcp_loop/plugin.gd"
const QAContext = preload("res://addons/mcp_loop/commands/context.gd")
class ReenteringOps extends QAContext.FileOps:
  var context: WeakRef
  var nested := {}
  var entered := false
  func _refresh(_path: String, _content: String) -> void:
    if not entered:
      entered = true
      nested = context.get_ref().commit_file("nested", "write_text", ["res://nested.txt", "NESTED"], "remove_file", ["res://nested.txt"])
class NativeProbe extends RefCounted:
  var context: WeakRef
  var result := {}
  func enter() -> void:
    var undo: Dictionary = context.get_ref().undo(1)
    var nested: Dictionary = context.get_ref().commit_file("native nested", "write_text", ["res://nested.txt", "NESTED"], "remove_file", ["res://nested.txt"])
    result = {"undo": undo, "nested": nested}
  func leave() -> void:
    pass
class PendingNativeOps extends QAContext.FileOps:
  func _refresh(_path: String, _content: String) -> void:
    var manager := EditorInterface.get_editor_undo_redo()
    manager.create_action("pending native fixture", UndoRedo.MERGE_DISABLE, null)
    # A real pending action needs an assigned history; create_action alone is still empty and replaceable.
    manager.add_do_method(self, "noop")
  func noop() -> void:
    pass
func _enter_tree() -> void:
  super()
  _router.register("qa.history", _qa_history)
  _router.register("qa.reenter", _qa_reenter)
  _router.register("qa.native_busy", _qa_native_busy)
  _router.register("qa.registration", _qa_registration)
func _qa_native_busy(_p: Dictionary) -> Dictionary:
  var manager := EditorInterface.get_editor_undo_redo()
  var probe := NativeProbe.new()
  probe.context = weakref(_ctx)
  manager.create_action("native callback fixture", UndoRedo.MERGE_DISABLE, null)
  manager.add_do_method(probe, "enter")
  manager.add_undo_method(probe, "leave")
  manager.commit_action()
  return {"ok": true, "result": probe.result}
func _qa_registration(_p: Dictionary) -> Dictionary:
  var old := _ctx.file_ops
  _ctx.file_ops = PendingNativeOps.new()
  var result := _ctx.commit_file("unregistered", "write_text", ["res://outer.txt", "OUTER"], "remove_file", ["res://outer.txt"])
  _ctx.file_ops = old
  var manager := EditorInterface.get_editor_undo_redo()
  if manager.get_history_undo_redo(EditorUndoRedoManager.GLOBAL_HISTORY).get_current_action_name() != "pending native fixture":
    manager.commit_action(false)
  return {"ok": true, "result": result}
func _qa_reenter(_p: Dictionary) -> Dictionary:
  var old := _ctx.file_ops
  var ops := ReenteringOps.new()
  ops.context = weakref(_ctx)
  _ctx.file_ops = ops
  var result := _ctx.commit_file("outer", "write_text", ["res://outer.txt", "OUTER"], "remove_file", ["res://outer.txt"])
  _ctx.file_ops = old
  return {"ok": true, "result": {"outer": result, "nested": ops.nested}}
func _qa_history(p: Dictionary) -> Dictionary:
  var manager := EditorInterface.get_editor_undo_redo()
  var hist := manager.get_history_undo_redo(EditorUndoRedoManager.GLOBAL_HISTORY)
  var applied := false
  match String(p.get("op", "inspect")):
    "undo": applied = hist.undo()
    "redo": applied = hist.redo()
  return {"ok": true, "result": {"applied": applied, "cursor": hist.get_current_action(), "name": hist.get_current_action_name(), "tracked": _ctx.tracked_action_count(), "project_name": ProjectSettings.get_setting("application/config/name"), "input_exists": ProjectSettings.has_setting("input/failure_fixture")}}
`,
  };
}

it("reports a failed file save and leaves no undo entry", async () => {
  const h = await startHeadlessEditor();
  const client = await connectClient(h.conn);
  const parent = join(h.projectPath, "readonly");
  mkdirSync(parent);
  try {
    chmodSync(parent, 0o500);
    const result = await client.callTool({
      name: "file_write",
      arguments: { path: "res://readonly/not-saved.txt", content: "fixture\n" },
    });
    expect(existsSync(join(parent, "not-saved.txt"))).toBe(false);
    expect(result.isError, textOf(result)).toBe(true);
    const undo = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(undo.isError, textOf(undo)).toBe(true);
    expect(textOf(undo)).toContain("NOTHING_TO_UNDO");
  } finally {
    chmodSync(parent, 0o700);
    await client.close();
    await h.stop();
  }
}, 120_000);

it.each([
  ["script_write", "failed.gd", { content: "extends Node\n" }],
  ["image_write", "failed.png", { palette: { x: "#ffffff" }, rows: ["xx", "xx"] }],
] as const)("propagates a failed %s save without registering an edit", async (name, file, args) => {
  const h = await startHeadlessEditor();
  const client = await connectClient(h.conn);
  const parent = join(h.projectPath, "locked");
  mkdirSync(parent);
  try {
    chmodSync(parent, 0o500);
    const result = await client.callTool({ name, arguments: { path: `res://locked/${file}`, ...args } });
    expect(result.isError, textOf(result)).toBe(true);
    expect(textOf(result)).toContain("Could not write");
    expect(existsSync(join(parent, file))).toBe(false);
    const undo = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(undo.isError, textOf(undo)).toBe(true);
    expect(textOf(undo)).toContain("NOTHING_TO_UNDO");
  } finally {
    chmodSync(parent, 0o700);
    await client.close();
    await h.stop();
  }
}, 120_000);

it("refuses replacement when the old text cannot be read for undo", async () => {
  const h = await startHeadlessEditor({ extraFiles: { ...nativeHistoryFiles(), "keep.txt": "ORIGINAL" } });
  const client = await connectClient(h.conn);
  const target = join(h.projectPath, "keep.txt");
  try {
    const before = await h.conn.call("qa.history", {}) as { cursor: number; tracked: number };
    chmodSync(target, 0o200);
    const result = await client.callTool({ name: "file_write", arguments: { path: "res://keep.txt", content: "NEW" } });
    chmodSync(target, 0o600);
    expect(readFileSync(target, "utf8")).toBe("ORIGINAL");
    expect(result.isError, textOf(result)).toBe(true);
    expect(textOf(result)).toContain("undo snapshot");
    const after = await h.conn.call("qa.history", {}) as { cursor: number; tracked: number };
    expect(after.cursor).toBe(before.cursor);
    expect(after.tracked).toBe(before.tracked);
    const retry = await client.callTool({ name: "file_write", arguments: { path: "res://keep.txt", content: "NEW" } });
    expect(retry.isError, textOf(retry)).toBeFalsy();
    const undo = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(undo.isError, textOf(undo)).toBeFalsy();
    expect(readFileSync(target, "utf8")).toBe("ORIGINAL");
  } finally {
    chmodSync(target, 0o600);
    await client.close();
    await h.stop();
  }
}, 120_000);

it.each([
  ["script_write", "keep.gd", { content: "extends Node\n# NEW\n" }],
  ["script_edit", "keep.gd", { edits: [{ old: "ORIGINAL", new: "NEW" }] }],
  ["image_write", "keep.png", { palette: { x: "#ff0000" }, rows: ["xx", "xx"] }],
] as const)("requires a readable original before %s", async (name, file, args) => {
  const h = await startHeadlessEditor({ extraFiles: { ...nativeHistoryFiles(), "keep.gd": "extends Node\n# ORIGINAL\n" } });
  const client = await connectClient(h.conn);
  const target = join(h.projectPath, file);
  try {
    if (name === "image_write") {
      const created = await client.callTool({ name, arguments: { path: "res://keep.png", palette: { x: "#0000ff" }, rows: ["xx", "xx"] } });
      expect(created.isError, textOf(created)).toBeFalsy();
    }
    const original = readFileSync(target);
    const sidecar = name === "image_write" ? readFileSync(target + ".import") : undefined;
    const before = await h.conn.call("qa.history", {}) as { cursor: number; tracked: number };
    chmodSync(target, 0o200);
    const result = await client.callTool({ name, arguments: { path: `res://${file}`, ...args } });
    chmodSync(target, 0o600);
    expect(readFileSync(target)).toEqual(original);
    if (sidecar) expect(readFileSync(target + ".import")).toEqual(sidecar);
    expect(result.isError, textOf(result)).toBe(true);
    expect(textOf(result)).toContain("undo snapshot");
    const after = await h.conn.call("qa.history", {}) as { cursor: number; tracked: number };
    expect(after.cursor).toBe(before.cursor);
    expect(after.tracked).toBe(before.tracked);
    const retry = await client.callTool({ name, arguments: { path: `res://${file}`, ...args } });
    expect(retry.isError, textOf(retry)).toBeFalsy();
    const undo = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(undo.isError, textOf(undo)).toBeFalsy();
    expect(readFileSync(target)).toEqual(original);
  } finally {
    if (existsSync(target)) chmodSync(target, 0o600);
    await client.close();
    await h.stop();
  }
}, 120_000);

it("restores live project settings and absent input actions when native save fails", async () => {
  const h = await startHeadlessEditor({ extraFiles: nativeHistoryFiles() });
  const client = await connectClient(h.conn);
  const before = (await h.conn.call("qa.history", {})) as { project_name: string; input_exists: boolean };
  try {
    chmodSync(h.projectPath, 0o500);
    for (const [name, args] of [
      ["project_setting_set", { key: "application/config/name", value: "NOT SAVED" }],
      ["input_action_set", { name: "failure_fixture", keys: ["Space"] }],
    ] as const) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, textOf(result)).toBe(true);
      expect(textOf(result)).toContain("Could not save project settings");
      const after = (await h.conn.call("qa.history", {})) as { project_name: string; input_exists: boolean };
      expect(after.project_name).toBe(before.project_name);
      expect(after.input_exists).toBe(before.input_exists);
    }
    expect((await client.callTool({ name: "edit_undo", arguments: {} })).isError).toBe(true);
  } finally {
    chmodSync(h.projectPath, 0o700);
    await client.close();
    await h.stop();
  }
}, 120_000);

it("refuses a nested file commit while forward I/O is publishing", async () => {
  const h = await startHeadlessEditor({ extraFiles: nativeHistoryFiles() });
  try {
    const result = (await h.conn.call("qa.reenter", {})) as { outer: { ok: boolean }; nested: { ok: boolean; error: { code: string } } };
    expect(result.outer.ok).toBe(true);
    expect(result.nested.ok).toBe(false);
    expect(result.nested.error.code).toBe("BUSY");
    expect(readFileSync(join(h.projectPath, "outer.txt"), "utf8")).toBe("OUTER");
    expect(existsSync(join(h.projectPath, "nested.txt"))).toBe(false);
  } finally {
    await h.stop();
  }
}, 120_000);

it("refuses file I/O and MCP undo from inside a native committing callback", async () => {
  const h = await startHeadlessEditor({ extraFiles: nativeHistoryFiles() });
  try {
    const result = (await h.conn.call("qa.native_busy", {})) as { nested: { ok: boolean; error: { code: string } }; undo: { error: { code: string } } };
    expect(result.nested.ok).toBe(false);
    expect(result.nested.error.code).toBe("BUSY");
    expect(result.undo.error.code).toBe("BUSY");
    expect(existsSync(join(h.projectPath, "nested.txt"))).toBe(false);
  } finally {
    await h.stop();
  }
}, 120_000);

it("reports applied disk data and blocks replay when native registration was not confirmed", async () => {
  const h = await startHeadlessEditor({ extraFiles: nativeHistoryFiles() });
  const client = await connectClient(h.conn);
  try {
    const result = (await h.conn.call("qa.registration", {})) as { ok: boolean; error: { code: string; message: string } };
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INTERNAL");
    expect(result.error.message).toContain("File data was changed");
    expect(readFileSync(join(h.projectPath, "outer.txt"), "utf8")).toBe("OUTER");
    const blocked = await client.callTool({ name: "file_write", arguments: { path: "res://next.txt", content: "NEXT" } });
    expect(blocked.isError, textOf(blocked)).toBe(true);
    expect(textOf(blocked)).toContain("prior file edit changed disk");
    expect(existsSync(join(h.projectPath, "next.txt"))).toBe(false);
    const undo = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(undo.isError, textOf(undo)).toBe(true);
    expect(textOf(undo)).toContain("Error INTERNAL");
  } finally {
    await client.close();
    await h.stop();
  }
}, 120_000);

it.each([false, true])("keeps an unobserved failed native inverse ahead of older edits (older=%s)", async (older) => {
  const h = await startHeadlessEditor({ extraFiles: { ...nativeHistoryFiles(), "older.txt": "OLD BEFORE", "locked/keep.txt": "BEFORE" } });
  const client = await connectClient(h.conn);
  const parent = join(h.projectPath, "locked");
  const target = join(parent, "keep.txt");
  try {
    if (older) {
      const written = await client.callTool({ name: "file_write", arguments: { path: "res://older.txt", content: "OLD AFTER" } });
      expect(written.isError, textOf(written)).toBeFalsy();
    }
    const written = await client.callTool({ name: "file_write", arguments: { path: "res://locked/keep.txt", content: "AFTER" } });
    expect(written.isError, textOf(written)).toBeFalsy();
    const undone = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(undone.isError, textOf(undone)).toBeFalsy();
    expect(readFileSync(target, "utf8")).toBe("BEFORE");
    await h.conn.call("qa.history", { op: "redo" });
    expect(readFileSync(target, "utf8")).toBe("AFTER");
    chmodSync(parent, 0o500);
    const native = await h.conn.call("qa.history", { op: "undo" }) as { cursor: number };
    expect(readFileSync(target, "utf8")).toBe("AFTER");
    const blocked = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(readFileSync(join(h.projectPath, "older.txt"), "utf8")).toBe(older ? "OLD AFTER" : "OLD BEFORE");
    expect(blocked.isError, textOf(blocked)).toBe(true);
    expect(textOf(blocked)).toContain("Error INTERNAL");
    chmodSync(parent, 0o700);
    const retry = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(retry.isError, textOf(retry)).toBeFalsy();
    expect(readFileSync(target, "utf8")).toBe("BEFORE");
    expect((await h.conn.call("qa.history", {}) as { cursor: number }).cursor).toBe(native.cursor);
    if (older) {
      const previous = await client.callTool({ name: "edit_undo", arguments: {} });
      expect(previous.isError, textOf(previous)).toBeFalsy();
      expect(readFileSync(join(h.projectPath, "older.txt"), "utf8")).toBe("OLD BEFORE");
    }
  } finally {
    chmodSync(parent, 0o700);
    await client.close();
    await h.stop();
  }
}, 120_000);

it("retracks a file action after native undo, MCP observation, and native redo", async () => {
  const h = await startHeadlessEditor({ extraFiles: { ...nativeHistoryFiles(), "keep.txt": "BEFORE" } });
  const client = await connectClient(h.conn);
  const target = join(h.projectPath, "keep.txt");
  try {
    const written = await client.callTool({ name: "file_write", arguments: { path: "res://keep.txt", content: "AFTER" } });
    expect(written.isError, textOf(written)).toBeFalsy();
    await h.conn.call("qa.history", { op: "undo" });
    expect(readFileSync(target, "utf8")).toBe("BEFORE");
    const observed = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(observed.isError, textOf(observed)).toBe(true);
    await h.conn.call("qa.history", { op: "redo" });
    expect(readFileSync(target, "utf8")).toBe("AFTER");
    const retry = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(retry.isError, textOf(retry)).toBeFalsy();
    expect(readFileSync(target, "utf8")).toBe("BEFORE");
  } finally {
    await client.close();
    await h.stop();
  }
}, 120_000);

it("does not treat a failed native redo as a successfully applied file action", async () => {
  const h = await startHeadlessEditor({ extraFiles: { ...nativeHistoryFiles(), "locked/keep.txt": "BEFORE" } });
  const client = await connectClient(h.conn);
  const parent = join(h.projectPath, "locked");
  const target = join(parent, "keep.txt");
  try {
    const written = await client.callTool({ name: "file_write", arguments: { path: "res://locked/keep.txt", content: "AFTER" } });
    expect(written.isError, textOf(written)).toBeFalsy();
    await h.conn.call("qa.history", { op: "undo" });
    await client.callTool({ name: "edit_undo", arguments: {} });
    chmodSync(parent, 0o500);
    await h.conn.call("qa.history", { op: "redo" });
    expect(readFileSync(target, "utf8")).toBe("BEFORE");
    const blocked = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(blocked.isError, textOf(blocked)).toBe(true);
    expect(textOf(blocked)).toMatch(/redo failed/i);
    chmodSync(parent, 0o700);
    await h.conn.call("qa.history", { op: "undo" });
    await h.conn.call("qa.history", { op: "redo" });
    expect(readFileSync(target, "utf8")).toBe("AFTER");
    const recovered = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(recovered.isError, textOf(recovered)).toBeFalsy();
    expect(readFileSync(target, "utf8")).toBe("BEFORE");
  } finally {
    chmodSync(parent, 0o700);
    await client.close();
    await h.stop();
  }
}, 120_000);

it("refuses PNG creation when it would replace an existing orphan import sidecar", async () => {
  const h = await startHeadlessEditor({ extraFiles: { "orphan.png.import": "KEEP EXISTING METADATA\n" } });
  const client = await connectClient(h.conn);
  const target = join(h.projectPath, "orphan.png");
  try {
    const result = await client.callTool({ name: "image_write", arguments: { path: "res://orphan.png", palette: { x: "#ffffff" }, rows: ["xx", "xx"] } });
    expect(result.isError, textOf(result)).toBe(true);
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(target + ".import", "utf8")).toBe("KEEP EXISTING METADATA\n");
    const undo = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(undo.isError, textOf(undo)).toBe(true);
  } finally {
    await client.close();
    await h.stop();
  }
}, 120_000);

it("recovers a failed native undo without advancing its cursor twice", async () => {
  const h = await startHeadlessEditor({ extraFiles: { ...nativeHistoryFiles(), "locked/keep.txt": "BEFORE" } });
  const client = await connectClient(h.conn);
  const parent = join(h.projectPath, "locked");
  const target = join(parent, "keep.txt");
  try {
    await client.callTool({ name: "file_write", arguments: { path: "res://locked/keep.txt", content: "AFTER" } });
    const before = (await h.conn.call("qa.history", {})) as { cursor: number };
    chmodSync(parent, 0o500);
    const native = (await h.conn.call("qa.history", { op: "undo" })) as { applied: boolean; cursor: number };
    expect(native.applied).toBe(true); // This is the native bookkeeping result, not an I/O receipt.
    expect(native.cursor).toBe(before.cursor - 1);
    expect(readFileSync(target, "utf8")).toBe("AFTER");
    const blocked = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(blocked.isError, textOf(blocked)).toBe(true);
    expect(textOf(blocked)).toContain("Error INTERNAL");
    chmodSync(parent, 0o700);
    const retry = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(retry.isError, textOf(retry)).toBeFalsy();
    expect(readFileSync(target, "utf8")).toBe("BEFORE");
    expect((await h.conn.call("qa.history", {}) as { cursor: number }).cursor).toBe(native.cursor);
  } finally {
    chmodSync(parent, 0o700);
    await client.close();
    await h.stop();
  }
}, 120_000);

it("refuses a replaced import sidecar before unlinking the PNG and permits repair", async () => {
  const h = await startHeadlessEditor({ extraFiles: nativeHistoryFiles() });
  const client = await connectClient(h.conn);
  const png = join(h.projectPath, "paired.png");
  const sidecar = png + ".import";
  const sentinel = join(h.projectPath, "keep.import");
  try {
    const created = await client.callTool({ name: "image_write", arguments: { path: "res://paired.png", palette: { x: "#ffffff" }, rows: ["xx", "xx"] } });
    expect(created.isError, textOf(created)).toBeFalsy();
    const original = readFileSync(sidecar);
    writeFileSync(sentinel, "KEEP");
    unlinkSync(sidecar);
    symlinkSync(sentinel, sidecar);
    const before = (await h.conn.call("qa.history", {})) as { cursor: number };
    const blocked = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(blocked.isError, textOf(blocked)).toBe(true);
    expect(textOf(blocked)).toMatch(/PATH_FORBIDDEN.*link/i);
    expect(existsSync(png)).toBe(true);
    expect(readFileSync(sentinel, "utf8")).toBe("KEEP");
    expect((await h.conn.call("qa.history", {}) as { cursor: number }).cursor).toBe(before.cursor);
    unlinkSync(sidecar);
    writeFileSync(sidecar, original);
    const retry = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(retry.isError, textOf(retry)).toBeFalsy();
    expect(existsSync(png)).toBe(false);
    expect(existsSync(sidecar)).toBe(false);
    expect(readFileSync(sentinel, "utf8")).toBe("KEEP");
  } finally {
    await client.close();
    await h.stop();
  }
}, 120_000);

it.skipIf(process.platform !== "darwin")("retries actual partial PNG removal after an immutable sidecar refused unlink", async () => {
  const h = await startHeadlessEditor({ extraFiles: nativeHistoryFiles() });
  const client = await connectClient(h.conn);
  const png = join(h.projectPath, "paired.png");
  const sidecar = png + ".import";
  try {
    const created = await client.callTool({ name: "image_write", arguments: { path: "res://paired.png", palette: { x: "#ffffff" }, rows: ["xx", "xx"] } });
    expect(created.isError, textOf(created)).toBeFalsy();
    const before = (await h.conn.call("qa.history", {})) as { cursor: number };
    execFileSync("chflags", ["uchg", sidecar]);
    const blocked = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(blocked.isError, textOf(blocked)).toBe(true);
    expect(textOf(blocked)).toContain("Removal may be partial");
    expect(existsSync(png)).toBe(false);
    expect(existsSync(sidecar)).toBe(true);
    expect((await h.conn.call("qa.history", {}) as { cursor: number }).cursor).toBe(before.cursor);
    execFileSync("chflags", ["nouchg", sidecar]);
    const retry = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(retry.isError, textOf(retry)).toBeFalsy();
    expect(existsSync(sidecar)).toBe(false);
  } finally {
    try {
      if (existsSync(sidecar)) execFileSync("chflags", ["nouchg", sidecar]);
    } finally {
      try { await client.close(); } finally { await h.stop(); }
    }
  }
}, 120_000);

it("returns completed undo steps alongside the exact later I/O failure", async () => {
  const h = await startHeadlessEditor({ extraFiles: { "locked/keep.txt": "BEFORE" } });
  const client = await connectClient(h.conn);
  const parent = join(h.projectPath, "locked");
  try {
    for (const [path, content] of [["res://locked/keep.txt", "AFTER"], ["res://fresh.txt", "NEW"]]) {
      const written = await client.callTool({ name: "file_write", arguments: { path, content } });
      expect(written.isError, textOf(written)).toBeFalsy();
    }
    chmodSync(parent, 0o500);
    const partial = await client.callTool({ name: "edit_undo", arguments: { steps: 2 } });
    expect(partial.isError, textOf(partial)).toBeFalsy();
    const report = JSON.parse(textOf(partial));
    expect(report.undone).toEqual(["write res://fresh.txt"]);
    expect(report.error.code).toBe("INTERNAL");
    expect(report.stopped_reason).toContain("history was retained");
    expect(existsSync(join(h.projectPath, "fresh.txt"))).toBe(false);
    expect(readFileSync(join(parent, "keep.txt"), "utf8")).toBe("AFTER");
    chmodSync(parent, 0o700);
    const retry = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(retry.isError, textOf(retry)).toBeFalsy();
    expect(readFileSync(join(parent, "keep.txt"), "utf8")).toBe("BEFORE");
  } finally {
    chmodSync(parent, 0o700);
    await client.close();
    await h.stop();
  }
}, 120_000);

it("keeps both undo histories retryable after inverse file I/O fails", async () => {
  const h = await startHeadlessEditor({ extraFiles: { "locked/keep.txt": "BEFORE" } });
  const client = await connectClient(h.conn);
  const parent = join(h.projectPath, "locked");
  const target = join(parent, "keep.txt");
  try {
    const written = await client.callTool({ name: "file_write", arguments: { path: "res://locked/keep.txt", content: "AFTER" } });
    expect(written.isError, textOf(written)).toBeFalsy();
    chmodSync(parent, 0o500);
    const blocked = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(readFileSync(target, "utf8")).toBe("AFTER");
    expect(blocked.isError, textOf(blocked)).toBe(true);
    expect(textOf(blocked)).toContain("Error INTERNAL");
    chmodSync(parent, 0o700);
    const retry = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(retry.isError, textOf(retry)).toBeFalsy();
    expect(JSON.parse(textOf(retry)).undone).toEqual(["write res://locked/keep.txt"]);
    expect(readFileSync(target, "utf8")).toBe("BEFORE");
  } finally {
    chmodSync(parent, 0o700);
    await client.close();
    await h.stop();
  }
}, 120_000);

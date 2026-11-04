@tool
extends RefCounted
# Private e2e observer injected into owned temporary addons only; never bundled with the product.
const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")
const Codec = preload("res://addons/mcp_loop/util/value_codec.gd")
const TreeCommands = preload("res://addons/mcp_loop/commands/tree_commands.gd")
class ObservedTextures extends TreeCommands:
	var load_count := 0
	func _load_texture(path: String) -> Texture2D:
		load_count += 1
		return ResourceLoader.load(path, "Texture2D", ResourceLoader.CACHE_MODE_IGNORE) as Texture2D
class ErrorStage extends TreeCommands:
	func _stage(plan: Dictionary, policy: Dictionary, textures: Dictionary) -> Dictionary:
		push_error("TREE_EXPECTED_SCOPE_CONTROL")
		return super._stage(plan, policy, textures)
class HumanStage extends TreeCommands:
	func _stage(plan: Dictionary, policy: Dictionary, textures: Dictionary) -> Dictionary:
		var result: Dictionary = super._stage(plan, policy, textures)
		var root: Node = ctx.edited_root()
		var manager := EditorInterface.get_editor_undo_redo()
		manager.create_action("Tree fixture concurrent human edit", UndoRedo.MERGE_DISABLE, root)
		manager.add_do_property(root, "visible", false)
		manager.add_undo_property(root, "visible", root.visible)
		manager.commit_action()
		return result
class SwitchingStage extends TreeCommands:
	func _stage(plan: Dictionary, policy: Dictionary, textures: Dictionary) -> Dictionary:
		var result: Dictionary = super._stage(plan, policy, textures)
		EditorInterface.open_scene_from_path("res://inherit_base.tscn")
		return result
var ctx: RefCounted
func _init(context: RefCounted) -> void:
	ctx = context
func register(router: RefCounted) -> void:
	router.register("tree_fixture.snapshot", _snapshot)
	router.register("tree_fixture.history", _history)
	router.register("tree_fixture.human", _human)
	router.register("tree_fixture.quit", _quit_owned)
	router.register("tree_fixture.stale_png", _stale_png)
	router.register("tree_fixture.texture_loads", _texture_loads)
	router.register("tree_fixture.png_fault", _png_fault)
	router.register("tree_fixture.scope_error", _scope_error)
	router.register("tree_fixture.stage_change", _stage_change)
	router.register("tree_fixture.arm_rename", _arm_rename)
func _walk(node: Node, out: Array) -> void:
	out.append(node)
	for child in node.get_children(true):
		_walk(child, out)
func _snapshot(_p: Dictionary) -> Dictionary:
	var root: Node = ctx.edited_root()
	if root == null:
		return ctx.no_scene_error()
	var all: Array = []
	_walk(root, all)
	var rows: Array = []
	for node in all:
		var row := {"id": str(node.get_instance_id()), "path": str(root.get_path_to(node)), "name": str(node.name), "type": node.get_class(), "owner_is_root": node.owner == root}
		if node is Node2D:
			row["position"] = Codec.encode(node.position)
		if node is CanvasItem:
			row["visible"] = node.visible
		if node == root and node is Control:
			row["anchors"] = [node.anchor_left, node.anchor_top, node.anchor_right, node.anchor_bottom]
			row["offsets"] = [node.offset_left, node.offset_top, node.offset_right, node.offset_bottom]
			row["minimum"] = Codec.encode(node.custom_minimum_size)
		if node is CollisionShape2D:
			row["shape"] = Codec.encode(node.shape)
		if node is Sprite2D:
			row["texture"] = node.texture.resource_path if node.texture != null else ""
		if node is Label:
			row["text"] = node.text
		rows.append(row)
	var ur := EditorInterface.get_editor_undo_redo()
	var history := ur.get_history_undo_redo(ur.get_object_history_id(root))
	return Protocol.ok({"pid": OS.get_process_id(), "root_id": str(root.get_instance_id()), "root_type": root.get_class(), "scene": root.scene_file_path, "nodes": rows, "history_count": history.get_history_count(), "history_cursor": history.get_current_action(), "history_name": history.get_current_action_name()})
func _history(p: Dictionary) -> Dictionary:
	var root: Node = ctx.edited_root()
	var ur := EditorInterface.get_editor_undo_redo()
	var id := ur.get_object_history_id(root)
	var history := ur.get_history_undo_redo(id)
	match p.get("op", ""):
		"undo": history.undo()
		"redo": history.redo()
		"clear": ur.clear_history(id)
		_: return Protocol.err(Protocol.INVALID_PARAMS, "Unknown owned history control.")
	return _snapshot({})
func _human(_p: Dictionary) -> Dictionary:
	var root: Node = ctx.edited_root()
	var ur := EditorInterface.get_editor_undo_redo()
	ur.create_action("Tree fixture human edit", UndoRedo.MERGE_DISABLE, root)
	ur.add_do_property(root, "visible", false)
	ur.add_undo_property(root, "visible", true)
	ur.commit_action()
	return _snapshot({})
func _quit_owned(_p: Dictionary) -> Dictionary:
	EditorInterface.get_base_control().get_tree().quit.call_deferred()
	return Protocol.ok({"shutdown_requested": true})

func _stale_png(_p: Dictionary) -> Dictionary:
	# One native frame: no filesystem watcher or asynchronous importer can repair this fixture before the command.
	var path := "res://assets/shared.png"
	var reader := FileAccess.open(path, FileAccess.READ)
	var bytes := reader.get_buffer(reader.get_length())
	reader.close()
	var original := FileAccess.get_sha256(path)
	var before := _snapshot({})
	var writer := FileAccess.open(path, FileAccess.WRITE)
	writer.store_buffer(bytes + PackedByteArray([32]))
	writer.close()
	var command := TreeCommands.new(ctx)
	var result: Dictionary = command._add_tree({"schema_version": 1, "scene": ctx.edited_root().scene_file_path, "dry_run": true, "nodes": [{"id": "top", "type": "Node2D", "name": "Content"}, {"id": "visual", "parent_id": "top", "type": "Sprite2D", "name": "Visual", "properties": {"texture": {"res": path}}}]})
	writer = FileAccess.open(path, FileAccess.WRITE)
	writer.store_buffer(bytes)
	writer.close()
	return Protocol.ok({"reply": result, "before": before.result, "after": _snapshot({}).result, "original_sha256": original, "restored_sha256": FileAccess.get_sha256(path)})

func _texture_loads(_p: Dictionary) -> Dictionary:
	var command := ObservedTextures.new(ctx)
	var result: Dictionary = command._add_tree({"schema_version": 1, "scene": ctx.edited_root().scene_file_path, "dry_run": true, "nodes": [{"id": "top", "type": "Node2D", "name": "Content"}, {"id": "visual", "parent_id": "top", "type": "Sprite2D", "name": "Visual", "properties": {"texture": {"res": "res://assets/shared.png"}}}]})
	return Protocol.ok({"reply": result, "actual_texture_load_calls": command.load_count})

func _fixture_read(path: String) -> PackedByteArray:
	var file := FileAccess.open(path, FileAccess.READ)
	var bytes := file.get_buffer(file.get_length())
	file.close()
	return bytes

func _fixture_write(path: String, bytes: PackedByteArray) -> void:
	var file := FileAccess.open(path, FileAccess.WRITE)
	file.store_buffer(bytes)
	file.close()

func _png_fault(p: Dictionary) -> Dictionary:
	var parser := JSON.new()
	if parser.parse(FileAccess.get_file_as_string("res://tree_png_headers.json")) != OK:
		return Protocol.err(Protocol.INVALID_PARAMS, "Missing private header controls.")
	var kind := str(p.get("kind", ""))
	var first := "res://assets/shared.png"
	var second := "res://assets/second.png"
	var paths: Array = [first, second]
	var originals := {}
	for path in paths:
		originals[path] = _fixture_read(path)
		originals[path + ".import"] = _fixture_read(path + ".import")
		var md5: String = "res://.godot/imported/" + path.get_file() + "-" + path.md5_text() + ".md5"
		originals[md5] = _fixture_read(md5)
	var bytes: PackedByteArray = originals[first].duplicate()
	match kind:
		"signature": bytes[0] = 0
		"truncated": bytes = bytes.slice(0, 20)
		"bytes": bytes.resize(8388609)
		"remap":
			var text: String = originals[first + ".import"].get_string_from_utf8()
			var pattern := RegEx.create_from_string('(?m)^path="[^"]+"')
			_fixture_write(first + ".import", pattern.sub(text, 'path="res://assets/second.png"').to_utf8_buffer())
		"pixels_total":
			bytes = PackedByteArray(parser.data.large_pixels) + bytes.slice(33)
			_fixture_write(second, PackedByteArray(parser.data.one_pixel) + originals[second].slice(33))
		_:
			if not parser.data.has(kind):
				return Protocol.err(Protocol.INVALID_PARAMS, "Unknown private header control.")
			bytes = PackedByteArray(parser.data[kind]) + bytes.slice(33)
	_fixture_write(first, bytes)
	# Deliberately synchronize the import checksum so header/budget guards must stand on their own.
	for path in paths:
		var md5: String = "res://.godot/imported/" + path.get_file() + "-" + path.md5_text() + ".md5"
		var text: String = originals[md5].get_string_from_ascii()
		var pattern := RegEx.create_from_string('(?m)^source_md5="[0-9a-f]{32}"')
		_fixture_write(md5, pattern.sub(text, 'source_md5="' + FileAccess.get_md5(path) + '"').to_ascii_buffer())
	var before: Dictionary = _snapshot({}).result
	var nodes: Array = [{"id": "top", "type": "Node2D", "name": "Content"}, {"id": "visual", "parent_id": "top", "type": "Sprite2D", "name": "Visual", "properties": {"texture": {"res": first}}}]
	if kind == "pixels_total":
		nodes.append({"id": "second", "parent_id": "top", "type": "Sprite2D", "name": "Second", "properties": {"texture": {"res": second}}})
	var command := ObservedTextures.new(ctx)
	var result: Dictionary = command._add_tree({"schema_version": 1, "scene": ctx.edited_root().scene_file_path, "dry_run": true, "nodes": nodes})
	for path in originals:
		_fixture_write(path, originals[path])
	return Protocol.ok({"kind": kind, "reply": result, "actual_texture_load_calls": command.load_count, "before": before, "after": _snapshot({}).result, "source_restored": _fixture_read(first) == originals[first] and _fixture_read(second) == originals[second]})

func _small_plan(preview: bool) -> Dictionary:
	return {"schema_version": 1, "scene": ctx.edited_root().scene_file_path, "dry_run": preview, "nodes": [{"id": "top", "type": "Node2D", "name": "Content"}]}

func _scope_error(_p: Dictionary) -> Dictionary:
	for index in 2100:
		ctx.log_capture.append({"level": "info", "message": "Tree fixture old retained-log control"})
	var dropped: bool = ctx.log_capture.read(1).dropped
	var before := _snapshot({})
	var clean := TreeCommands.new(ctx)
	var clean_result: Dictionary = clean._add_tree(_small_plan(true))
	var faulty := ErrorStage.new(ctx)
	var fault_result: Dictionary = faulty._add_tree(_small_plan(true))
	return Protocol.ok({"global_dropped": dropped, "clean_preview": clean_result, "fault_preview": fault_result, "before": before.result, "after": _snapshot({}).result})

func _stage_change(p: Dictionary) -> Dictionary:
	var before := _snapshot({})
	var command: RefCounted = HumanStage.new(ctx) if p.get("kind") == "human" else SwitchingStage.new(ctx)
	var result: Dictionary = command._add_tree(_small_plan(false))
	return Protocol.ok({"reply": result, "before": before.result, "after": _snapshot({}).result})

func _arm_rename(_p: Dictionary) -> Dictionary:
	ctx.edited_root().child_entered_tree.connect(_rename_entered, CONNECT_ONE_SHOT)
	return Protocol.ok({"armed": true})

func _rename_entered(node: Node) -> void:
	node.name = "ExternallyRenamed"

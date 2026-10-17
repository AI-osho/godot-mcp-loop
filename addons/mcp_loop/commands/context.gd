@tool
extends RefCounted
## Shared state and helpers for editor command modules.
## - Resolves node paths strictly inside the edited scene (no escaping into editor UI nodes).
## - Commits every change through EditorUndoRedoManager and remembers which
##   actions this bridge made, so edit.undo never reverts a human's edit.

const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")
const Codec = preload("res://addons/mcp_loop/util/value_codec.gd")
const LogCapture = preload("res://addons/mcp_loop/util/log_capture.gd")

const ACTION_PREFIX := "MCP#"
## Older entries fall out of Godot's undo history long before this anyway.
const MAX_TRACKED_ACTIONS := 500


## Undoable file writes live in the editor's global history.
class FileOps extends RefCounted:
	func write_text(path: String, content: String) -> void:
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(path.get_base_dir()))
		var f := FileAccess.open(path, FileAccess.WRITE)
		if f == null:
			push_error("[mcp_loop] Could not write %s: %s" % [path, error_string(FileAccess.get_open_error())])
			return
		f.store_string(content)
		f.close()
		_refresh(path, content)

	func remove_file(path: String) -> void:
		if FileAccess.file_exists(path):
			DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
		EditorInterface.get_resource_filesystem().update_file(path)

	## Binary assets (PNG): write, then import right away so the texture can be used immediately.
	func write_bytes(path: String, data: PackedByteArray) -> void:
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(path.get_base_dir()))
		var f := FileAccess.open(path, FileAccess.WRITE)
		if f == null:
			push_error("[mcp_loop] Could not write %s: %s" % [path, error_string(FileAccess.get_open_error())])
			return
		f.store_buffer(data)
		f.close()
		var fs := EditorInterface.get_resource_filesystem()
		fs.update_file(path)
		fs.reimport_files(PackedStringArray([path]))

	func remove_asset(path: String) -> void:
		for p in [path, path + ".import"]:
			if FileAccess.file_exists(p):
				DirAccess.remove_absolute(ProjectSettings.globalize_path(p))
		EditorInterface.get_resource_filesystem().update_file(path)

	## Project settings (input actions); null removes the setting. Saved at once
	## because games launched from the editor read project.godot from disk.
	func set_project_setting(key: String, value: Variant) -> void:
		ProjectSettings.set_setting(key, value)
		ProjectSettings.save()

	func _refresh(path: String, content: String) -> void:
		EditorInterface.get_resource_filesystem().update_file(path)
		# Keep already-loaded scripts (and nodes using them) in sync with disk.
		if ResourceLoader.has_cached(path):
			var res := ResourceLoader.load(path)
			if res is Script:
				res.source_code = content
				res.reload(true)


var log_capture: LogCapture
var file_ops := FileOps.new()
var _actions: Array = [] # stack of {history_id, name}
var _counter := 0


func _init(capture: LogCapture) -> void:
	log_capture = capture


# ---------------------------------------------------------------- nodes

func edited_root() -> Node:
	return EditorInterface.get_edited_scene_root()


func no_scene_error() -> Dictionary:
	return Protocol.err(Protocol.NO_EDITED_SCENE, "No scene is open in the editor.",
		"Open one with scene_open or create one with scene_create.")


func node_not_found(path: String) -> Dictionary:
	return Protocol.err(Protocol.NODE_NOT_FOUND, "No node at '%s' in the edited scene." % path,
		"Paths are relative to the scene root ('.' is the root). Use scene_tree to see valid paths.")


## Resolves a node path relative to the edited scene root. Returns null when
## not found or when the path would leave the edited scene.
func resolve_node(path: String) -> Node:
	var root := edited_root()
	if root == null:
		return null
	var p := path.strip_edges()
	if p == "" or p == "." or p == String(root.name) or p == "/root/" + String(root.name):
		return root
	if p.begins_with("/root/"):
		p = p.substr("/root/".length())
	if p.begins_with("/"):
		p = p.substr(1)
	for seg in p.split("/"):
		if seg == ".." or seg == "":
			return null
	var node := root.get_node_or_null(NodePath(p))
	# Tolerate a leading root name ("Level/Hero") when it is not a child name.
	if node == null and p.begins_with(String(root.name) + "/"):
		node = root.get_node_or_null(NodePath(p.substr(String(root.name).length() + 1)))
	if node == null or not (node == root or root.is_ancestor_of(node)):
		return null
	return node


func rel_path(node: Node) -> String:
	var root := edited_root()
	if node == root:
		return "."
	return str(root.get_path_to(node))


# ---------------------------------------------------------------- properties

func _find_property(obj: Object, name: String) -> Dictionary:
	for p in obj.get_property_list():
		if p.name == name:
			return p
	return {}


## Validates and decodes {key: json_value} for obj.
## Returns {ok, values: {key: Variant}, errors: [String]}.
func decode_properties(obj: Object, props: Dictionary) -> Dictionary:
	var values := {}
	var errors: Array[String] = []
	for key in props:
		var k := String(key)
		var parts := k.split(":")
		var info := _find_property(obj, parts[0])
		if info.is_empty():
			errors.append("Unknown property '%s' on %s." % [parts[0], obj.get_class()])
			continue
		var target_type: int = info.type
		if parts.size() > 1:
			target_type = typeof(obj.get_indexed(NodePath(k)))
		var r := Codec.decode(props[key], target_type)
		if not r.ok:
			errors.append("%s: %s" % [k, r.error])
			continue
		var v: Variant = r.value
		if v is Resource and info.hint == PROPERTY_HINT_RESOURCE_TYPE and info.hint_string != "":
			var allowed := false
			for cls in String(info.hint_string).split(","):
				if v.is_class(cls.strip_edges()):
					allowed = true
			if not allowed:
				errors.append("%s: expected a %s resource, got %s." % [k, info.hint_string, v.get_class()])
				continue
		values[k] = v
	return {"ok": errors.is_empty(), "values": values, "errors": errors}


## Groups decoded {key: value} (keys may be indexed like "position:x") into
## whole-property values {base: new_value}, applied on top of obj's current values.
func merge_indexed(obj: Object, values: Dictionary) -> Dictionary:
	var out := {}
	for k in values:
		var parts := String(k).split(":")
		var base := parts[0]
		var current: Variant = out[base] if out.has(base) else obj.get(base)
		if parts.size() == 1:
			out[base] = values[k]
		else:
			out[base] = Codec.with_indexed(current, Array(parts.slice(1)), values[k])
	return out


func invalid_properties(errors: Array) -> Dictionary:
	return Protocol.err(Protocol.INVALID_PARAMS, "Invalid properties: " + " ".join(errors),
		"Nothing was changed. Use node_get to see current values and types.")


# ---------------------------------------------------------------- undo

## Runs `build(ur)` inside a new undoable action and records it as ours.
## `context` picks the history: the scene root for scene edits, null for global (files).
func commit(label: String, context: Object, build: Callable) -> String:
	_counter += 1
	var name := "%s%d: %s" % [ACTION_PREFIX, _counter, label]
	var ur := EditorInterface.get_editor_undo_redo()
	ur.create_action(name, UndoRedo.MERGE_DISABLE, context)
	build.call(ur)
	ur.commit_action()
	var history_id := EditorUndoRedoManager.GLOBAL_HISTORY
	if context != null:
		history_id = ur.get_object_history_id(context)
	_remember(history_id, name)
	return name


func _remember(history_id: int, name: String) -> void:
	_actions.append({"history_id": history_id, "name": name})
	if _actions.size() > MAX_TRACKED_ACTIONS:
		_actions.pop_front()


func tracked_action_count() -> int:
	return _actions.size()


## Undoes up to `steps` of our own actions. Returns {undone: [...], stopped_reason}.
func undo(steps: int) -> Dictionary:
	var ur := EditorInterface.get_editor_undo_redo()
	var undone: Array = []
	var reason := ""
	while undone.size() < steps and not _actions.is_empty():
		var a: Dictionary = _actions.back()
		var hist: UndoRedo = ur.get_history_undo_redo(a.history_id)
		if hist == null:
			_actions.pop_back() # history gone (scene closed)
			continue
		if hist.get_current_action_name() == a.name:
			hist.undo()
			_actions.pop_back()
			undone.append(a.name.substr(a.name.find(": ") + 2))
			continue
		var idx := -1
		for i in hist.get_history_count():
			if hist.get_action_name(i) == a.name:
				idx = i
				break
		if idx == -1 or idx > hist.get_current_action():
			_actions.pop_back() # already undone by a human, or history cleared
			continue
		reason = "A later edit not made through MCP exists in the same history ('%s'). Undo it in the editor first." % hist.get_current_action_name()
		break
	return {"undone": undone, "stopped_reason": reason}

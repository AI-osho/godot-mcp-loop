@tool
extends RefCounted
## Shared state and helpers for editor command modules.
## - Resolves node paths strictly inside the edited scene (no escaping into editor UI nodes).
## - Commits every change through EditorUndoRedoManager and remembers which
##   actions this bridge made, so edit.undo never reverts a human's edit.

const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")
const Codec = preload("res://addons/mcp_loop/util/value_codec.gd")
const PathGuard = preload("res://addons/mcp_loop/util/path_guard.gd")
const LogCapture = preload("res://addons/mcp_loop/util/log_capture.gd")
const FileAction = preload("res://addons/mcp_loop/commands/file_action.gd")

const ACTION_PREFIX := "MCP#"
## Older entries fall out of Godot's undo history long before this anyway.
const MAX_TRACKED_ACTIONS := 500


## Undoable file writes live in the editor's global history.
class FileOps extends RefCounted:
	var touched_paths: Array[String] = []

	func _allow(path: String) -> bool:
		var reason := PathGuard.check_write(path, [path.get_extension().to_lower()])
		if reason != "":
			push_warning("[mcp_loop] File action refused: " + reason)
			return false
		if not touched_paths.has(path):
			touched_paths.append(path)
		return true

	func snapshot_bytes(path: String) -> Dictionary:
		var reason := PathGuard.check_read(path)
		if reason != "":
			return Protocol.err(Protocol.PATH_FORBIDDEN, reason)
		var f := FileAccess.open(path, FileAccess.READ)
		if f == null:
			return Protocol.err(Protocol.INTERNAL, "Could not read undo snapshot for %s: %s" % [path, error_string(FileAccess.get_open_error())], "Nothing was written; restore read access and retry.")
		var length := f.get_length()
		var data := f.get_buffer(length)
		var error := f.get_error()
		f.close()
		# An empty file is a valid snapshot, but a failed or short read is not an empty original.
		if data.size() != length or (error != OK and error != ERR_FILE_EOF):
			return Protocol.err(Protocol.INTERNAL, "Could not finish reading undo snapshot for %s." % path, "Nothing was written; inspect the file and retry.")
		return Protocol.ok({"bytes": data})

	func _replace_content(path: String, data: PackedByteArray) -> Dictionary:
		if not _allow(path):
			return Protocol.err(Protocol.PATH_FORBIDDEN, "File write was refused: " + PathGuard.check_write(path, [path.get_extension().to_lower()]))
		var dir := ProjectSettings.globalize_path(path.get_base_dir())
		if DirAccess.make_dir_recursive_absolute(dir) != OK:
			return Protocol.err(Protocol.INTERNAL, "Could not create the file's parent folder.")
		# Replace this name, not an existing inode shared with an unrelated hard-link name.
		# A same-directory temporary also keeps the old content intact until the write has succeeded.
		var temporary := path.get_base_dir().path_join(".mcp-loop-save-" + Crypto.new().generate_random_bytes(16).hex_encode() + ".tmp")
		if PathGuard.check_write(temporary, ["tmp"]) != "":
			return Protocol.err(Protocol.PATH_FORBIDDEN, "The replacement file's path is not writable.")
		var f := FileAccess.open(temporary, FileAccess.WRITE)
		if f == null:
			return Protocol.err(Protocol.INTERNAL, "Could not write %s: %s" % [path, error_string(FileAccess.get_open_error())])
		# Editor safe-save publishes a sibling only when the FileAccess reference is released.
		# Materialize an empty file first, so permissions can be restricted before any content is written.
		f.close()
		f = null
		if OS.get_name() != "Windows":
			var mode := FileAccess.get_unix_permissions(path) & 0x1ff if FileAccess.file_exists(path) else FileAccess.UNIX_READ_OWNER | FileAccess.UNIX_WRITE_OWNER
			if FileAccess.set_unix_permissions(temporary, mode) != OK:
				DirAccess.remove_absolute(ProjectSettings.globalize_path(temporary))
				return Protocol.err(Protocol.INTERNAL, "Could not preserve file permissions before writing.")
		f = FileAccess.open(temporary, FileAccess.WRITE)
		if f == null:
			DirAccess.remove_absolute(ProjectSettings.globalize_path(temporary))
			return Protocol.err(Protocol.INTERNAL, "Could not open the prepared replacement file.")
		f.store_buffer(data)
		f.flush()
		var error := f.get_error()
		f.close()
		f = null
		if error == OK and _allow(path):
			error = DirAccess.rename_absolute(ProjectSettings.globalize_path(temporary), ProjectSettings.globalize_path(path))
		else:
			error = ERR_CANT_CREATE
		if error != OK:
			if PathGuard.check_write(temporary, ["tmp"]) == "":
				DirAccess.remove_absolute(ProjectSettings.globalize_path(temporary))
			return Protocol.err(Protocol.INTERNAL, "Could not replace %s: %s" % [path, error_string(error)])
		return Protocol.ok()

	func write_text(path: String, content: String) -> Dictionary:
		var result := _replace_content(path, content.to_utf8_buffer())
		if result.ok:
			_refresh(path, content)
		return result

	func remove_file(path: String) -> Dictionary:
		if not _allow(path):
			return Protocol.err(Protocol.PATH_FORBIDDEN, "File removal was refused: " + PathGuard.check_write(path, [path.get_extension().to_lower()]))
		if FileAccess.file_exists(path):
			var error := DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
			if error != OK:
				return Protocol.err(Protocol.INTERNAL, "Could not remove %s: %s" % [path, error_string(error)])
		_refresh_removed(path)
		return Protocol.ok()

	## Binary assets (PNG): write, then import right away so the texture can be used immediately.
	func write_bytes(path: String, data: PackedByteArray) -> Dictionary:
		var reason := PathGuard.check_write(path + ".import", ["import"])
		if reason != "":
			return Protocol.err(Protocol.PATH_FORBIDDEN, "The asset import path is not writable: " + reason)
		var result := _replace_content(path, data)
		if result.ok:
			_refresh_binary(path)
		return result

	func _refresh_binary(path: String) -> void:
		var fs := EditorInterface.get_resource_filesystem()
		# In a folder the editor hasn't registered yet, reimport_files logs
		# "Can't find file"; image.write then scans and waits for the import.
		if fs.get_filesystem_path(path.get_base_dir()) != null:
			fs.update_file(path)
			fs.reimport_files(PackedStringArray([path]))

	func remove_asset(path: String) -> Dictionary:
		for p in [path, path + ".import"]:
			if not _allow(p):
				return Protocol.err(Protocol.PATH_FORBIDDEN, "Asset removal was refused: " + PathGuard.check_write(p, [p.get_extension().to_lower()]))
		for p in [path, path + ".import"]:
			if FileAccess.file_exists(p):
				var error := DirAccess.remove_absolute(ProjectSettings.globalize_path(p))
				if error != OK:
					return Protocol.err(Protocol.INTERNAL, "Could not finish removing asset %s: %s" % [path, error_string(error)], "Removal may be partial. The undo entry is retained; repair the filesystem and retry.")
		_refresh_removed(path)
		return Protocol.ok()

	func _refresh_removed(path: String) -> void:
		EditorInterface.get_resource_filesystem().update_file(path)

	## Project settings (input actions); null removes the setting. Saved at once
	## because games launched from the editor read project.godot from disk.
	func set_project_setting(key: String, value: Variant) -> Dictionary:
		if not _allow("res://project.godot"):
			return Protocol.err(Protocol.PATH_FORBIDDEN, "The project settings save path is not writable.")
		var existed := ProjectSettings.has_setting(key)
		var old: Variant = FileAction.snapshot_setting(ProjectSettings.get_setting(key)) if existed else null
		ProjectSettings.set_setting(key, value)
		var error := _save_project_settings()
		if error != OK:
			ProjectSettings.set_setting(key, old)
			return Protocol.err(Protocol.INTERNAL, "Could not save project settings: " + error_string(error), "The in-memory setting was restored; no successful undo entry was added.")
		return Protocol.ok()

	func _save_project_settings() -> Error:
		return ProjectSettings.save()

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
var _redo_actions: Array = [] # Successful file inverses can still be redone in the native editor.
var _counter := 0
var _file_busy := false
var _file_registration_fault := {}


func _init(capture: LogCapture) -> void:
	log_capture = capture


# ---------------------------------------------------------------- nodes

func edited_root() -> Node:
	return EditorInterface.get_edited_scene_root()


## Native play/quit can save every open scene, not just the current target. Recheck immediately before that sink.
func native_save_reason() -> String:
	var reason := PathGuard.check_write("res://project.godot", ["godot"])
	if reason != "":
		return reason
	for root in EditorInterface.get_open_scene_roots():
		if root.scene_file_path == "":
			continue
		reason = PathGuard.check_write(root.scene_file_path, ["tscn", "scn"])
		if reason != "":
			return "An open scene has an unsafe save destination: " + reason
	return ""


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
		if obj is Node and parts[0] == "scene_file_path":
			errors.append("scene_file_path is managed by the scene tools and cannot be changed as a generic property.")
			continue
		var info := _find_property(obj, parts[0])
		if info.is_empty():
			errors.append("Unknown property '%s' on %s." % [parts[0], obj.get_class()])
			continue
		var target_info: Dictionary = info
		var target_type: int = info.type
		if parts.size() > 1:
			var current: Variant = obj.get(parts[0])
			var valid := true
			for i in range(1, parts.size()):
				var access := Codec.indexed_child(current, parts[i], i == parts.size() - 1)
				if not access.ok:
					errors.append("%s: %s" % [k, access.error])
					valid = false
					break
				current = access.value
				target_info = access.get("property", {})
			if not valid:
				continue
			target_type = target_info.get("type", typeof(current))
		var r := Codec.decode(props[key], target_type)
		if not r.ok:
			errors.append("%s: %s" % [k, r.error])
			continue
		var v: Variant = r.value
		if v is Resource and target_info.get("hint", 0) == PROPERTY_HINT_RESOURCE_TYPE and target_info.get("hint_string", "") != "":
			var allowed := false
			for cls in String(target_info.hint_string).split(","):
				if v.is_class(cls.strip_edges()):
					allowed = true
			if not allowed:
				errors.append("%s: expected a %s resource, got %s." % [k, target_info.hint_string, v.get_class()])
				continue
		values[k] = v
	return {"ok": errors.is_empty(), "values": values, "errors": errors}


## Groups decoded {key: value} (keys may be indexed like "position:x") into
## whole-property values {base: new_value}, applied on top of obj's current values.
func merge_indexed(obj: Object, values: Dictionary, errors: Array = []) -> Dictionary:
	var out := {}
	for k in values:
		var parts := String(k).split(":")
		var base := parts[0]
		var current: Variant = out[base] if out.has(base) else obj.get(base)
		if parts.size() == 1:
			out[base] = values[k]
		else:
			out[base] = Codec.with_indexed(current, Array(parts.slice(1)), values[k], errors)
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
	file_ops.touched_paths.clear()
	ur.commit_action()
	var history_id := EditorUndoRedoManager.GLOBAL_HISTORY
	if context != null:
		history_id = ur.get_object_history_id(context)
	_remember(history_id, name, file_ops.touched_paths)
	return name


## Native commit has no I/O result. Publish the checked disk edit first, then register it without replaying it.
func commit_file(label: String, do_method: String, do_args: Array, undo_method: String, undo_args: Array) -> Dictionary:
	var ur := EditorInterface.get_editor_undo_redo()
	if _file_busy or ur.is_committing_action():
		return Protocol.err(Protocol.BUSY, "Another file edit or native history callback is still running.")
	if not _file_registration_fault.is_empty():
		return Protocol.err(Protocol.INTERNAL, "A prior file edit changed disk but could not be registered in native history.", "Inspect that edit before applying further file changes.")
	_file_busy = true
	var result := _commit_file_locked(label, do_method, do_args, undo_method, undo_args, ur)
	_file_busy = false
	return result


func _commit_file_locked(label: String, do_method: String, do_args: Array, undo_method: String, undo_args: Array, ur: EditorUndoRedoManager) -> Dictionary:
	var action := FileAction.new(file_ops, do_method, do_args, undo_method, undo_args)
	var result: Dictionary = action.apply_forward()
	if not result.ok:
		return result
	_counter += 1
	var name := "%s%d: %s" % [ACTION_PREFIX, _counter, label]
	ur.create_action(name, UndoRedo.MERGE_DISABLE, null)
	ur.add_do_method(action, "redo_native")
	ur.add_undo_method(action, "undo_native")
	ur.commit_action(false)
	var hist := ur.get_history_undo_redo(EditorUndoRedoManager.GLOBAL_HISTORY)
	if hist == null or hist.get_current_action_name() != name:
		_file_registration_fault = {"name": name, "action": action}
		return Protocol.err(Protocol.INTERNAL, "File data was changed, but native undo registration was not confirmed.", "Do not repeat the write blindly; inspect the changed file and editor history.")
	_remember(EditorUndoRedoManager.GLOBAL_HISTORY, name, action.paths, action)
	return Protocol.ok({"action": name})


func _remember(history_id: int, name: String, paths: Array[String] = [], file_action: RefCounted = null) -> void:
	_actions.append({"history_id": history_id, "name": name, "paths": paths.duplicate(), "file_action": file_action, "sequence": _counter})
	_trim_actions()


func _trim_actions() -> void:
	while _actions.size() + _redo_actions.size() > MAX_TRACKED_ACTIONS:
		if _redo_actions.is_empty() or (not _actions.is_empty() and _actions.front().sequence <= _redo_actions.front().sequence):
			_actions.pop_front()
		else:
			_redo_actions.pop_front()


func _remember_redo(action: Dictionary) -> void:
	if action.get("file_action") != null and not _redo_actions.has(action):
		_redo_actions.append(action)
		_redo_actions.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.sequence < b.sequence)
	_trim_actions()


func _restore_file_redos(ur: EditorUndoRedoManager) -> void:
	var waiting: Array = []
	for action in _redo_actions:
		var hist := ur.get_history_undo_redo(action.history_id)
		var idx := -1
		if hist != null:
			for i in hist.get_history_count():
				if hist.get_action_name(i) == action.name:
					idx = i
					break
		if idx == -1:
			if not action.file_action.last_result.ok:
				_actions.append(action) # A lost failed action is a recovery blocker, not a successful human undo.
		elif idx <= hist.get_current_action() or not action.file_action.last_result.ok:
			# Native cursor movement can hide a failed inverse between MCP observations.
			_actions.append(action)
		else:
			waiting.append(action)
	_redo_actions = waiting
	_actions.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.sequence < b.sequence)


func tracked_action_count() -> int:
	return _actions.size() + _redo_actions.size()


## Undoes up to `steps` of our own actions. Returns {undone: [...], stopped_reason}.
func undo(steps: int) -> Dictionary:
	var ur := EditorInterface.get_editor_undo_redo()
	if _file_busy or ur.is_committing_action():
		return {"undone": [], "stopped_reason": "Another file edit or native history callback is still running.", "error": {"code": Protocol.BUSY, "message": "Another file edit or native history callback is still running."}}
	if not _file_registration_fault.is_empty():
		return {"undone": [], "stopped_reason": "A file edit changed disk without confirmed native history; its recovery record was retained.", "error": {"code": Protocol.INTERNAL, "message": "A file edit changed disk without confirmed native history; inspect it before undoing other edits."}}
	_file_busy = true
	var result := _undo_locked(steps, ur)
	_file_busy = false
	return result


func _undo_locked(steps: int, ur: EditorUndoRedoManager) -> Dictionary:
	_restore_file_redos(ur)
	var undone: Array = []
	var reason := ""
	var failure := {}
	while undone.size() < steps and not _actions.is_empty():
		var a: Dictionary = _actions.back()
		var file_action: RefCounted = a.get("file_action")
		var hist: UndoRedo = ur.get_history_undo_redo(a.history_id)
		if hist == null:
			if file_action != null and not file_action.last_result.ok:
				reason = "The native history of a failed file operation is no longer available; its recovery record was retained."
				failure = {"code": Protocol.INTERNAL, "message": reason}
				break
			_actions.pop_back() # history gone (scene closed)
			continue
		if hist.get_current_action_name() == a.name:
			if file_action != null and file_action.last_direction == "forward" and not file_action.last_result.ok:
				reason = "The native file redo failed. Its recovery record was retained; repair the filesystem and realign this action with the editor's undo/redo before retrying."
				failure = file_action.last_result.error.duplicate(true)
				failure.message = reason + " " + String(failure.message)
				break
			# An undo may happen hours later. Never reuse the original path validation after a folder changed.
			for path in a.get("paths", []):
				var blocked := PathGuard.check_write(path, [String(path).get_extension().to_lower()])
				if blocked != "":
					reason = "File path changed; undo was not applied: " + blocked
					failure = {"code": Protocol.PATH_FORBIDDEN, "message": reason}
					break
			if reason != "":
				break
			if file_action != null:
				var cursor := hist.get_current_action()
				if file_action.applied_direction != "inverse":
					var result: Dictionary = file_action.apply_inverse()
					if not result.ok:
						reason = "File undo failed; history was retained: " + String(result.error.message)
						failure = result.error.duplicate(true)
						failure.message = reason
						break
				if hist.get_current_action() != cursor or hist.get_current_action_name() != a.name:
					reason = "The file inverse completed, but editor history changed during it. No native history step was undone; check the state before retrying."
					failure = {"code": Protocol.INTERNAL, "message": reason}
					break
				# The native callback is synchronous; consume its history step without applying the inverse twice.
				file_action.skip_inverse_once = true
				var advanced := hist.undo()
				var consumed: bool = not file_action.skip_inverse_once
				file_action.skip_inverse_once = false
				if not advanced or not consumed or hist.get_current_action() != cursor - 1:
					reason = "The file inverse completed, but native undo did not advance. The recovery record was retained."
					failure = {"code": Protocol.INTERNAL, "message": reason}
					break
			else:
				hist.undo()
			_actions.pop_back()
			_remember_redo(a)
			undone.append(a.name.substr(a.name.find(": ") + 2))
			continue
		var idx := -1
		for i in hist.get_history_count():
			if hist.get_action_name(i) == a.name:
				idx = i
				break
		if idx == -1 or idx > hist.get_current_action():
			if idx == -1 and file_action != null and not file_action.last_result.ok:
				reason = "A failed file action lost its native history. Its recovery record was retained; no other edit was undone."
				failure = {"code": Protocol.INTERNAL, "message": reason}
				break
			if file_action != null and file_action.last_direction == "inverse" and not file_action.last_result.ok:
				# A GUI undo can move Godot's cursor even when its I/O callback failed. Retry only its immediate redo entry.
				if idx != hist.get_current_action() + 1:
					reason = "A native file undo failed and its history position changed. Its recovery record was retained; no other edit was undone."
					failure = {"code": Protocol.INTERNAL, "message": reason}
					break
				var result: Dictionary = file_action.apply_inverse()
				if not result.ok:
					reason = "File undo failed; recovery history was retained: " + String(result.error.message)
					failure = result.error.duplicate(true)
					failure.message = reason
					break
				_actions.pop_back()
				_remember_redo(a)
				undone.append(a.name.substr(a.name.find(": ") + 2))
				continue
			_actions.pop_back() # already undone by a human, or history cleared
			if idx != -1:
				_remember_redo(a)
			continue
		reason = "A later edit not made through MCP exists in the same history ('%s'). Undo it in the editor first." % hist.get_current_action_name()
		break
	var result := {"undone": undone, "stopped_reason": reason}
	if not failure.is_empty():
		result.error = failure
	return result

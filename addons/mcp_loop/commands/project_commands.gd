@tool
extends RefCounted
## project.info, input.action_set, edit.undo

const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")
const PathGuard = preload("res://addons/mcp_loop/util/path_guard.gd")

const SKIP_DIRS := [".godot", ".git", ".import", "node_modules"]

var ctx: RefCounted


func _init(context: RefCounted) -> void:
	ctx = context


func register(router: RefCounted) -> void:
	router.register("project.info", _info)
	router.register("input.action_set", _action_set)
	router.register("edit.undo", _undo)


const MOUSE_BUTTONS := {"left": MOUSE_BUTTON_LEFT, "right": MOUSE_BUTTON_RIGHT, "middle": MOUSE_BUTTON_MIDDLE}
var _action_name_re := RegEx.create_from_string("^[A-Za-z_][A-Za-z0-9_.]*$")


## Adds, replaces or removes an input action in project.godot (undoable).
func _action_set(p: Dictionary) -> Dictionary:
	var name := String(p.get("name", ""))
	if _action_name_re.search(name) == null:
		return Protocol.err(Protocol.INVALID_PARAMS, "Action names use letters, digits, '_' and '.' (got '%s')." % name)
	var key := "input/" + name
	var existed := ProjectSettings.has_setting(key)
	var old: Variant = ProjectSettings.get_setting(key) if existed else null
	var value: Variant = null
	var shown: Array = []
	if p.get("remove", false):
		if not existed:
			return Protocol.err(Protocol.INVALID_PARAMS, "There is no input action '%s'." % name)
	else:
		var events: Array = []
		for k in p.get("keys", []):
			var code := OS.find_keycode_from_string(String(k))
			if code == KEY_NONE:
				return Protocol.err(Protocol.INVALID_PARAMS, "Unknown key '%s' (examples: 'Space', 'A', 'Left', 'Escape', 'Shift')." % k)
			var ev := InputEventKey.new()
			ev.physical_keycode = code
			events.append(ev)
		for b in p.get("mouse_buttons", []):
			if not MOUSE_BUTTONS.has(String(b)):
				return Protocol.err(Protocol.INVALID_PARAMS, "Mouse buttons are 'left', 'right' or 'middle' (got '%s')." % b)
			var mb := InputEventMouseButton.new()
			mb.button_index = MOUSE_BUTTONS[String(b)]
			events.append(mb)
		for j in p.get("joypad_buttons", []):
			if int(j) < 0 or int(j) > 127:
				return Protocol.err(Protocol.INVALID_PARAMS, "Joypad buttons are numbered 0-127 (got %s)." % str(j))
			var jb := InputEventJoypadButton.new()
			jb.button_index = int(j)
			events.append(jb)
		if events.is_empty():
			return Protocol.err(Protocol.INVALID_PARAMS, "Give at least one of keys, mouse_buttons or joypad_buttons (or remove: true).")
		value = {"deadzone": float(p.get("deadzone", 0.2)), "events": events}
		shown = events.map(func(e: InputEvent) -> String: return e.as_text())
	var result := {"action": name, "created": not existed, "removed": value == null, "events": shown,
		"note": "Running games read input actions at start: use game_run with restart: true to apply."}
	if p.get("dry_run", false):
		result["dry_run"] = true
		return Protocol.ok(result)
	var ops: RefCounted = ctx.file_ops
	ctx.commit("input action %s" % name, null, func(ur: EditorUndoRedoManager) -> void:
		ur.add_do_method(ops, "set_project_setting", key, value)
		ur.add_undo_method(ops, "set_project_setting", key, old))
	return Protocol.ok(result)


func _info(p: Dictionary) -> Dictionary:
	var autoloads: Array = []
	var actions: Array = []
	var hidden := 0
	var with_builtin: bool = p.get("include_builtin_actions", false)
	for prop in ProjectSettings.get_property_list():
		var name: String = prop.name
		if name.begins_with("autoload/"):
			var path := String(ProjectSettings.get_setting(name))
			autoloads.append({"name": name.substr("autoload/".length()), "path": path.trim_prefix("*"), "singleton": path.begins_with("*")})
		elif name.begins_with("input/"):
			# Godot defines ~90 ui_* actions in every project; they bury the project's own.
			if name.begins_with("input/ui_") and not with_builtin:
				hidden += 1
				continue
			var a: Variant = ProjectSettings.get_setting(name)
			var events: Array = []
			if typeof(a) == TYPE_DICTIONARY:
				for e in a.get("events", []):
					if e is InputEvent:
						events.append(e.as_text())
			actions.append({"name": name.substr("input/".length()), "events": events})
	var out := {
		"name": ProjectSettings.get_setting("application/config/name", ""),
		"main_scene": ProjectSettings.get_setting("application/run/main_scene", ""),
		"godot_version": Engine.get_version_info().get("string", ""),
		"autoloads": autoloads,
		"input_actions": actions,
	}
	if hidden > 0:
		out["builtin_actions_hidden"] = hidden
	var glob: String = p.get("glob", "")
	if glob != "":
		var max_files: int = int(p.get("max_files", 200))
		var files: Array = []
		var truncated := _walk("res://", glob.trim_prefix("res://"), files, max_files)
		out["files"] = files
		out["files_truncated"] = truncated
	return Protocol.ok(out)


## Recursively collects files whose res-relative path matches glob. Returns true if truncated.
func _walk(dir_path: String, glob: String, out: Array, max_files: int) -> bool:
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return false
	for f in dir.get_files():
		var full := dir_path.path_join(f)
		if full.trim_prefix("res://").match(glob) or f.match(glob):
			if out.size() >= max_files:
				return true
			out.append(full)
	for d in dir.get_directories():
		if d.begins_with(".") or SKIP_DIRS.has(d):
			continue
		if _walk(dir_path.path_join(d), glob, out, max_files):
			return true
	return false


func _undo(p: Dictionary) -> Dictionary:
	var steps := int(p.get("steps", 1))
	var r: Dictionary = ctx.undo(steps)
	if r.undone.is_empty():
		if r.stopped_reason != "":
			return Protocol.err(Protocol.NOTHING_TO_UNDO, r.stopped_reason)
		return Protocol.err(Protocol.NOTHING_TO_UNDO, "There are no MCP edits left to undo.")
	return Protocol.ok(r)

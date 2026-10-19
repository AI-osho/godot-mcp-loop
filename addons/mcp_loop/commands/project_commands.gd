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
	router.register("project.setting.set", _setting_set)
	router.register("input.action_set", _action_set)
	router.register("edit.undo", _undo)


## Settings a tool may change. Everything else (rendering, physics, input map,
## autoloads, environment) stays with the editor: a wrong value there breaks the
## project in ways an agent cannot see.
const SETTINGS := {
	"application/config/name": {"kind": "string", "max_length": 120},
	"application/run/main_scene": {"kind": "scene"},
	"application/run/max_fps": {"kind": "int", "min": 0, "max": 1000},
	"display/window/size/viewport_width": {"kind": "int", "min": 1, "max": 7680},
	"display/window/size/viewport_height": {"kind": "int", "min": 1, "max": 4320},
	"display/window/size/window_width_override": {"kind": "int", "min": 0, "max": 7680},
	"display/window/size/window_height_override": {"kind": "int", "min": 0, "max": 4320},
	"display/window/stretch/mode": {"kind": "choice", "choices": ["disabled", "canvas_items", "viewport"]},
	"display/window/stretch/aspect": {"kind": "choice", "choices": ["ignore", "keep", "keep_width", "keep_height", "expand"]},
}


## Changes one project setting from the list above (undoable).
func _setting_set(p: Dictionary) -> Dictionary:
	var key := String(p.get("key", ""))
	if not SETTINGS.has(key):
		return Protocol.err(Protocol.INVALID_PARAMS, "'%s' is not a setting this tool may change." % key,
			"Allowed: " + ", ".join(SETTINGS.keys()))
	var converted := _convert_setting(SETTINGS[key], p.get("value"))
	if not converted.ok:
		return Protocol.err(Protocol.INVALID_PARAMS, converted.error)
	var value: Variant = converted.value
	var existed := ProjectSettings.has_setting(key)
	var old: Variant = ProjectSettings.get_setting(key) if existed else null
	var result := {
		"key": key, "before": old, "after": value, "changed": old != value,
		"note": "The editor window and a running game read most settings when they start: reopen the project or restart the game to apply.",
	}
	if p.get("dry_run", false):
		result["dry_run"] = true
		return Protocol.ok(result)
	if old == value:
		return Protocol.ok(result)
	var ops: RefCounted = ctx.file_ops
	ctx.commit("project setting %s" % key, null, func(ur: EditorUndoRedoManager) -> void:
		ur.add_do_method(ops, "set_project_setting", key, value)
		ur.add_undo_method(ops, "set_project_setting", key, old))
	return Protocol.ok(result)


## Returns {ok, value} or {ok: false, error}. Values may be sent as strings
## ("1280"), like every other editing tool accepts.
func _convert_setting(spec: Dictionary, raw: Variant) -> Dictionary:
	if raw == null:
		return {"ok": false, "error": "Give a 'value'."}
	match String(spec.kind):
		"int":
			var n: int
			if typeof(raw) == TYPE_INT:
				n = raw
			elif typeof(raw) == TYPE_FLOAT and float(raw) == floorf(raw):
				n = int(raw)
			elif typeof(raw) == TYPE_STRING and String(raw).strip_edges().is_valid_int():
				n = String(raw).strip_edges().to_int()
			else:
				return {"ok": false, "error": "Value must be a whole number (got %s)." % str(raw)}
			if n < int(spec.min) or n > int(spec.max):
				return {"ok": false, "error": "Value must be between %d and %d (got %d)." % [spec.min, spec.max, n]}
			return {"ok": true, "value": n}
		"string":
			if typeof(raw) != TYPE_STRING:
				return {"ok": false, "error": "Value must be a string (got %s)." % str(raw)}
			var s := String(raw).strip_edges()
			if s.is_empty():
				return {"ok": false, "error": "Value must not be empty."}
			if s.length() > int(spec.max_length):
				return {"ok": false, "error": "Value is longer than %d characters." % int(spec.max_length)}
			return {"ok": true, "value": s}
		"choice":
			if typeof(raw) != TYPE_STRING or not spec.choices.has(String(raw)):
				return {"ok": false, "error": "Value must be one of: %s." % ", ".join(spec.choices)}
			return {"ok": true, "value": String(raw)}
		"scene":
			if typeof(raw) != TYPE_STRING:
				return {"ok": false, "error": "Value must be a res:// path to a .tscn scene."}
			var path := String(raw).strip_edges()
			if not path.begins_with("res://") or not path.ends_with(".tscn"):
				return {"ok": false, "error": "Value must be a res:// path to a .tscn scene (got '%s')." % path}
			var reason := PathGuard.check_read(path)
			if reason != "":
				return {"ok": false, "error": reason}
			if not FileAccess.file_exists(path):
				return {"ok": false, "error": "Scene not found: %s (use project_info with glob '*.tscn')." % path}
			return {"ok": true, "value": path}
	return {"ok": false, "error": "Unsupported setting type."}


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
			ev.device = -1  # all devices, like actions made in the editor
			ev.physical_keycode = code
			events.append(ev)
		for b in p.get("mouse_buttons", []):
			if not MOUSE_BUTTONS.has(String(b)):
				return Protocol.err(Protocol.INVALID_PARAMS, "Mouse buttons are 'left', 'right' or 'middle' (got '%s')." % b)
			var mb := InputEventMouseButton.new()
			mb.device = -1
			mb.button_index = MOUSE_BUTTONS[String(b)]
			events.append(mb)
		for j in p.get("joypad_buttons", []):
			if int(j) < 0 or int(j) > 127:
				return Protocol.err(Protocol.INVALID_PARAMS, "Joypad buttons are numbered 0-127 (got %s)." % str(j))
			var jb := InputEventJoypadButton.new()
			jb.device = -1
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
		# Like PathGuard, never follow symbolic links: they can point outside the
		# project or back to a parent (endless recursion).
		if d.begins_with(".") or SKIP_DIRS.has(d) or dir.is_link(d):
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

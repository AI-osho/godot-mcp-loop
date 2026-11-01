@tool
extends RefCounted
## A file edit keeps its disk outcome separate from Godot's history bookkeeping.

const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")
const PathGuard = preload("res://addons/mcp_loop/util/path_guard.gd")

var _ops: RefCounted
var _forward: Dictionary
var _inverse: Dictionary
var paths: Array[String] = []
var last_result := Protocol.ok()
var last_direction := ""
var applied_direction := ""
var skip_inverse_once := false

func _init(ops: RefCounted, do_method: String, do_args: Array, undo_method: String, undo_args: Array) -> void:
	_ops = ops
	_forward = {"method": do_method, "args": _snapshot_args(do_method, do_args), "paths": _footprint(do_method, do_args)}
	_inverse = {"method": undo_method, "args": _snapshot_args(undo_method, undo_args), "paths": _footprint(undo_method, undo_args)}
	for p in _forward.paths + _inverse.paths:
		if not paths.has(p):
			paths.append(p)

static func snapshot_setting(value: Variant) -> Variant:
	if not value is Dictionary:
		return value
	var copy: Dictionary = value.duplicate(true)
	# The settings tool writes scalars; input actions additionally contain mutable native Resource instances.
	if copy.get("events") is Array:
		for i in copy.events.size():
			if copy.events[i] is InputEvent:
				copy.events[i] = copy.events[i].duplicate(true)
	return copy

static func _snapshot_args(method: String, args: Array) -> Array:
	var copy := args.duplicate(true)
	if method == "set_project_setting" and copy.size() > 1:
		copy[1] = snapshot_setting(args[1])
	return copy

static func _footprint(method: String, args: Array) -> Array[String]:
	if method == "set_project_setting":
		return ["res://project.godot"]
	var path := String(args[0])
	if method in ["write_bytes", "remove_asset"]:
		return [path, path + ".import"]
	return [path]

func _apply(step: Dictionary, direction: String) -> Dictionary:
	last_direction = direction
	for path in step.paths:
		var reason := PathGuard.check_write(path, [String(path).get_extension().to_lower()])
		if reason != "":
			last_result = Protocol.err(Protocol.PATH_FORBIDDEN, "File path changed; operation was not applied: " + reason)
			return last_result
	var result: Variant = _ops.callv(step.method, _snapshot_args(step.method, step.args))
	if not Protocol.is_envelope(result):
		last_result = Protocol.err(Protocol.INTERNAL, "The file operation did not report whether it succeeded.")
	else:
		last_result = result
	if last_result.ok:
		applied_direction = direction
	return last_result

func apply_forward() -> Dictionary:
	return _apply(_forward, "forward")

func apply_inverse() -> Dictionary:
	return _apply(_inverse, "inverse")

func redo_native() -> void:
	var result := apply_forward()
	if not result.ok:
		push_warning("[mcp_loop] File redo failed: " + String(result.error.message))

func undo_native() -> void:
	if skip_inverse_once:
		skip_inverse_once = false
		return
	var result := apply_inverse()
	if not result.ok:
		push_warning("[mcp_loop] File undo failed: " + String(result.error.message))

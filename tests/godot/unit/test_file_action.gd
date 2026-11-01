extends "res://tests/godot/test_case.gd"

const FileAction = preload("res://addons/mcp_loop/commands/file_action.gd")
const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")

class RecordingOps extends RefCounted:
	var key := ""
	var value: Variant
	func set_project_setting(k: String, v: Variant) -> Dictionary:
		key = k
		value = v
		return Protocol.ok()

func test_action_snapshots_mutable_arguments_and_input_events() -> void:
	var event := InputEventKey.new()
	event.physical_keycode = KEY_A
	var args: Array = ["input/fixture", {"deadzone": 0.2, "events": [event]}]
	var ops := RecordingOps.new()
	var action := FileAction.new(ops, "set_project_setting", args, "set_project_setting", ["input/fixture", null])
	args[0] = "input/changed"
	args[1].deadzone = 0.9
	event.physical_keycode = KEY_B
	assert_true(action.apply_forward().ok)
	assert_eq(ops.key, "input/fixture", "history must not retain its caller's mutable argument array")
	assert_eq(ops.value.deadzone, 0.2)
	assert_eq(ops.value.events[0].physical_keycode, KEY_A, "native input event resources also need independent snapshots")

func test_a_live_setting_does_not_mutate_the_next_redo_snapshot() -> void:
	var event := InputEventKey.new()
	event.physical_keycode = KEY_A
	var ops := RecordingOps.new()
	var action := FileAction.new(ops, "set_project_setting", ["input/fixture", {"deadzone": 0.2, "events": [event]}], "set_project_setting", ["input/fixture", null])
	assert_true(action.apply_forward().ok)
	ops.value.deadzone = 0.7
	ops.value.events[0].physical_keycode = KEY_C
	assert_true(action.apply_forward().ok)
	assert_eq(ops.value.deadzone, 0.2, "every playback must receive a fresh copy, not the history's frozen value")
	assert_eq(ops.value.events[0].physical_keycode, KEY_A)

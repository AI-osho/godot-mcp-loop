extends "res://tests/godot/test_case.gd"

const PlayCommands = preload("res://addons/mcp_loop/commands/play_commands.gd")


func test_steps_duration_matches_the_server_formula() -> void:
	assert_eq(PlayCommands.steps_duration_ms([{"action": "a"}]), 100)
	assert_eq(PlayCommands.steps_duration_ms([{"action": "a", "hold_ms": 500, "wait_ms": 200}]), 700)
	assert_eq(PlayCommands.steps_duration_ms([{"wait_frames": 60}]), 2000)
	assert_eq(PlayCommands.steps_duration_ms([{"action": "a", "hold_frames": 30}]), 1000)
	assert_eq(PlayCommands.steps_duration_ms([{"wait_for": {"node": "P", "property": "x", "op": ">", "value": 1, "timeout_ms": 3000}}]), 3000)
	assert_eq(PlayCommands.steps_duration_ms([{"call": {"node": "G", "method": "m"}}]), 10000)
	assert_eq(PlayCommands.steps_duration_ms([{"set": {"node": "G", "properties": {"a": 1}}}]), 0)

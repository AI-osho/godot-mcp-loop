extends "res://tests/godot/test_case.gd"

const EditorContext = preload("res://addons/mcp_loop/commands/context.gd")
const LogCapture = preload("res://addons/mcp_loop/util/log_capture.gd")


func test_remembered_actions_are_bounded() -> void:
	var ctx := EditorContext.new(LogCapture.new(10))
	for i in EditorContext.MAX_TRACKED_ACTIONS + 25:
		ctx._remember(0, "MCP#%d: x" % i)
	assert_eq(ctx.tracked_action_count(), EditorContext.MAX_TRACKED_ACTIONS)
	assert_eq(ctx._actions.back().name, "MCP#%d: x" % (EditorContext.MAX_TRACKED_ACTIONS + 24), "newest kept")

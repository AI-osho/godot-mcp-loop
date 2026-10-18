extends "res://tests/godot/test_case.gd"

const RuntimeAgent = preload("res://addons/mcp_loop/runtime/runtime_agent.gd")
const RuntimeCommands = preload("res://addons/mcp_loop/runtime/runtime_commands.gd")


# A request arriving through the debugger poll (which GDScript runs between lines of the game's code) must not run
# there: it is queued for the next deferred flush.
func test_requests_are_queued_not_run_inside_the_debugger_poll() -> void:
	var agent = RuntimeAgent.new()
	assert_eq(agent._on_message("request", [{"id": 1, "method": "query", "params": {}}]), true)
	assert_eq(agent._on_message("request", [{"id": 2, "method": "query", "params": {}}]), true)
	assert_eq(agent._pending.size(), 2)
	agent._pending.clear()
	agent.free()


func test_other_messages_are_not_taken() -> void:
	var agent = RuntimeAgent.new()
	assert_eq(agent._on_message("something_else", [{}]), false)
	assert_eq(agent._on_message("request", []), false)
	assert_eq(agent._pending.size(), 0)
	agent.free()


func test_movie_frame_rate_comes_from_the_command_line() -> void:
	assert_eq(RuntimeCommands.movie_fps(PackedStringArray(["--path", "/p", "--write-movie", "/m/frame.png", "--fixed-fps", "24"])), 24)
	assert_eq(RuntimeCommands.movie_fps(PackedStringArray(["--path", "/p"])), 0)
	assert_eq(RuntimeCommands.movie_fps(PackedStringArray(["--write-movie", "/m/frame.png"])), 60)

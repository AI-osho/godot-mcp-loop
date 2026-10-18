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


# While recording, a wait counts frames of the movie's fixed step (the time scale doesn't change the step).
func test_movie_frame_length_in_game_time() -> void:
	assert_true(absf(RuntimeCommands.movie_frame_ms(true, 1.0 / 30.0, 1.0) - 1000.0 / 30.0) < 0.001)
	assert_true(absf(RuntimeCommands.movie_frame_ms(true, 0.5 / 60.0, 0.5) - 1000.0 / 60.0) < 0.001)
	assert_eq(RuntimeCommands.movie_frame_ms(false, 1.0 / 30.0, 1.0), 0.0) # not recording: real time
	assert_eq(RuntimeCommands.movie_frame_ms(true, 0.0, 1.0), 0.0) # first frame, step not known yet
	assert_eq(RuntimeCommands.movie_frame_ms(true, 0.0, 0.0), 0.0) # frozen game: real time, so the wait still ends

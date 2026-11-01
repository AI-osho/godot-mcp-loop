@tool
extends EditorDebuggerPlugin
## Editor side of the game channel. Tracks the running game's runtime agent,
## relays requests to it, stores its logs (they outlive the game process) and
## auto-continues debugger breaks so a script error doesn't freeze the loop.

const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")
const LogCapture = preload("res://addons/mcp_loop/util/log_capture.gd")

const GAME_PAUSED := "GAME_PAUSED"

var game_logs := LogCapture.new(5000)
var runtime_info := {}
var session_id := -1
var ready := false
var paused := false
var pause_on_error := false
var break_count := 0

var _responses := {}
var _pending := {}
var _generation := 0
var _next_id := 1


func _has_capture(prefix: String) -> bool:
	return prefix == "mcp_loop"


func _setup_session(id: int) -> void:
	var s := get_session(id)
	s.started.connect(_on_started.bind(id))
	s.stopped.connect(_on_stopped.bind(id))
	s.breaked.connect(_on_breaked.bind(id))
	s.continued.connect(_on_continued.bind(id))
	if s.is_active():
		_on_started(id)


func _on_started(id: int) -> void:
	if session_id >= 0 and session_id != id:
		return
	_generation += 1
	_pending.clear()
	_responses.clear()
	session_id = id
	ready = false
	paused = false
	runtime_info = {}


func _capture(message: String, data: Array, id: int) -> bool:
	match message:
		"mcp_loop:hello":
			if id < 0 or id != session_id or ready or data.is_empty() or typeof(data[0]) != TYPE_DICTIONARY:
				return true
			runtime_info = data[0].duplicate(true)
			ready = true
			paused = false
		"mcp_loop:response":
			if ready and id == session_id and not data.is_empty() and typeof(data[0]) == TYPE_DICTIONARY:
				var request_id: Variant = data[0].get("id")
				if typeof(request_id) != TYPE_INT:
					return true
				var owner: Dictionary = _pending.get(request_id, {})
				if owner.get("session") == id and owner.get("generation") == _generation and not _responses.has(request_id):
					_responses[request_id] = data[0].duplicate(true)
		"mcp_loop:logs":
			if id >= 0 and id == session_id and not data.is_empty() and typeof(data[0]) == TYPE_ARRAY:
				for e in data[0]:
					if typeof(e) == TYPE_DICTIONARY:
						game_logs.append(e)
		_:
			return false
	return true


func _on_breaked(_can_debug: bool, id: int) -> void:
	if id < 0 or id != session_id:
		return
	break_count += 1
	if pause_on_error:
		paused = true
		game_logs.append({"level": "error", "message": "[debugger] Game paused on a script error or breakpoint (pause_on_error=true)."})
	else:
		game_logs.append({"level": "error", "message": "[debugger] Game hit a script error or breakpoint; auto-continued."})
		get_session(id).send_message("continue", [])


func _on_continued(id: int) -> void:
	if id >= 0 and id == session_id:
		paused = false


func _on_stopped(id: int) -> void:
	if id != session_id:
		return
	ready = false
	paused = false
	session_id = -1
	_generation += 1
	_pending.clear()
	_responses.clear()
	game_logs.append({"level": "info", "message": "[debugger] Game stopped."})


func reset_for_run(pause_mode: bool) -> void:
	ready = false
	paused = false
	session_id = -1
	pause_on_error = pause_mode
	break_count = 0
	runtime_info = {}
	_generation += 1
	_pending.clear()
	_responses.clear()
	game_logs.clear()


func current_generation() -> int:
	return _generation


func status() -> Dictionary:
	return {
		"connected": ready,
		"paused": paused,
		"scene": runtime_info.get("scene", null),
		"display": runtime_info.get("display", null),
		"errors": game_logs.count("error"),
		"debugger_breaks": break_count,
	}


func call_runtime(tree: SceneTree, method: String, params: Dictionary, timeout_ms: int) -> Dictionary:
	if not ready or session_id < 0 or not get_session(session_id).is_active():
		return Protocol.err(Protocol.GAME_NOT_RUNNING, "The game is not running.", "Start it with game_run.")
	if paused:
		return Protocol.err(GAME_PAUSED, "The game is paused in the debugger after a script error.",
			"Read logs_read(source='game'), fix the code, then game_stop / game_run.")
	var id := _next_id
	_next_id += 1
	var owner_session := session_id
	var owner_generation := _generation
	_pending[id] = {"session": owner_session, "generation": owner_generation}
	get_session(owner_session).send_message("mcp_loop:request", [{"id": id, "method": method, "params": params}])
	var result := await _wait_response(tree, id, owner_session, owner_generation, method, timeout_ms)
	_pending.erase(id)
	_responses.erase(id)
	return result


func _wait_response(tree: SceneTree, id: int, owner_session: int, owner_generation: int, method: String, timeout_ms: int) -> Dictionary:
	var deadline := Time.get_ticks_msec() + timeout_ms
	while true:
		if not ready or owner_session != session_id or owner_generation != _generation:
			return Protocol.err(Protocol.GAME_NOT_RUNNING, "The game stopped while handling '%s'." % method,
				"Check logs_read(source='game') for a crash or error.")
		if _responses.has(id):
			var res: Dictionary = _responses[id]
			res.erase("id")
			return res
		if paused:
			return Protocol.err(GAME_PAUSED, "The game paused in the debugger while handling '%s'." % method)
		if Time.get_ticks_msec() > deadline:
			return Protocol.err(Protocol.TIMEOUT, "The game did not answer '%s' within %d ms." % [method, timeout_ms])
		await tree.process_frame
	return Protocol.err(Protocol.INTERNAL, "The runtime response wait ended unexpectedly.")

extends Node
## Autoload "MCPLoopRuntime", added by the MCP Loop editor plugin.
## Active only when the game was launched from the editor with the debugger
## attached; in exported/release builds it removes itself immediately.
## Talks to the editor through the debugger channel ("mcp_loop:*" messages):
##   editor -> game: request {id, method, params}
##   game -> editor: hello, response {id, ok, ...}, logs [entries]

const RuntimeCommands = preload("res://addons/mcp_loop/runtime/runtime_commands.gd")
const LogCapture = preload("res://addons/mcp_loop/util/log_capture.gd")

const FLUSH_INTERVAL_MS := 200

var _cmds: RuntimeCommands
var _log: LogCapture
var _log_cursor := 1
var _last_flush := 0
## Requests waiting for a safe point (see _on_message).
var _pending: Array[Dictionary] = []


func _ready() -> void:
	if Engine.is_editor_hint() or not EngineDebugger.is_active():
		queue_free()
		return
	process_mode = Node.PROCESS_MODE_ALWAYS
	_cmds = RuntimeCommands.new(get_tree())
	_log = LogCapture.new(2000)
	OS.add_logger(_log)
	EngineDebugger.register_message_capture("mcp_loop", _on_message)
	# Autoloads are ready before the main scene; wait one frame so it exists.
	await get_tree().process_frame
	var scene := get_tree().current_scene
	EngineDebugger.send_message("mcp_loop:hello", [{
		"pid": OS.get_process_id(),
		"scene": scene.scene_file_path if scene != null else "",
		"display": DisplayServer.get_name(),
	}])


func _exit_tree() -> void:
	if _log == null:
		return
	_flush_logs()
	OS.remove_logger(_log)
	if EngineDebugger.has_capture("mcp_loop"):
		EngineDebugger.unregister_message_capture("mcp_loop")


func _process(_delta: float) -> void:
	if _log != null and Time.get_ticks_msec() - _last_flush >= FLUSH_INTERVAL_MS:
		_flush_logs()


func _flush_logs() -> void:
	_last_flush = Time.get_ticks_msec()
	var r := _log.read(_log_cursor, "info", 500)
	_log_cursor = r.next
	if not r.entries.is_empty():
		EngineDebugger.send_message("mcp_loop:logs", [r.entries])


# The capture receives the message name without the "mcp_loop:" prefix.
# GDScript polls the debugger every few thousand executed lines, so this can be called in the middle of the game's own
# code (e.g. inside a loop over enemies). Running a command right here could free or change what that code is using,
# so requests are queued and handled at the next deferred-call flush, between callbacks.
func _on_message(message: String, data: Array) -> bool:
	if message != "request" or data.is_empty() or typeof(data[0]) != TYPE_DICTIONARY:
		return false
	_pending.append(data[0])
	if _pending.size() == 1:
		_drain.call_deferred()
	return true


func _drain() -> void:
	var batch := _pending
	_pending = []
	for req in batch:
		_handle(req) # not awaited: requests still run side by side


func _handle(req: Dictionary) -> void:
	var params: Variant = req.get("params", {})
	var res: Dictionary = await _cmds.handle(String(req.get("method", "")), params if typeof(params) == TYPE_DICTIONARY else {})
	_flush_logs() # logs caused by the request arrive before its response
	var out := {"id": req.get("id")}
	out.merge(res)
	EngineDebugger.send_message("mcp_loop:response", [out])

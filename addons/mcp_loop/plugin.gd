@tool
extends EditorPlugin
## godot-mcp-loop editor plugin: exposes the editor to an MCP server over a
## localhost WebSocket bridge (see docs/protocol.md).

const Router = preload("res://addons/mcp_loop/bridge/router.gd")
const WsServer = preload("res://addons/mcp_loop/bridge/ws_server.gd")
const SessionFile = preload("res://addons/mcp_loop/bridge/session_file.gd")
const LogCapture = preload("res://addons/mcp_loop/util/log_capture.gd")
const EditorContext = preload("res://addons/mcp_loop/commands/context.gd")
const ProjectCommands = preload("res://addons/mcp_loop/commands/project_commands.gd")
const SceneCommands = preload("res://addons/mcp_loop/commands/scene_commands.gd")
const NodeCommands = preload("res://addons/mcp_loop/commands/node_commands.gd")
const ScriptCommands = preload("res://addons/mcp_loop/commands/script_commands.gd")
const PlayCommands = preload("res://addons/mcp_loop/commands/play_commands.gd")
const AssetCommands = preload("res://addons/mcp_loop/commands/asset_commands.gd")
const DebuggerBridge = preload("res://addons/mcp_loop/debugger/debugger_bridge.gd")
const ActivityBoost = preload("res://addons/mcp_loop/util/activity_boost.gd")

const AUTOLOAD_NAME := "MCPLoopRuntime"
const AUTOLOAD_PATH := "res://addons/mcp_loop/runtime/runtime_agent.gd"

const PORT_FROM := 6510
const PORT_RANGE := 10
## Keep the editor loop fast for this long after the last request (model think time).
const BOOST_HOLD_MS := 30000

var _router: Router
var _server: WsServer
var _session: SessionFile
var _log_capture: LogCapture
var _ctx: EditorContext
var _modules: Array = []
var _debugger: DebuggerBridge
var _boost: ActivityBoost


func _enter_tree() -> void:
	_log_capture = LogCapture.new()
	OS.add_logger(_log_capture)
	_ctx = EditorContext.new(_log_capture)
	_debugger = DebuggerBridge.new()
	add_debugger_plugin(_debugger)
	# The runtime agent must be an autoload for games launched from the editor.
	if not ProjectSettings.has_setting("autoload/" + AUTOLOAD_NAME):
		add_autoload_singleton(AUTOLOAD_NAME, AUTOLOAD_PATH)
		# Persist now: games launched from the editor read project.godot from disk.
		ProjectSettings.save()

	var token := SessionFile.generate_token()
	_router = Router.new(token)
	_modules = [
		ProjectCommands.new(_ctx),
		SceneCommands.new(_ctx),
		NodeCommands.new(_ctx),
		ScriptCommands.new(_ctx),
		AssetCommands.new(_ctx),
		PlayCommands.new(_ctx, _debugger, get_tree()),
	]
	for m in _modules:
		m.register(_router)

	_boost = ActivityBoost.new(_editor_sleep_usec)
	_server = WsServer.new(_router)
	var env_port := OS.get_environment("MCP_LOOP_PORT")
	var from := int(env_port) if env_port.is_valid_int() else PORT_FROM
	var port := _server.start(from, from + PORT_RANGE - 1)
	if port < 0:
		push_error("[mcp_loop] Could not bind any port in %d-%d. Bridge disabled." % [from, from + PORT_RANGE - 1])
		return
	_session = SessionFile.new()
	var err := _session.write(port, token)
	if err != OK:
		push_error("[mcp_loop] Could not write %s (%s)." % [_session.path(), error_string(err)])
	print("[mcp_loop] Bridge listening on 127.0.0.1:%d" % port)


func _exit_tree() -> void:
	if _boost != null:
		_boost.update(false)
	if _server != null:
		_server.stop()
	if _session != null:
		_session.remove()
	if _log_capture != null:
		OS.remove_logger(_log_capture)
	if _debugger != null:
		remove_debugger_plugin(_debugger)
	_modules.clear()


func _disable_plugin() -> void:
	if ProjectSettings.has_setting("autoload/" + AUTOLOAD_NAME):
		remove_autoload_singleton(AUTOLOAD_NAME)


func _process(_delta: float) -> void:
	if _server != null:
		_server.poll()
		_boost.update(_router.is_busy(Time.get_ticks_msec(), BOOST_HOLD_MS))


## The editor's own loop sleep for the current window focus state.
func _editor_sleep_usec() -> int:
	var settings := EditorInterface.get_editor_settings()
	var focused := get_window() != null and get_window().has_focus()
	var key := "interface/editor/timers/low_processor_mode_sleep_usec" if focused \
		else "interface/editor/timers/unfocused_low_processor_mode_sleep_usec"
	return int(settings.get_setting(key)) if settings.has_setting(key) else 6900

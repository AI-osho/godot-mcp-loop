@tool
extends EditorPlugin
## godot-mcp-loop editor plugin: exposes the editor to an MCP server over a
## localhost WebSocket bridge (see docs/protocol.md).

const Router = preload("res://addons/mcp_loop/bridge/router.gd")
const WsServer = preload("res://addons/mcp_loop/bridge/ws_server.gd")
const SessionFile = preload("res://addons/mcp_loop/bridge/session_file.gd")

const PORT_FROM := 6510
const PORT_RANGE := 10

var _router: Router
var _server: WsServer
var _session: SessionFile


func _enter_tree() -> void:
	var token := SessionFile.generate_token()
	_router = Router.new(token)
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
	if _server != null:
		_server.stop()
	if _session != null:
		_session.remove()


func _process(_delta: float) -> void:
	if _server != null:
		_server.poll()

extends RefCounted
## Localhost-only WebSocket server for the bridge. Poll it every frame.
## Exactly one client at a time: a new connection replaces the previous one
## (useful when the MCP server restarts) and must authenticate again via hello.

const Router = preload("res://addons/mcp_loop/bridge/router.gd")

const BIND_ADDRESS := "127.0.0.1"
const BUFFER_SIZE := 32 * 1024 * 1024
const HANDSHAKE_TIMEOUT_MS := 5000

var _router: Router
var _tcp := TCPServer.new()
var _port := -1
var _peer: WebSocketPeer = null
# Connections that finished TCP accept but not the WebSocket handshake yet.
var _pending: Array = [] # of {peer: WebSocketPeer, since: int}
# Bumped whenever the active peer changes so late async responses are dropped.
var _generation := 0
# Replaced peers kept alive until their close frame is flushed.
var _closing: Array = []


func _init(router: Router) -> void:
	_router = router


func get_router() -> Router:
	return _router


func get_port() -> int:
	return _port


## Binds the first free port in [from, to]. Returns the port or -1.
func start(from: int, to: int) -> int:
	for port in range(from, to + 1):
		if _tcp.listen(port, BIND_ADDRESS) == OK:
			_port = port
			return port
	return -1


func stop() -> void:
	if _peer != null:
		_peer.close(1001, "server stopping")
		_peer = null
	for p in _pending:
		p.peer.close()
	_pending.clear()
	_tcp.stop()
	_port = -1
	_router.reset_session()


func is_client_connected() -> bool:
	return _peer != null and _peer.get_ready_state() == WebSocketPeer.STATE_OPEN


## Pushes an unsolicited event to the client (only after it authenticated).
func send_event(event: String, data: Variant) -> void:
	if is_client_connected() and _router.is_authenticated():
		_peer.send_text(JSON.stringify({"event": event, "data": data}))


func poll() -> void:
	if not _tcp.is_listening():
		return
	while _tcp.is_connection_available():
		var ws := WebSocketPeer.new()
		ws.inbound_buffer_size = BUFFER_SIZE
		ws.outbound_buffer_size = BUFFER_SIZE
		ws.max_queued_packets = 4096
		if ws.accept_stream(_tcp.take_connection()) == OK:
			_pending.append({"peer": ws, "since": Time.get_ticks_msec()})

	_poll_pending()
	_poll_active()


func _poll_pending() -> void:
	var still: Array = []
	for p in _pending:
		var ws: WebSocketPeer = p.peer
		ws.poll()
		var state := ws.get_ready_state()
		if state == WebSocketPeer.STATE_OPEN:
			_promote(ws)
		elif state == WebSocketPeer.STATE_CONNECTING and Time.get_ticks_msec() - p.since < HANDSHAKE_TIMEOUT_MS:
			still.append(p)
		else:
			ws.close()
	_pending = still


func _promote(ws: WebSocketPeer) -> void:
	if _peer != null:
		_peer.close(4000, "replaced by a new connection")
		# Keep polling the old peer briefly so the close frame is flushed.
		_closing.append(_peer)
	_peer = ws
	_generation += 1
	_router.reset_session()



func _poll_active() -> void:
	for old in _closing:
		old.poll()
	_closing = _closing.filter(func(o: WebSocketPeer) -> bool: return o.get_ready_state() != WebSocketPeer.STATE_CLOSED)

	if _peer == null:
		return
	_peer.poll()
	var state := _peer.get_ready_state()
	if state == WebSocketPeer.STATE_CLOSED:
		_peer = null
		_generation += 1
		_router.reset_session()
		return
	if state != WebSocketPeer.STATE_OPEN:
		return
	while _peer.get_available_packet_count() > 0:
		var pkt := _peer.get_packet()
		if not _peer.was_string_packet():
			continue
		_dispatch(pkt.get_string_from_utf8(), _generation)


func _dispatch(text: String, generation: int) -> void:
	var response: String = await _router.handle_text(text)
	# Drop the response if the client changed while the handler was running.
	if generation == _generation and is_client_connected():
		_peer.send_text(response)

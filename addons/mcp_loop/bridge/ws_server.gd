extends RefCounted
## Localhost-only WebSocket server for the bridge. Poll it every frame.
## Exactly one authenticated client at a time. A new connection stays a
## "candidate" until it sends a valid hello; only then does it replace the
## active client. Unauthenticated connections can never disturb the active
## session, are capped in number and are dropped after hello_timeout_ms.

const Router = preload("res://addons/mcp_loop/bridge/router.gd")
const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")

const BIND_ADDRESS := "127.0.0.1"
## Inbound: scripts up to 1 MB as JSON. Outbound: screenshots as base64.
const INBOUND_BUFFER := 4 * 1024 * 1024
const OUTBOUND_BUFFER := 24 * 1024 * 1024
const HANDSHAKE_TIMEOUT_MS := 5000
## All non-active peers share one cap, including rejected peers flushing a reply or waiting for a close handshake.
const MAX_WAITING := 3
const REJECT_GRACE_MS := 250
const CLOSE_TIMEOUT_MS := 1000

var hello_timeout_ms := 5000

var _router: Router
var _tcp := TCPServer.new()
var _port := -1
var _peer: WebSocketPeer = null
var _pending: Array = []    # WebSocket handshake in progress: {peer, since}
var _candidates: Array = [] # open, not authenticated yet: {peer, since}
var _closing: Array = []    # replaced/rejected peers: {peer, since}
var _to_close: Array = []   # rejected candidates: {peer, code, reason}; closed once their reply is flushed
var _transports: Dictionary = {} # peer -> owned TCP transport; retained so a withheld close handshake can be forced down
# Bumped whenever the active peer changes so late async responses are dropped.
var _generation := 0


func _init(router: Router) -> void:
	_router = router


func get_router() -> Router:
	return _router


func get_port() -> int:
	return _port


func waiting_count() -> int:
	return _pending.size() + _candidates.size() + _to_close.size() + _closing.size()


## Binds the first free port in [from, to]. Returns the port or -1.
func start(from: int, to: int) -> int:
	for port in range(from, to + 1):
		if _tcp.listen(port, BIND_ADDRESS) == OK:
			_port = port
			return port
	return -1


func stop() -> void:
	for ws in _transports:
		ws.close(1001, "server stopping")
		_transports[ws].disconnect_from_host()
	_transports.clear()
	_peer = null
	_pending.clear()
	_candidates.clear()
	_to_close.clear()
	_closing.clear()
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
		var conn := _tcp.take_connection()
		if waiting_count() >= MAX_WAITING:
			conn.disconnect_from_host()
			continue
		var ws := WebSocketPeer.new()
		ws.inbound_buffer_size = INBOUND_BUFFER
		ws.outbound_buffer_size = OUTBOUND_BUFFER
		ws.max_queued_packets = 1024
		if ws.accept_stream(conn) == OK:
			_transports[ws] = conn
			_pending.append({"peer": ws, "since": Time.get_ticks_msec()})
		else:
			conn.disconnect_from_host()

	_poll_pending()
	_poll_candidates()
	_poll_active()


func _poll_pending() -> void:
	var still: Array = []
	for p in _pending:
		var ws: WebSocketPeer = p.peer
		ws.poll()
		var state := ws.get_ready_state()
		if state == WebSocketPeer.STATE_OPEN:
			_candidates.append({"peer": ws, "since": Time.get_ticks_msec()})
		elif state == WebSocketPeer.STATE_CONNECTING and Time.get_ticks_msec() - p.since < HANDSHAKE_TIMEOUT_MS:
			still.append(p)
		else:
			ws.close()
			_drop_peer(ws)
	_pending = still


func _poll_candidates() -> void:
	var still: Array = []
	for c in _candidates:
		var ws: WebSocketPeer = c.peer
		ws.poll()
		if ws.get_ready_state() != WebSocketPeer.STATE_OPEN:
			_drop_peer(ws)
			continue
		if Time.get_ticks_msec() - c.since > hello_timeout_ms:
			_reject(ws, 4002, "hello timeout")
			continue
		var keep := true
		while keep and ws.get_available_packet_count() > 0:
			var pkt := ws.get_packet()
			if not ws.was_string_packet():
				continue
			var text := pkt.get_string_from_utf8()
			var json := JSON.new()
			var req: Variant = json.data if json.parse(text) == OK else null
			var id: Variant = req.get("id") if typeof(req) == TYPE_DICTIONARY else null
			if typeof(req) == TYPE_DICTIONARY and req.get("method") == "hello":
				var params: Variant = req.get("params", {})
				var check := _router.verify_hello(params if typeof(params) == TYPE_DICTIONARY else {})
				if check.ok:
					_promote(ws)
					_dispatch(text, _generation)
				else:
					ws.send_text(JSON.stringify(_with_id(id, check)))
					_reject(ws, 4003, "unauthorized")
				keep = false
			else:
				ws.send_text(JSON.stringify(_with_id(id, Protocol.err(Protocol.UNAUTHORIZED, "Send a successful 'hello' first."))))
		if keep:
			still.append(c)
	_candidates = still


func _reject(ws: WebSocketPeer, code: int, reason: String) -> void:
	# Close only after any queued reply (e.g. the UNAUTHORIZED error) is sent.
	_to_close.append({"peer": ws, "code": code, "reason": reason, "since": Time.get_ticks_msec()})


func _drop_peer(ws: WebSocketPeer) -> void:
	if _transports.has(ws):
		_transports[ws].disconnect_from_host()
		_transports.erase(ws)


func _with_id(id: Variant, envelope: Dictionary) -> Dictionary:
	var out := {"id": id}
	out.merge(envelope)
	return out


func _promote(ws: WebSocketPeer) -> void:
	if _peer != null:
		_peer.close(4000, "replaced by a new authenticated connection")
		_closing.append({"peer": _peer, "since": Time.get_ticks_msec()})
	_peer = ws
	_generation += 1
	_router.reset_session()


func _poll_active() -> void:
	var still: Array = []
	for t in _to_close:
		var ws: WebSocketPeer = t.peer
		ws.poll()
		# Grace period: some clients (incl. Godot's WebSocketPeer) drop data that
		# arrives in the same read as the close frame.
		var age: int = Time.get_ticks_msec() - int(t.since)
		if (ws.get_current_outbound_buffered_amount() == 0 and age >= REJECT_GRACE_MS) or age > 1000:
			ws.close(t.code, t.reason)
			_closing.append({"peer": ws, "since": Time.get_ticks_msec()})
		else:
			still.append(t)
	_to_close = still
	var closing: Array = []
	for old in _closing:
		var ws: WebSocketPeer = old.peer
		ws.poll()
		if ws.get_ready_state() == WebSocketPeer.STATE_CLOSED or Time.get_ticks_msec() - int(old.since) >= CLOSE_TIMEOUT_MS:
			_drop_peer(ws)
		else:
			closing.append(old)
	_closing = closing

	if _peer == null:
		return
	_peer.poll()
	var state := _peer.get_ready_state()
	if state == WebSocketPeer.STATE_CLOSED:
		_drop_peer(_peer)
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

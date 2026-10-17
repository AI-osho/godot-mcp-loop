extends "res://tests/godot/test_case.gd"

const WsServer = preload("res://addons/mcp_loop/bridge/ws_server.gd")
const Router = preload("res://addons/mcp_loop/bridge/router.gd")
const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")

const TOKEN := "tok"
const PORT_FROM := 16510
const PORT_TO := 16519

var _servers: Array = []


func after_each() -> void:
	for s in _servers:
		s.stop()
	_servers.clear()


func _make_server() -> Object:
	var s := WsServer.new(Router.new(TOKEN))
	_servers.append(s)
	return s


# Polls server and client until the predicate is true or max frames elapse.
func _pump(server: Object, client: WebSocketPeer, until: Callable, max_frames: int = 300) -> bool:
	for i in max_frames:
		server.poll()
		client.poll()
		if until.call():
			return true
		await tree.process_frame
	return false


func _connect(server: Object, port: int) -> WebSocketPeer:
	var client := WebSocketPeer.new()
	client.connect_to_url("ws://127.0.0.1:%d" % port)
	await _pump(server, client, func() -> bool: return client.get_ready_state() == WebSocketPeer.STATE_OPEN)
	return client


func _request(server: Object, client: WebSocketPeer, req: Dictionary) -> Dictionary:
	client.send_text(JSON.stringify(req))
	var got := await _pump(server, client, func() -> bool: return client.get_available_packet_count() > 0)
	if not got:
		return {}
	return JSON.parse_string(client.get_packet().get_string_from_utf8())


func test_start_binds_first_free_port_in_range() -> void:
	var s := _make_server()
	var port: int = s.start(PORT_FROM, PORT_TO)
	assert_eq(port, PORT_FROM)


func test_second_server_gets_next_port() -> void:
	var a := _make_server()
	var b := _make_server()
	assert_eq(a.start(PORT_FROM, PORT_TO), PORT_FROM)
	assert_eq(b.start(PORT_FROM, PORT_TO), PORT_FROM + 1)


func test_start_returns_minus_one_when_range_exhausted() -> void:
	var a := _make_server()
	var b := _make_server()
	a.start(PORT_FROM, PORT_FROM)
	assert_eq(b.start(PORT_FROM, PORT_FROM), -1)


func test_client_hello_and_ping_round_trip() -> void:
	var s := _make_server()
	var port: int = s.start(PORT_FROM, PORT_TO)
	var c := await _connect(s, port)
	assert_eq(c.get_ready_state(), WebSocketPeer.STATE_OPEN)
	var hello := await _request(s, c, {"id": 1, "method": "hello", "params": {"token": TOKEN, "protocol": Protocol.VERSION}})
	assert_eq(hello.get("ok"), true)
	var pong := await _request(s, c, {"id": 2, "method": "ping", "params": {}})
	assert_eq(pong.get("result"), {"pong": true})
	assert_true(s.is_client_connected())


func test_new_connection_replaces_old_and_requires_new_hello() -> void:
	var s := _make_server()
	var port: int = s.start(PORT_FROM, PORT_TO)
	var c1 := await _connect(s, port)
	await _request(s, c1, {"id": 1, "method": "hello", "params": {"token": TOKEN, "protocol": Protocol.VERSION}})
	var c2 := await _connect(s, port)
	var closed := await _pump(s, c1, func() -> bool: return c1.get_ready_state() == WebSocketPeer.STATE_CLOSED)
	assert_true(closed, "old client should be closed")
	var res := await _request(s, c2, {"id": 3, "method": "ping", "params": {}})
	assert_error_code(res, Protocol.UNAUTHORIZED)


func test_large_message_round_trip() -> void:
	var s := _make_server()
	var router: Object = s.get_router()
	router.register("echo", func(p: Dictionary) -> Dictionary: return Protocol.ok({"len": String(p["s"]).length()}))
	var port: int = s.start(PORT_FROM, PORT_TO)
	var c := WebSocketPeer.new()
	c.outbound_buffer_size = 4 * 1024 * 1024
	c.inbound_buffer_size = 4 * 1024 * 1024
	c.connect_to_url("ws://127.0.0.1:%d" % port)
	await _pump(s, c, func() -> bool: return c.get_ready_state() == WebSocketPeer.STATE_OPEN)
	await _request(s, c, {"id": 1, "method": "hello", "params": {"token": TOKEN, "protocol": Protocol.VERSION}})
	var big := "x".repeat(1024 * 1024)
	var res := await _request(s, c, {"id": 2, "method": "echo", "params": {"s": big}})
	assert_eq(res.get("result", {}).get("len"), 1048576.0)


func test_event_is_pushed_to_connected_client() -> void:
	var s := _make_server()
	var port: int = s.start(PORT_FROM, PORT_TO)
	var c := await _connect(s, port)
	await _request(s, c, {"id": 1, "method": "hello", "params": {"token": TOKEN, "protocol": Protocol.VERSION}})
	s.send_event("game.started", {"scene": "res://a.tscn"})
	var got := await _pump(s, c, func() -> bool: return c.get_available_packet_count() > 0)
	assert_true(got)
	var msg: Dictionary = JSON.parse_string(c.get_packet().get_string_from_utf8())
	assert_eq(msg, {"event": "game.started", "data": {"scene": "res://a.tscn"}})

extends "res://tests/godot/test_case.gd"

const Router = preload("res://addons/mcp_loop/bridge/router.gd")
const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")

const TOKEN := "secret-token"


func _hello(router: Router, token: String = TOKEN, protocol: int = Protocol.VERSION) -> Dictionary:
	return await router.handle({"id": 0, "method": "hello", "params": {"token": token, "protocol": protocol}})


func test_request_before_hello_is_unauthorized() -> void:
	var router := Router.new(TOKEN)
	var res: Dictionary = await router.handle({"id": 1, "method": "ping", "params": {}})
	assert_error_code(res, Protocol.UNAUTHORIZED)
	assert_eq(res.get("id"), 1)


func test_hello_with_wrong_token_is_unauthorized() -> void:
	var router := Router.new(TOKEN)
	var res := await _hello(router, "wrong")
	assert_error_code(res, Protocol.UNAUTHORIZED)
	assert_false(router.is_authenticated())


func test_hello_with_wrong_protocol_is_rejected() -> void:
	var router := Router.new(TOKEN)
	var res := await _hello(router, TOKEN, 999)
	assert_error_code(res, Protocol.PROTOCOL_MISMATCH)
	assert_false(router.is_authenticated())


func test_hello_success_returns_server_info() -> void:
	var router := Router.new(TOKEN)
	var res := await _hello(router)
	assert_eq(res.get("ok"), true)
	assert_eq(res.get("id"), 0)
	assert_eq(res["result"]["protocol"], Protocol.VERSION)
	assert_has(res["result"], "godot_version")
	assert_true(router.is_authenticated())


func test_ping_after_hello() -> void:
	var router := Router.new(TOKEN)
	await _hello(router)
	var res: Dictionary = await router.handle({"id": 2, "method": "ping", "params": {}})
	assert_eq(res, {"id": 2, "ok": true, "result": {"pong": true}})


func test_unknown_method() -> void:
	var router := Router.new(TOKEN)
	await _hello(router)
	var res: Dictionary = await router.handle({"id": 3, "method": "nope.nothing", "params": {}})
	assert_error_code(res, Protocol.UNKNOWN_METHOD)


func test_registered_sync_handler_receives_params() -> void:
	var router := Router.new(TOKEN)
	router.register("math.add", func(p: Dictionary) -> Dictionary: return Protocol.ok({"sum": p["a"] + p["b"]}))
	await _hello(router)
	var res: Dictionary = await router.handle({"id": 4, "method": "math.add", "params": {"a": 2, "b": 3}})
	assert_eq(res, {"id": 4, "ok": true, "result": {"sum": 5}})


func test_registered_async_handler_is_awaited() -> void:
	var router := Router.new(TOKEN)
	router.register("slow.echo", func(p: Dictionary) -> Dictionary:
		await tree.process_frame
		return Protocol.ok({"echo": p["v"]}))
	await _hello(router)
	var res: Dictionary = await router.handle({"id": 5, "method": "slow.echo", "params": {"v": "hi"}})
	assert_eq(res, {"id": 5, "ok": true, "result": {"echo": "hi"}})


func test_handler_error_is_passed_through_with_id() -> void:
	var router := Router.new(TOKEN)
	router.register("x.fail", func(_p: Dictionary) -> Dictionary:
		return Protocol.err(Protocol.NODE_NOT_FOUND, "no such node", "check scene_tree"))
	await _hello(router)
	var res: Dictionary = await router.handle({"id": 6, "method": "x.fail", "params": {}})
	assert_error_code(res, Protocol.NODE_NOT_FOUND)
	assert_eq(res.get("id"), 6)
	assert_eq(res["error"]["hint"], "check scene_tree")


func test_handler_returning_non_envelope_is_internal_error() -> void:
	var router := Router.new(TOKEN)
	router.register("x.bad", func(_p: Dictionary) -> Variant: return 42)
	await _hello(router)
	var res: Dictionary = await router.handle({"id": 7, "method": "x.bad", "params": {}})
	assert_error_code(res, Protocol.INTERNAL)


func test_missing_params_defaults_to_empty_dict() -> void:
	var router := Router.new(TOKEN)
	router.register("x.count", func(p: Dictionary) -> Dictionary: return Protocol.ok({"n": p.size()}))
	await _hello(router)
	var res: Dictionary = await router.handle({"id": 8, "method": "x.count"})
	assert_eq(res["result"]["n"], 0)


func test_non_dictionary_params_is_invalid() -> void:
	var router := Router.new(TOKEN)
	await _hello(router)
	var res: Dictionary = await router.handle({"id": 9, "method": "ping", "params": [1, 2]})
	assert_error_code(res, Protocol.INVALID_PARAMS)


func test_handle_text_rejects_malformed_json() -> void:
	var router := Router.new(TOKEN)
	var out: String = await router.handle_text("{not json")
	var res: Dictionary = JSON.parse_string(out)
	assert_error_code(res, Protocol.INVALID_PARAMS)
	assert_eq(res.get("id"), null)


func test_handle_text_round_trip() -> void:
	var router := Router.new(TOKEN)
	await router.handle_text(JSON.stringify({"id": 0, "method": "hello", "params": {"token": TOKEN, "protocol": Protocol.VERSION}}))
	var out: String = await router.handle_text(JSON.stringify({"id": 10, "method": "ping", "params": {}}))
	var res: Dictionary = JSON.parse_string(out)
	# JSON numbers come back as float.
	assert_eq(res.get("id"), 10.0)
	assert_eq(res.get("ok"), true)


func test_reset_session_requires_new_hello() -> void:
	var router := Router.new(TOKEN)
	await _hello(router)
	router.reset_session()
	var res: Dictionary = await router.handle({"id": 11, "method": "ping", "params": {}})
	assert_error_code(res, Protocol.UNAUTHORIZED)


func test_hello_reports_the_addon_version_from_plugin_cfg() -> void:
	var cfg := ConfigFile.new()
	assert_eq(cfg.load("res://addons/mcp_loop/plugin.cfg"), OK)
	var expected := str(cfg.get_value("plugin", "version"))
	var router := Router.new(TOKEN)
	var res := await _hello(router)
	assert_eq(res.result.addon_version, expected)
	assert_eq(Protocol.addon_version(), expected)


# ---- busy tracking (drives the editor's responsiveness boost) ----

func test_router_is_busy_while_a_request_runs_and_for_a_hold_period_after() -> void:
	var router := Router.new(TOKEN)
	assert_false(router.is_busy(Time.get_ticks_msec(), 1000), "idle before any request")
	await _hello(router)
	var gate := {"open": false}
	router.register("slow", func(_p: Dictionary) -> Dictionary:
		while not gate.open:
			await tree.process_frame
		return Protocol.ok({}))
	var done := {"v": false}
	var run := func() -> void:
		await router.handle({"id": 1, "method": "slow", "params": {}})
		done.v = true
	run.call()
	await tree.process_frame
	var far_future := Time.get_ticks_msec() + 100000
	assert_true(router.is_busy(far_future, 1000), "busy while a handler is running")
	gate.open = true
	while not done.v:
		await tree.process_frame
	assert_true(router.is_busy(Time.get_ticks_msec(), 1000), "still busy within the hold period")
	assert_false(router.is_busy(far_future, 1000), "idle after the hold period")

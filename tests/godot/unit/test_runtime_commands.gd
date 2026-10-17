extends "res://tests/godot/test_case.gd"

const RuntimeCommands = preload("res://addons/mcp_loop/runtime/runtime_commands.gd")
const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")

var _scene: Node2D
var _cmds: RuntimeCommands


func _setup() -> void:
	_scene = Node2D.new()
	_scene.name = "Main"
	var player := Node2D.new()
	player.name = "Player"
	player.position = Vector2(10, 20)
	_scene.add_child(player)
	tree.root.add_child(_scene)
	tree.current_scene = _scene
	_cmds = RuntimeCommands.new(tree)


func after_each() -> void:
	if is_instance_valid(_scene):
		_scene.queue_free()
		await tree.process_frame
	for a in ["mcp_test_move", "mcp_test_jump"]:
		if InputMap.has_action(a):
			InputMap.erase_action(a)


func test_query_relative_to_current_scene() -> void:
	_setup()
	var r: Dictionary = await _cmds.handle("query", {"node": "Player", "properties": ["position", "position:x"]})
	assert_eq(r.ok, true, JSON.stringify(r))
	assert_eq(r.result.properties, {"position": [10.0, 20.0], "position:x": 10.0})


func test_query_absolute_path() -> void:
	_setup()
	var r: Dictionary = await _cmds.handle("query", {"node": "/root/Main/Player", "properties": ["name"]})
	assert_eq(r.result.properties, {"name": "Player"})


func test_query_without_properties_gives_overview() -> void:
	_setup()
	var r: Dictionary = await _cmds.handle("query", {"node": "."})
	assert_eq(r.result.type, "Node2D")
	assert_eq(r.result.children, ["Player"])
	assert_has(r.result.properties, "position")


func test_query_missing_node() -> void:
	_setup()
	var r: Dictionary = await _cmds.handle("query", {"node": "Nobody"})
	assert_error_code(r, Protocol.NODE_NOT_FOUND)


func test_query_unknown_property() -> void:
	_setup()
	var r: Dictionary = await _cmds.handle("query", {"node": "Player", "properties": ["nope"]})
	assert_error_code(r, Protocol.INVALID_PARAMS)


func test_wait_for_already_true_returns_immediately() -> void:
	_setup()
	var r: Dictionary = await _cmds.handle("wait_for", {"node": "Player", "property": "position:x", "op": "==", "value": 10, "timeout_ms": 0})
	assert_eq(r.ok, true, JSON.stringify(r))
	assert_eq(r.result.met, true)
	assert_eq(r.result.value, 10.0)


func test_wait_for_becomes_true_later() -> void:
	_setup()
	var player := _scene.get_node("Player")
	tree.create_timer(0.1).timeout.connect(func() -> void: player.position.x = 500)
	var r: Dictionary = await _cmds.handle("wait_for", {"node": "Player", "property": "position:x", "op": ">", "value": 100, "timeout_ms": 2000})
	assert_eq(r.result.met, true)
	assert_true(r.result.elapsed_ms >= 50)


func test_wait_for_times_out_with_last_value() -> void:
	_setup()
	var r: Dictionary = await _cmds.handle("wait_for", {"node": "Player", "property": "position:x", "op": ">", "value": 100, "timeout_ms": 100})
	assert_error_code(r, Protocol.TIMEOUT)
	assert_true(r.error.message.contains("10"), r.error.message)


func test_wait_for_invalid_operator() -> void:
	_setup()
	var r: Dictionary = await _cmds.handle("wait_for", {"node": "Player", "property": "position", "op": ">", "value": 1, "timeout_ms": 0})
	assert_error_code(r, Protocol.INVALID_PARAMS)


func test_input_action_hold_presses_then_releases() -> void:
	_setup()
	InputMap.add_action("mcp_test_move")
	var seen := []
	var poll := func() -> void: seen.append(Input.is_action_pressed("mcp_test_move"))
	tree.process_frame.connect(poll)
	var r: Dictionary = await _cmds.handle("input", {"steps": [{"action": "mcp_test_move", "hold_ms": 100}]})
	tree.process_frame.disconnect(poll)
	assert_eq(r.ok, true, JSON.stringify(r))
	assert_true(seen.has(true), "action should be pressed during the hold")
	await tree.process_frame
	assert_false(Input.is_action_pressed("mcp_test_move"), "action released afterwards")


func test_input_press_and_release_steps() -> void:
	_setup()
	InputMap.add_action("mcp_test_jump")
	await _cmds.handle("input", {"steps": [{"action": "mcp_test_jump", "press": true}]})
	await tree.process_frame
	assert_true(Input.is_action_pressed("mcp_test_jump"))
	await _cmds.handle("input", {"steps": [{"action": "mcp_test_jump", "release": true}]})
	await tree.process_frame
	assert_false(Input.is_action_pressed("mcp_test_jump"))


func test_input_unknown_action_is_rejected_before_running() -> void:
	_setup()
	var r: Dictionary = await _cmds.handle("input", {"steps": [{"wait_ms": 10}, {"action": "does_not_exist"}]})
	assert_error_code(r, Protocol.INVALID_PARAMS)
	assert_true(r.error.message.contains("does_not_exist"))


func test_input_key_and_wait() -> void:
	_setup()
	var t0 := Time.get_ticks_msec()
	var r: Dictionary = await _cmds.handle("input", {"steps": [{"key": "Space", "hold_ms": 30}, {"wait_ms": 50}]})
	assert_eq(r.ok, true, JSON.stringify(r))
	assert_true(Time.get_ticks_msec() - t0 >= 70)


func test_input_invalid_key() -> void:
	_setup()
	var r: Dictionary = await _cmds.handle("input", {"steps": [{"key": "NotAKey"}]})
	assert_error_code(r, Protocol.INVALID_PARAMS)


func test_screenshot_headless_reports_rendering_unavailable() -> void:
	_setup()
	var r: Dictionary = await _cmds.handle("screenshot", {})
	if DisplayServer.get_name() == "headless":
		assert_error_code(r, Protocol.RENDERING_UNAVAILABLE)


func test_unknown_runtime_method() -> void:
	_setup()
	var r: Dictionary = await _cmds.handle("fly", {})
	assert_error_code(r, Protocol.UNKNOWN_METHOD)


func test_input_rejects_excessive_durations_and_step_counts() -> void:
	_setup()
	var r: Dictionary = await _cmds.handle("input", {"steps": [{"wait_ms": RuntimeCommands.MAX_STEP_MS + 1}]})
	assert_error_code(r, Protocol.INVALID_PARAMS)
	r = await _cmds.handle("input", {"steps": [{"key": "Space", "hold_ms": RuntimeCommands.MAX_STEP_MS + 1}]})
	assert_error_code(r, Protocol.INVALID_PARAMS)
	var many: Array = []
	for i in RuntimeCommands.MAX_STEPS + 1:
		many.append({"wait_ms": 0})
	r = await _cmds.handle("input", {"steps": many})
	assert_error_code(r, Protocol.INVALID_PARAMS)


# ---- immediate checks (timeout 0) fail as assertions with the actual value ----

func test_wait_for_with_zero_timeout_fails_as_assertion() -> void:
	_setup()
	var r: Dictionary = await _cmds.handle("wait_for", {"node": "Player", "property": "position:x", "op": ">", "value": 600, "timeout_ms": 0})
	assert_error_code(r, Protocol.ASSERTION_FAILED)
	assert_string_contains(r.error.message, "position:x > 600")
	assert_string_contains(r.error.message, "Actual value: 10")


# ---- game_input record ----

func test_input_record_samples_values_while_steps_run() -> void:
	_setup()
	var player := _scene.get_node("Player")
	tree.create_timer(0.1).timeout.connect(func() -> void: player.position.x = 500)
	tree.create_timer(0.2).timeout.connect(func() -> void: player.position.x = 250)
	var r: Dictionary = await _cmds.handle("input", {"steps": [{"wait_ms": 300}],
		"record": {"node": "Player", "properties": ["position:x"]}})
	assert_eq(r.ok, true, JSON.stringify(r))
	var rec: Dictionary = r.result.record
	var x: Dictionary = rec.summary["position:x"]
	assert_eq(x.first, 10.0)
	assert_eq(x.min, 10.0)
	assert_eq(x.max, 500.0)
	assert_eq(x.last, 250.0)
	assert_true(x.max_at_ms >= 50 and x.max_at_ms <= 250, str(x.max_at_ms))
	assert_true(rec.samples_total >= 3, str(rec.samples_total))
	assert_true(rec.samples.size() <= 50)
	assert_has(rec.samples[0], "t_ms")
	assert_has(rec.samples[0], "position:x")


func test_input_record_interval_limits_samples() -> void:
	_setup()
	var r: Dictionary = await _cmds.handle("input", {"steps": [{"wait_ms": 300}],
		"record": {"node": "Player", "properties": ["position"], "interval_ms": 100}})
	assert_eq(r.ok, true, JSON.stringify(r))
	assert_true(r.result.record.samples_total <= 5, str(r.result.record.samples_total))
	# Non-numeric values only report first/last.
	assert_eq(r.result.record.summary["position"], {"first": [10.0, 20.0], "last": [10.0, 20.0]})


func test_input_record_validates_before_running() -> void:
	_setup()
	var bad_prop: Dictionary = await _cmds.handle("input", {"steps": [{"wait_ms": 10}],
		"record": {"node": "Player", "properties": ["nope"]}})
	assert_error_code(bad_prop, Protocol.INVALID_PARAMS)
	var bad_node: Dictionary = await _cmds.handle("input", {"steps": [{"wait_ms": 10}],
		"record": {"node": "Nobody", "properties": ["position"]}})
	assert_error_code(bad_node, Protocol.NODE_NOT_FOUND)
	var no_props: Dictionary = await _cmds.handle("input", {"steps": [{"wait_ms": 10}],
		"record": {"node": "Player", "properties": []}})
	assert_error_code(no_props, Protocol.INVALID_PARAMS)


# ---- indexed paths in the running game ----

func _scene_with_items() -> Node2D:
	_setup()
	var s := GDScript.new()
	s.source_code = "extends Node2D\nvar items := [1, 2]\n"
	s.reload()
	var holder := Node2D.new()
	holder.name = "Holder"
	holder.set_script(s)
	_scene.add_child(holder)
	return holder


func test_query_reads_array_elements() -> void:
	_scene_with_items()
	var r: Dictionary = await _cmds.handle("query", {"node": "Holder", "properties": ["items:1"]})
	assert_eq(r.ok, true, JSON.stringify(r))
	assert_eq(r.result.properties["items:1"], 2)


func test_query_bad_index_is_a_clear_error() -> void:
	_scene_with_items()
	var r: Dictionary = await _cmds.handle("query", {"node": "Holder", "properties": ["items:5"]})
	assert_error_code(r, Protocol.INVALID_PARAMS)
	assert_string_contains(r.error.message, "out of range")


func test_wait_for_index_that_appears_later() -> void:
	var holder := _scene_with_items()
	tree.create_timer(0.1).timeout.connect(func() -> void: holder.items.append(99))
	var r: Dictionary = await _cmds.handle("wait_for", {"node": "Holder", "property": "items:2", "op": "==", "value": 99, "timeout_ms": 2000})
	assert_eq(r.ok, true, JSON.stringify(r))


func test_assert_on_unreadable_index_explains_the_path_problem() -> void:
	_scene_with_items()
	var r: Dictionary = await _cmds.handle("wait_for", {"node": "Holder", "property": "items:5", "op": "==", "value": 1, "timeout_ms": 0})
	assert_error_code(r, Protocol.ASSERTION_FAILED)
	assert_string_contains(r.error.message, "out of range")
	assert_false(str(r.error.get("hint", "")).contains("timeout"), "hint should be about the path, not timeouts")


func test_record_accepts_indexed_paths() -> void:
	_scene_with_items()
	var r: Dictionary = await _cmds.handle("input", {"steps": [{"wait_ms": 50}], "record": {"node": "Holder", "properties": ["items:0"]}})
	assert_eq(r.ok, true, JSON.stringify(r))
	assert_eq(r.result.record.summary["items:0"].first, 1)


# ---- set / call in the running game ----

const SETTABLE_SRC := """extends Node2D
var count := 1
var label := "a"
var enabled := true
var items := [1, 2, 3]
var stats := {"hp": 10}
var area := Rect2(0, 0, 4, 4)
var calls := 0

func add(a: int, b: int = 10) -> int:
	calls += 1
	return a + b

func place(at: Vector2) -> Vector2:
	position = at
	return position

func later(v: int) -> int:
	await get_tree().process_frame
	return v * 2
"""


func _settable() -> Node2D:
	_setup()
	var s := GDScript.new()
	s.source_code = SETTABLE_SRC
	s.reload()
	var n := Node2D.new()
	n.name = "Game"
	n.set_script(s)
	_scene.add_child(n)
	return n


func test_set_top_level_values_with_type_conversion() -> void:
	var g := _settable()
	var r: Dictionary = await _cmds.handle("set", {"node": "Game", "properties": {"count": 5.0, "label": "zz", "enabled": "false"}})
	assert_eq(r.ok, true, JSON.stringify(r))
	assert_eq(g.count, 5)
	assert_eq(typeof(g.count), TYPE_INT)
	assert_eq(g.label, "zz")
	assert_eq(g.enabled, false)
	assert_eq(r.result.changes["count"], {"before": 1, "after": 5})


func test_set_members_elements_and_keys() -> void:
	var g := _settable()
	var r: Dictionary = await _cmds.handle("set", {"node": "Game", "properties": {
		"position:x": 40, "items:1": 99, "stats:hp": 3, "area:size": [8, 2]}})
	assert_eq(r.ok, true, JSON.stringify(r))
	assert_eq(g.position.x, 40.0)
	assert_eq(g.items, [1, 99, 3])
	assert_eq(g.stats.hp, 3)
	assert_eq(g.area.size, Vector2(8, 2))


func test_set_is_all_or_nothing() -> void:
	var g := _settable()
	var r: Dictionary = await _cmds.handle("set", {"node": "Game", "properties": {"count": 7, "items:9": 1}})
	assert_error_code(r, Protocol.INVALID_PARAMS)
	assert_string_contains(r.error.message, "out of range")
	assert_eq(g.count, 1, "nothing applied when one value is invalid")


func test_set_rejects_bad_values_and_unknown_properties() -> void:
	_settable()
	var bad: Dictionary = await _cmds.handle("set", {"node": "Game", "properties": {"count": "lots"}})
	assert_error_code(bad, Protocol.INVALID_PARAMS)
	var unknown: Dictionary = await _cmds.handle("set", {"node": "Game", "properties": {"nope": 1}})
	assert_error_code(unknown, Protocol.INVALID_PARAMS)
	var missing: Dictionary = await _cmds.handle("set", {"node": "Nobody", "properties": {"count": 1}})
	assert_error_code(missing, Protocol.NODE_NOT_FOUND)


func test_call_converts_args_and_returns_the_result() -> void:
	var g := _settable()
	var r: Dictionary = await _cmds.handle("call", {"node": "Game", "method": "add", "args": [2.0]})
	assert_eq(r.ok, true, JSON.stringify(r))
	assert_eq(r.result.returned, 12)
	assert_eq(g.calls, 1)
	var v: Dictionary = await _cmds.handle("call", {"node": "Game", "method": "place", "args": [[3, 4]]})
	assert_eq(v.result.returned, [3.0, 4.0])


func test_call_awaits_coroutines() -> void:
	_settable()
	var r: Dictionary = await _cmds.handle("call", {"node": "Game", "method": "later", "args": [21]})
	assert_eq(r.ok, true, JSON.stringify(r))
	assert_eq(r.result.returned, 42)


func test_call_rejects_unknown_methods_and_bad_arity() -> void:
	_settable()
	var unknown: Dictionary = await _cmds.handle("call", {"node": "Game", "method": "nope"})
	assert_error_code(unknown, Protocol.INVALID_PARAMS)
	assert_string_contains(unknown.error.message, "add")
	var few: Dictionary = await _cmds.handle("call", {"node": "Game", "method": "add", "args": []})
	assert_error_code(few, Protocol.INVALID_PARAMS)
	var many: Dictionary = await _cmds.handle("call", {"node": "Game", "method": "add", "args": [1, 2, 3]})
	assert_error_code(many, Protocol.INVALID_PARAMS)
	var bad: Dictionary = await _cmds.handle("call", {"node": "Game", "method": "add", "args": ["x"]})
	assert_error_code(bad, Protocol.INVALID_PARAMS)


func test_input_record_changes_mode_keeps_only_changed_values() -> void:
	_setup()
	var player := _scene.get_node("Player")
	tree.create_timer(0.1).timeout.connect(func() -> void: player.position.x = 50)
	tree.create_timer(0.2).timeout.connect(func() -> void: player.position.x = 90)
	var r: Dictionary = await _cmds.handle("input", {"steps": [{"wait_ms": 300}],
		"record": {"node": "Player", "properties": ["position:x"], "mode": "changes"}})
	assert_eq(r.ok, true, JSON.stringify(r))
	var rec: Dictionary = r.result.record
	var xs: Array = rec.samples.map(func(s: Dictionary) -> Variant: return s["position:x"])
	assert_eq(xs, [10.0, 50.0, 90.0], "first value plus each change; the forced final sample repeats nothing")
	assert_eq(rec.summary["position:x"].max, 90.0)
	assert_eq(rec.summary["position:x"].last, 90.0)
	assert_true(rec.frames_observed > rec.samples_total, "frames are still observed every frame")


func test_input_record_rejects_unknown_mode() -> void:
	_setup()
	var r: Dictionary = await _cmds.handle("input", {"steps": [{"wait_ms": 10}],
		"record": {"node": "Player", "properties": ["position"], "mode": "sometimes"}})
	assert_error_code(r, Protocol.INVALID_PARAMS)

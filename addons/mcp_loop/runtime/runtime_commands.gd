@tool
extends RefCounted
## In-game commands executed by the runtime agent: query, input, wait_for, screenshot.
## Independent of the debugger channel so it can be unit-tested in a plain SceneTree.

const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")
const Codec = preload("res://addons/mcp_loop/util/value_codec.gd")
const PropertyPath = preload("res://addons/mcp_loop/util/property_path.gd")
const Compare = preload("res://addons/mcp_loop/util/compare.gd")
const Stepper = preload("res://addons/mcp_loop/runtime/stepper.gd")

const MAX_WAIT_MS := 120_000
## Input sequences: per-step hold/wait limit and maximum number of steps.
const MAX_STEP_MS := 60_000
const MAX_STEPS := 200
const OVERVIEW_PROPS := ["position", "global_position", "rotation", "scale", "visible", "velocity", "text", "size"]

var _tree: SceneTree
## True when the game records a movie (Movie Maker); waits then count game time, see movie_frame_ms().
var _movie := false


func _init(tree: SceneTree) -> void:
	_tree = tree
	_movie = Engine.get_write_movie_path() != ""


## Length of one frame in game milliseconds while recording a movie. Movie Maker runs the game at a fixed step
## (1/fps per frame) as fast as it can render — faster or slower than real time — so a timeout in real time would
## cover a different stretch of the game. 0 when not recording (or not known): waits then use real time.
static func movie_frame_ms(recording: bool, delta: float, time_scale: float) -> float:
	if not recording or delta <= 0.0 or time_scale <= 0.0:
		return 0.0
	return delta / time_scale * 1000.0


## Clock for a wait: game time from the frame count while recording (frame_ms > 0), else real time.
func _clock_ms(frame_ms: float) -> int:
	if frame_ms > 0.0:
		return int(Engine.get_process_frames() * frame_ms)
	return Time.get_ticks_msec()


func handle(method: String, p: Dictionary) -> Dictionary:
	match method:
		"query":
			return _query(p)
		"input":
			return await _input(p)
		"wait_for":
			return await _wait_for(p)
		"screenshot":
			return await _screenshot(p)
		"set":
			return _set_properties(p)
		"call":
			return await _call_method(p)
		"pause":
			return _pause(p)
		"step":
			return await _step(p)
		"ui.audit":
			return _ui_audit(p)
		"in_view":
			return _in_view(p)
		"ray":
			return _ray(p)
		"contacts":
			return _contacts(p)
		"quit":
			return _quit()
	return Protocol.err(Protocol.UNKNOWN_METHOD, "Unknown runtime method '%s'." % method)


## Ends the game the normal way (so a Movie Maker recording is finished); answers first.
func _quit() -> Dictionary:
	_tree.create_timer(0.1, true, false, true).timeout.connect(func() -> void: _tree.quit())
	return Protocol.ok({"quitting": true})


# ------------------------------------------------------------------ nodes

func _resolve(path: String) -> Node:
	var p := path.strip_edges()
	var scene := _tree.current_scene
	if p == "" or p == ".":
		return scene
	if p.begins_with("/"):
		return _tree.root.get_node_or_null(NodePath(p))
	if scene == null:
		return null
	var n := scene.get_node_or_null(NodePath(p))
	if n == null and p.begins_with(String(scene.name) + "/"):
		n = scene.get_node_or_null(NodePath(p.substr(String(scene.name).length() + 1)))
	return n


func _not_found(path: String) -> Dictionary:
	var scene_name: String = String(_tree.current_scene.name) if _tree.current_scene else "(none)"
	return Protocol.err(Protocol.NODE_NOT_FOUND, "No node '%s' in the running game." % path,
		"Paths are relative to the running scene '%s', or absolute like /root/%s/Player." % [scene_name, scene_name])


func _has_property(obj: Object, key: String) -> bool:
	return PropertyPath.has_head(obj, key)


func _query(p: Dictionary) -> Dictionary:
	var path := String(p.get("node", "."))
	var node := _resolve(path)
	if node == null:
		return _not_found(path)
	var out := {}
	var names: Variant = p.get("properties", null)
	if typeof(names) == TYPE_ARRAY and not names.is_empty():
		for k in names:
			var key := String(k)
			var got := PropertyPath.read(node, key)
			if not got.ok:
				return Protocol.err(Protocol.INVALID_PARAMS, got.error)
			out[key] = Codec.encode(got.value)
		return Protocol.ok({"node": str(node.get_path()), "properties": out})
	for key in OVERVIEW_PROPS:
		if _has_property(node, key):
			out[key] = Codec.encode(node.get(key))
	var script: Script = node.get_script()
	if script != null:
		for info in script.get_script_property_list():
			if info.usage & PROPERTY_USAGE_SCRIPT_VARIABLE:
				out[info.name] = Codec.encode(node.get(info.name))
	return Protocol.ok({
		"node": str(node.get_path()),
		"type": node.get_class(),
		"children": node.get_children().map(func(c: Node) -> String: return String(c.name)),
		"properties": out,
	})


# ------------------------------------------------------------------ set / call

func _set_properties(p: Dictionary) -> Dictionary:
	var path := String(p.get("node", "."))
	var node := _resolve(path)
	if node == null:
		return _not_found(path)
	var props: Variant = p.get("properties")
	if typeof(props) != TYPE_DICTIONARY or props.is_empty():
		return Protocol.err(Protocol.INVALID_PARAMS, "'properties' must be a non-empty object {path: value}.")
	# Validate everything first so a bad value leaves the game untouched.
	var prepared := {}
	for key in props:
		var w := PropertyPath.prepare_write(node, String(key), props[key])
		if not w.ok:
			return Protocol.err(Protocol.INVALID_PARAMS, w.error, "Nothing was changed.")
		prepared[String(key)] = w
	var changes := {}
	for key in prepared:
		prepared[key].apply.call()
		var after := PropertyPath.read(node, key)
		changes[key] = {"before": Codec.encode(prepared[key].before), "after": Codec.encode(after.get("value"))}
	return Protocol.ok({"node": str(node.get_path()), "changes": changes})


func _call_method(p: Dictionary) -> Dictionary:
	var path := String(p.get("node", "."))
	var node := _resolve(path)
	if node == null:
		return _not_found(path)
	var method := String(p.get("method", ""))
	var prepared := _prepare_call(node, method, p.get("args", []))
	if not prepared.ok:
		return prepared
	var result: Variant = node.callv(method, prepared.result)
	# A coroutine returns a function state; wait for its real result.
	if result is Object and is_instance_valid(result) and result.has_signal("completed"):
		result = await result.completed
	return Protocol.ok({"node": str(node.get_path()), "method": method, "returned": Codec.encode(result)})


## Checks a method exists and converts JSON arguments to its declared
## parameter types (shared by game_call and method conditions).
func _prepare_call(node: Node, method: String, raw_args: Variant) -> Dictionary:
	if typeof(raw_args) != TYPE_ARRAY:
		return Protocol.err(Protocol.INVALID_PARAMS, "'args' must be an array.")
	var info := {}
	for m in node.get_method_list():
		if m.name == method:
			info = m
			break
	if info.is_empty():
		var own: Array = []
		var script: Script = node.get_script()
		if script != null:
			for m in script.get_script_method_list():
				if not String(m.name).begins_with("_") and not own.has(m.name):
					own.append(m.name)
		return Protocol.err(Protocol.INVALID_PARAMS, "%s has no method '%s'. Script methods: %s" % [node.get_class(), method, ", ".join(own.slice(0, 30))])
	var params: Array = info.get("args", [])
	var defaults: Array = info.get("default_args", [])
	var required: int = params.size() - defaults.size()
	var vararg: bool = info.get("flags", 0) & METHOD_FLAG_VARARG
	if raw_args.size() < required or (raw_args.size() > params.size() and not vararg):
		return Protocol.err(Protocol.INVALID_PARAMS, "%s() takes %s argument(s), got %d." % [method,
			str(params.size()) if required == params.size() else "%d-%d" % [required, params.size()], raw_args.size()])
	var args: Array = []
	for i in raw_args.size():
		var t: int = params[i].type if i < params.size() else TYPE_NIL
		var d := Codec.decode(raw_args[i], t) if t != TYPE_NIL else {"ok": true, "value": raw_args[i]}
		if not d.ok:
			return Protocol.err(Protocol.INVALID_PARAMS, "Argument %d (%s): %s" % [i + 1, params[i].name if i < params.size() else "?", d.error])
		args.append(d.value)
	return Protocol.ok(args)


# ------------------------------------------------------------------ wait_for

const RELATIVE_OPS := ["changed", "increased", "decreased"]


## Wraps the check so an optional 'message' explains a failure in the test's words.
func _wait_for(p: Dictionary) -> Dictionary:
	var r: Dictionary = await _wait_for_condition(p)
	var note := str(p.get("message", "")).strip_edges()
	if not r.ok and note != "":
		r.error.message = "%s: %s" % [note, r.error.message]
	return r


func _wait_for_condition(p: Dictionary) -> Dictionary:
	var path := String(p.get("node", ""))
	var prop := String(p.get("property", ""))
	var op := String(p.get("op", "=="))
	var expected: Variant = p.get("value")
	var timeout_ms := clampi(int(p.get("timeout_ms", 5000)), 0, MAX_WAIT_MS)
	var relative := RELATIVE_OPS.has(op)
	var tolerance := Compare.EPSILON
	if p.has("tolerance"):
		if typeof(p.tolerance) not in [TYPE_INT, TYPE_FLOAT] or float(p.tolerance) < 0:
			return Protocol.err(Protocol.INVALID_PARAMS, "'tolerance' must be a number >= 0.")
		tolerance = float(p.tolerance)
	if relative and timeout_ms == 0:
		return Protocol.err(Protocol.INVALID_PARAMS,
			"'%s' compares with the value when waiting starts, so it needs timeout_ms > 0." % op)
	var frame_ms := movie_frame_ms(_movie, _tree.root.get_process_delta_time(), Engine.time_scale)
	var start := _clock_ms(frame_ms)
	var last: Variant = null
	var baseline: Variant = null
	var has_baseline := false
	var read_error := ""
	var method := String(p.get("method", ""))
	var call_args: Array = []
	var prepared_for := 0
	var subject := prop
	if method != "":
		subject = "%s()%s" % [method, (":" + prop) if prop != "" else ""]
	elif prop == "":
		return Protocol.err(Protocol.INVALID_PARAMS, "Give 'property' (or 'method' to check a method's return value).")
	var condition := "%s %s" % [subject, op] if relative else "%s %s %s" % [subject, op, JSON.stringify(expected)]
	while true:
		var node := _resolve(path)
		if node != null:
			var got: Dictionary
			if method != "":
				# Called on every check, so it should only read state.
				if prepared_for != node.get_instance_id():
					var prepared := _prepare_call(node, method, p.get("args", []))
					if not prepared.ok:
						return prepared
					call_args = prepared.result
					prepared_for = node.get_instance_id()
				var returned: Variant = node.callv(method, call_args)
				if returned is Object and is_instance_valid(returned) and returned.has_signal("completed"):
					return Protocol.err(Protocol.INVALID_PARAMS, "%s() is a coroutine; a condition needs a method that returns right away." % method)
				got = PropertyPath.read_value(returned, prop, method + "()")
			else:
				if not _has_property(node, prop):
					return Protocol.err(Protocol.INVALID_PARAMS, "%s has no property '%s'." % [node.get_class(), prop.split(":")[0]])
				# An element may not exist yet (e.g. an array that grows), so keep waiting.
				got = PropertyPath.read(node, prop)
			read_error = "" if got.ok else got.error
			if got.ok:
				last = Codec.encode(got.value)
				if relative:
					if not has_baseline:
						baseline = last
						has_baseline = true
					else:
						var met := false
						if op == "changed":
							var same := Compare.evaluate(last, "==", baseline, tolerance)
							met = (not same.ok) or (not same.result)
						else:
							var c := Compare.evaluate(last, ">" if op == "increased" else "<", baseline, tolerance)
							if not c.ok:
								return Protocol.err(Protocol.INVALID_PARAMS, c.error)
							met = c.result
						if met:
							return Protocol.ok({"met": true, "value": last, "baseline": baseline, "elapsed_ms": _clock_ms(frame_ms) - start})
				else:
					var r := Compare.evaluate(last, op, expected, tolerance)
					if not r.ok:
						return Protocol.err(Protocol.INVALID_PARAMS, r.error)
					if r.result:
						return Protocol.ok({"met": true, "value": last, "elapsed_ms": _clock_ms(frame_ms) - start})
		var elapsed := _clock_ms(frame_ms) - start
		if elapsed >= timeout_ms:
			var code := Protocol.ASSERTION_FAILED if timeout_ms == 0 else Protocol.TIMEOUT
			if node == null:
				var where := "(node '%s' not found)" % path
				return Protocol.err(code, "Condition %s could not be checked: %s" % [condition, where],
					"Check the node path with game_query; paths are relative to the running scene.")
			if read_error != "":
				return Protocol.err(code, "Condition %s could not be checked: %s" % [condition, read_error],
					"Check the property path: arrays take numeric indexes (items:0), dictionaries take keys (stats:hp).")
			if timeout_ms == 0:
				return Protocol.err(code,
					"Condition %s is false. Actual value: %s" % [condition, JSON.stringify(last)],
					"The condition was checked once. If it becomes true later, wait for it with a timeout.")
			var base_note := " (baseline %s)" % JSON.stringify(baseline) if relative else ""
			return Protocol.err(code,
				"Condition %s not met within %d ms%s. Last value: %s" % [condition, timeout_ms, base_note, JSON.stringify(last)],
				"Inspect the state with game_query or screenshot, or raise timeout_ms.")
		await _tree.process_frame
	return Protocol.err(Protocol.INTERNAL, "unreachable")


# ------------------------------------------------------------------ pause / step

## Pausing freezes game nodes (process_mode Pausable, the default) while the
## runtime keeps answering: query/set/call/wait_for still work.
func _pause(p: Dictionary) -> Dictionary:
	if typeof(p.get("paused")) != TYPE_BOOL:
		return Protocol.err(Protocol.INVALID_PARAMS, "'paused' must be true or false.")
	_tree.paused = p.paused
	return Protocol.ok({"paused": _tree.paused, "physics_frame": Engine.get_physics_frames()})


## Runs exactly N physics frames, then leaves the game paused.
func _step(p: Dictionary) -> Dictionary:
	var raw: Variant = p.get("frames", 1)
	if typeof(raw) not in [TYPE_INT, TYPE_FLOAT] or int(raw) < 1 or int(raw) > MAX_STEP_FRAMES:
		return Protocol.err(Protocol.INVALID_PARAMS, "'frames' must be between 1 and %d." % MAX_STEP_FRAMES)
	var frames := int(raw)
	var input := {}
	for key in ["press", "release", "tap"]:
		var list: Variant = p.get(key, [])
		if typeof(list) != TYPE_ARRAY or list.size() > 16:
			return Protocol.err(Protocol.INVALID_PARAMS, "'%s' must be a list of up to 16 input action names." % key)
		for a in list:
			if typeof(a) != TYPE_STRING or not InputMap.has_action(StringName(a)):
				return Protocol.err(Protocol.INVALID_PARAMS, "%s: unknown input action '%s'. Use project_info to list actions." % [key, str(a)])
		input[key] = list
	for a in input.press + input.tap:
		if input.release.has(a):
			return Protocol.err(Protocol.INVALID_PARAMS, "'%s' is both pressed and released in one step." % a)
	var has_input: bool = not (input.press.is_empty() and input.release.is_empty() and input.tap.is_empty())
	if has_input and Engine.is_in_physics_frame():
		# Input must arrive between frames to count as pressed in the next one.
		await _tree.process_frame
	var stepper: Node = Stepper.new(frames, input.tap)
	_tree.root.add_child(stepper)
	_tree.paused = false
	if has_input:
		Stepper.apply_input(input.press, input.release, input.tap)
	await stepper.finished
	stepper.queue_free()
	return Protocol.ok({"paused": true, "frames": frames, "stepped_frames": frames, "physics_frame": Engine.get_physics_frames()})


# ------------------------------------------------------------------ input

const MAX_STEP_FRAMES := 3600
const INLINE_KINDS := ["set", "call", "assert", "wait_for"]


const TIME_FREE_KINDS := ["call", "set", "assert"]


## Steps that only read or write live state run fine while the game is paused; everything
## else (actions, waits, wait_for) needs physics frames, which a paused tree never ticks.
func _steps_need_frames(steps: Array) -> bool:
	for s in steps:
		if typeof(s) != TYPE_DICTIONARY:
			continue
		var time_free := false
		for k in TIME_FREE_KINDS:
			if s.has(k):
				time_free = true
				break
		if not time_free:
			return true
	return false


func _validate_steps(steps: Array) -> String:
	if steps.size() > MAX_STEPS:
		return "At most %d steps per call (got %d)." % [MAX_STEPS, steps.size()]
	for i in steps.size():
		var s: Variant = steps[i]
		var n := i + 1
		if typeof(s) != TYPE_DICTIONARY:
			return "Step %d must be an object." % n
		for k in ["hold_ms", "wait_ms"]:
			if s.has(k) and (int(s[k]) < 0 or int(s[k]) > MAX_STEP_MS):
				return "Step %d: %s must be between 0 and %d." % [n, k, MAX_STEP_MS]
		for k in ["hold_frames", "wait_frames"]:
			if s.has(k) and (typeof(s[k]) not in [TYPE_INT, TYPE_FLOAT] or int(s[k]) < 0 or int(s[k]) > MAX_STEP_FRAMES):
				return "Step %d: %s must be between 0 and %d." % [n, k, MAX_STEP_FRAMES]
		if s.has("hold_ms") and s.has("hold_frames"):
			return "Step %d: give hold_ms or hold_frames, not both." % n
		if s.has("wait_ms") and s.has("wait_frames"):
			return "Step %d: give wait_ms or wait_frames, not both." % n
		var inline: Array = INLINE_KINDS.filter(func(k: String) -> bool: return s.has(k))
		if not inline.is_empty():
			var kind: String = inline[0]
			var body: Variant = s[kind]
			if inline.size() > 1 or typeof(body) != TYPE_DICTIONARY:
				return "Step %d: '%s' must be an object, alone in its step." % [n, kind]
			if kind == "set" and typeof(body.get("properties")) != TYPE_DICTIONARY:
				return "Step %d: set needs {node, properties: {path: value}}." % n
			if kind == "call" and typeof(body.get("method")) != TYPE_STRING:
				return "Step %d: call needs {node, method, args?}." % n
			if (kind == "assert" or kind == "wait_for") and (typeof(body.get("op")) != TYPE_STRING or
					(typeof(body.get("property")) != TYPE_STRING and typeof(body.get("method")) != TYPE_STRING)):
				return "Step %d: %s needs {node, property (or method), op, value}." % [n, kind]
		elif s.has("action"):
			if not InputMap.has_action(StringName(s.action)):
				return "Step %d: unknown input action '%s'. Use project_info to list actions." % [n, s.action]
		elif s.has("key"):
			if OS.find_keycode_from_string(String(s.key)) == KEY_NONE:
				return "Step %d: unknown key '%s' (examples: 'Space', 'A', 'Escape', 'Left')." % [n, s.key]
		elif s.has("mouse_click") or s.has("mouse_move"):
			var pos: Variant = s.get("mouse_click", s.get("mouse_move"))
			if typeof(pos) != TYPE_ARRAY or pos.size() != 2:
				return "Step %d: mouse position must be [x, y]." % n
		elif not s.has("wait_ms") and not s.has("wait_frames"):
			return "Step %d: expected one of action, key, mouse_click, mouse_move, wait_ms, wait_frames, set, call, assert, wait_for." % n
	return ""


func _input(p: Dictionary) -> Dictionary:
	var steps: Variant = p.get("steps", [])
	if typeof(steps) != TYPE_ARRAY or steps.is_empty():
		return Protocol.err(Protocol.INVALID_PARAMS, "'steps' must be a non-empty array.")
	if p.has("pause_at_end") and typeof(p.pause_at_end) != TYPE_BOOL:
		return Protocol.err(Protocol.INVALID_PARAMS, "'pause_at_end' must be true or false.")
	var problem := _validate_steps(steps)
	if problem != "":
		return Protocol.err(Protocol.INVALID_PARAMS, problem)
	if _tree.paused and _steps_need_frames(steps):
		return Protocol.err(Protocol.INVALID_PARAMS,
			"The game is paused, so these steps would wait without advancing a single physics frame.",
			"Resume with game_pause {paused: false}, or advance frame by frame with game_step {frames: n} (scenarios: the 'step' step).")
	var recorder: Dictionary = {}
	if p.get("record") != null:
		var made := await _make_recorder(p.record)
		if not made.ok:
			return made
		recorder = made.result
	var start := Time.get_ticks_msec()
	# Keep the per-frame callback out of the recorder dictionary: a callable
	# stored inside the data it captures is a reference cycle and leaks.
	var tick := _record_sample.bind(recorder)
	if not recorder.is_empty():
		recorder.start = start
		recorder.start_frame = Engine.get_physics_frames()
		_record_sample(recorder)
		_record_signal(recorder).connect(tick)
	var run: Dictionary = await _run_steps(steps)
	if not recorder.is_empty():
		_record_signal(recorder).disconnect(tick)
	if not run.ok:
		return run
	var out := {"steps": steps.size(), "duration_ms": Time.get_ticks_msec() - start}
	if not run.results.is_empty():
		out["results"] = run.results
	if not recorder.is_empty():
		_record_sample(recorder, true)
		var rec := _record_result(recorder)
		out["record"] = rec
		var failed := _check_expectations(recorder.expect, rec.summary)
		if failed != "":
			return Protocol.err(Protocol.ASSERTION_FAILED, "Recording check failed: " + failed,
				"Summary: " + JSON.stringify(rec.summary).left(400))
	if p.get("pause_at_end", false):
		# Measurement after the call would otherwise include the seconds spent
		# between calls, which made "input 60 frames then read" read a later state.
		_tree.paused = true
		out["paused"] = true
	return Protocol.ok(out)


const EXPECT_STATS := ["min", "max", "first", "last", "min_at_ms", "max_at_ms"]


## per "physics": one sample per physics tick (the state left by the previous
## tick), independent of how often frames are rendered.
func _record_signal(rec: Dictionary) -> Signal:
	return _tree.physics_frame if rec.per == "physics" else _tree.process_frame


func _check_expectations(expect: Array, summary: Dictionary) -> String:
	var problems: Array = []
	for e in expect:
		var entry: Dictionary = summary.get(e.property, {})
		if not entry.has(e.stat):
			problems.append("%s of %s is not available (min/max need numeric values)" % [e.stat, e.property])
			continue
		var actual: Variant = entry[e.stat]
		var r := Compare.evaluate(actual, e.op, e.value)
		if not r.ok or not r.result:
			problems.append("%s of %s %s %s is false (actual %s)" % [e.stat, e.property, e.op, JSON.stringify(e.value), JSON.stringify(actual)])
	return "; ".join(problems)


# ------------------------------------------------------------------ record

const MAX_RECORD_SAMPLES := 3000
const MAX_RECORD_PROPERTIES := 8
const RETURNED_SAMPLES := 50


func _make_recorder(spec: Variant) -> Dictionary:
	if typeof(spec) != TYPE_DICTIONARY:
		return Protocol.err(Protocol.INVALID_PARAMS, "'record' must be an object {node, properties, interval_ms?}.")
	var props: Variant = spec.get("properties", [])
	if typeof(props) != TYPE_ARRAY or props.is_empty() or props.size() > MAX_RECORD_PROPERTIES:
		return Protocol.err(Protocol.INVALID_PARAMS, "record.properties must list 1 to %d properties." % MAX_RECORD_PROPERTIES)
	var path := String(spec.get("node", ""))
	var node := _resolve(path)
	if node == null:
		return _not_found(path)
	var method := String(spec.get("method", ""))
	var args: Variant = spec.get("args", [])
	if typeof(args) != TYPE_ARRAY or args.size() > 16:
		return Protocol.err(Protocol.INVALID_PARAMS, "record.args must be a list of up to 16 values.")
	if method != "":
		var prepared := _prepare_call(node, method, args)
		if not prepared.ok:
			return prepared
		args = prepared.result
		# Validate the paths against one real call (the method runs on every sample too).
		var returned: Variant = await node.callv(method, args)
		for prop in props:
			var got := PropertyPath.read_value(returned, String(prop), method + "()")
			if not got.ok:
				return Protocol.err(Protocol.INVALID_PARAMS, got.error)
	else:
		for prop in props:
			var got := PropertyPath.read(node, String(prop))
			if not got.ok:
				return Protocol.err(Protocol.INVALID_PARAMS, got.error)
	var mode := String(spec.get("mode", "all"))
	if mode != "all" and mode != "changes":
		return Protocol.err(Protocol.INVALID_PARAMS, "record.mode must be 'all' (every frame) or 'changes' (only when a value changes).")
	var per := String(spec.get("per", "process"))
	if per != "process" and per != "physics":
		return Protocol.err(Protocol.INVALID_PARAMS, "record.per must be 'process' (every rendered frame) or 'physics' (once per physics frame).")
	var expect: Variant = spec.get("expect", [])
	if typeof(expect) != TYPE_ARRAY:
		return Protocol.err(Protocol.INVALID_PARAMS, "record.expect must be a list of {property, stat, op, value}.")
	for e in expect:
		if typeof(e) != TYPE_DICTIONARY or not props.has(e.get("property")):
			return Protocol.err(Protocol.INVALID_PARAMS, "record.expect: 'property' must be one of the recorded properties %s." % str(props))
		if not EXPECT_STATS.has(e.get("stat")):
			return Protocol.err(Protocol.INVALID_PARAMS, "record.expect: 'stat' must be one of %s." % ", ".join(EXPECT_STATS))
		if not Compare.OPS.has(e.get("op")):
			return Protocol.err(Protocol.INVALID_PARAMS, "record.expect: 'op' must be one of %s." % ", ".join(Compare.OPS))
	var rec := {
		"node": node, "path": path, "properties": props.map(func(x: Variant) -> String: return String(x)),
		"interval": clampi(int(spec.get("interval_ms", 0)), 0, 1000), "changes_only": mode == "changes",
		"samples": [], "total": 0, "frames": 0, "last_t": -1000000, "start": 0, "expect": expect,
		"per": per, "start_frame": Engine.get_physics_frames(), "method": method, "args": args,
	}
	return Protocol.ok(rec)


func _record_sample(rec: Dictionary, force: bool = false) -> void:
	var t: int = Time.get_ticks_msec() - rec.start
	if not force and t - rec.last_t < rec.interval:
		return
	if not is_instance_valid(rec.node) or rec.samples.size() >= MAX_RECORD_SAMPLES:
		return
	var sample := {"t_ms": t}
	if rec.per == "physics":
		sample["frame"] = Engine.get_physics_frames() - rec.start_frame
	var returned: Variant = null
	if rec.method != "":
		returned = rec.node.callv(rec.method, rec.args)
	for prop in rec.properties:
		var got := PropertyPath.read_value(returned, prop, rec.method + "()") if rec.method != "" else PropertyPath.read(rec.node, prop)
		sample[prop] = Codec.encode(got.value) if got.ok else null
	rec.frames += 1
	rec.last_t = t
	if rec.changes_only and not rec.samples.is_empty():
		var prev: Dictionary = rec.samples[-1]
		var same := true
		for prop in rec.properties:
			if typeof(prev[prop]) != typeof(sample[prop]) or prev[prop] != sample[prop]:
				same = false
				break
		if same:
			return
	rec.samples.append(sample)
	rec.total += 1


func _record_result(rec: Dictionary) -> Dictionary:
	var samples: Array = rec.samples
	var summary := {}
	for prop in rec.properties:
		if samples.is_empty():
			break
		var first: Variant = samples[0][prop]
		var entry := {"first": first, "last": samples[-1][prop]}
		if typeof(first) == TYPE_INT or typeof(first) == TYPE_FLOAT:
			entry.min = first
			entry.max = first
			entry.min_at_ms = samples[0].t_ms
			entry.max_at_ms = samples[0].t_ms
			for s in samples:
				var v: Variant = s[prop]
				if typeof(v) != TYPE_INT and typeof(v) != TYPE_FLOAT:
					continue
				if v < entry.min:
					entry.min = v
					entry.min_at_ms = s.t_ms
				if v > entry.max:
					entry.max = v
					entry.max_at_ms = s.t_ms
		summary[prop] = entry
	# Return an evenly spaced subset; always keep the first and last sample.
	var shown: Array = samples
	if samples.size() > RETURNED_SAMPLES:
		shown = []
		for i in RETURNED_SAMPLES:
			shown.append(samples[roundi(float(i) * (samples.size() - 1) / (RETURNED_SAMPLES - 1))])
	return {"node": rec.path, "per": rec.per, "samples_total": rec.total, "frames_observed": rec.frames, "samples": shown, "summary": summary,
		"note": "" if is_instance_valid(rec.node) else "The node was freed during recording."}


## Runs input steps in order with real timing. Inline set/call/assert/wait_for
## steps run inside the game between inputs, so no time passes between them.
## On a failing step, held input is released and the rest is skipped.
func _run_steps(steps: Array) -> Dictionary:
	var results: Array = []
	var held := {}
	for i in steps.size():
		var s: Dictionary = steps[i]
		var kind := ""
		var r: Dictionary = {}
		if s.has("set"):
			kind = "set"
			r = _set_properties(s.set)
		elif s.has("call"):
			kind = "call"
			r = await _call_method(s.call)
		elif s.has("assert"):
			kind = "assert"
			var a: Dictionary = s.assert.duplicate()
			a["timeout_ms"] = 0
			r = await _wait_for(a)
		elif s.has("wait_for"):
			kind = "wait_for"
			r = await _wait_for(s.wait_for)
		elif s.has("action"):
			var action := StringName(s.action)
			var strength := float(s.get("strength", 1.0))
			if s.get("release", false):
				_send_action(action, false, 0.0)
				held.erase(action)
			elif s.get("press", false):
				_send_action(action, true, strength)
				held[action] = true
			else:
				_send_action(action, true, strength)
				await _hold(s, 100)
				_send_action(action, false, 0.0)
		elif s.has("key"):
			var code := OS.find_keycode_from_string(String(s.key))
			_send_key(code, true)
			await _hold(s, 50)
			_send_key(code, false)
		elif s.has("mouse_move"):
			_send_motion(Vector2(s.mouse_move[0], s.mouse_move[1]))
		elif s.has("mouse_click"):
			var pos := Vector2(s.mouse_click[0], s.mouse_click[1])
			var button := MOUSE_BUTTON_RIGHT if String(s.get("button", "left")) == "right" else MOUSE_BUTTON_LEFT
			_send_motion(pos)
			_send_click(pos, button, true)
			await _hold(s, 50)
			_send_click(pos, button, false)
		if kind != "":
			if not r.ok:
				for action in held:
					_send_action(action, false, 0.0)
				return Protocol.err(r.error.code, "step %d (%s): %s" % [i + 1, kind, r.error.message], r.error.get("hint", ""))
			results.append({"index": i + 1, "kind": kind, "result": r.result})
		if s.has("wait_frames"):
			await _physics_frames(int(s.wait_frames))
		elif s.has("wait_ms"):
			await _sleep(int(s.wait_ms))
	return {"ok": true, "results": results}


func _hold(s: Dictionary, default_ms: int) -> void:
	if s.has("hold_frames"):
		await _physics_frames(int(s.hold_frames))
	else:
		await _sleep(int(s.get("hold_ms", default_ms)))


## Physics ticks are what game logic in _physics_process counts, independent of
## rendering hitches or a throttled window.
func _physics_frames(n: int) -> void:
	for i in n:
		await _tree.physics_frame


func _sleep(ms: int) -> void:
	if ms <= 0:
		await _tree.process_frame
		return
	# process_always + ignore time_scale so paused games and slow-mo still advance.
	await _tree.create_timer(ms / 1000.0, true, false, true).timeout


func _send_action(action: StringName, pressed: bool, strength: float) -> void:
	var ev := InputEventAction.new()
	ev.action = action
	ev.pressed = pressed
	ev.strength = strength
	Input.parse_input_event(ev)


func _send_key(code: Key, pressed: bool) -> void:
	var ev := InputEventKey.new()
	ev.keycode = code
	ev.physical_keycode = code
	ev.pressed = pressed
	Input.parse_input_event(ev)


func _send_motion(pos: Vector2) -> void:
	var ev := InputEventMouseMotion.new()
	ev.position = pos
	ev.global_position = pos
	Input.parse_input_event(ev)


func _send_click(pos: Vector2, button: MouseButton, pressed: bool) -> void:
	var ev := InputEventMouseButton.new()
	ev.position = pos
	ev.global_position = pos
	ev.button_index = button
	ev.pressed = pressed
	Input.parse_input_event(ev)


# ------------------------------------------------------------------ screenshot

func _screenshot(p: Dictionary) -> Dictionary:
	if DisplayServer.get_name() == "headless":
		return _no_rendering()
	var normalize := String(p.get("normalize", "viewport"))
	if normalize != "viewport" and normalize != "none":
		return Protocol.err(Protocol.INVALID_PARAMS, "normalize must be 'viewport' or 'none'.")
	await RenderingServer.frame_post_draw
	var tex := _tree.root.get_texture()
	var img: Image = tex.get_image() if tex != null else null
	if img == null or img.is_empty():
		return _no_rendering()
	var source_width := img.get_width()
	var source_height := img.get_height()
	# The embedded game window can be smaller (or larger) than the project's viewport, which
	# made repeated captures of the same screen differ in size. Normalizing here lets baseline
	# comparisons line up; "source_width"/"source_height" still say what the window rendered.
	if normalize == "viewport":
		var vw := maxi(1, int(ProjectSettings.get_setting("display/window/size/viewport_width", 1152)))
		var vh := maxi(1, int(ProjectSettings.get_setting("display/window/size/viewport_height", 648)))
		if img.get_width() != vw or img.get_height() != vh:
			img.resize(vw, vh, Image.INTERPOLATE_NEAREST)
	var max_width := clampi(int(p.get("max_width", 1280)), 64, 2560)
	if img.get_width() > max_width:
		var h := int(round(img.get_height() * float(max_width) / img.get_width()))
		img.resize(max_width, max(1, h), Image.INTERPOLATE_BILINEAR)
	var out := {"png": img.save_png_to_buffer(), "width": img.get_width(), "height": img.get_height()}
	if source_width != img.get_width() or source_height != img.get_height():
		out["source_width"] = source_width
		out["source_height"] = source_height
	return Protocol.ok(out)


const MAX_UI_ENTRIES := 200
const MAX_UI_ISSUES := 50


## Walks the Control tree of the running game and reports layout problems that a screenshot alone hides.
func _ui_audit(p: Dictionary) -> Dictionary:
	var path := String(p.get("node", "."))
	var root := _resolve(path)
	if root == null:
		return _not_found(path)
	var include_hidden: bool = p.get("include_hidden", false) == true
	var viewport := _tree.root.get_visible_rect()
	if DisplayServer.get_name() == "headless" or viewport.size.x < 1.0 or viewport.size.y < 1.0:
		# Headless has no real window (a 64x64 stub); the project's viewport is what a window would show.
		viewport = Rect2(Vector2.ZERO, Vector2(
			int(ProjectSettings.get_setting("display/window/size/viewport_width", 1152)),
			int(ProjectSettings.get_setting("display/window/size/viewport_height", 648))
		))
	var entries: Array = []
	var issues: Array = []
	var parent_rect: Variant = null
	if root is Control:
		_audit_control(root as Control, ".", entries, issues, viewport, include_hidden)
		# A full-rect scene root fills the window; in headless the stub window is 64x64 while the
		# project viewport is the size a player sees, so use that for the containment check.
		var root_rect := (root as Control).get_global_rect()
		parent_rect = viewport if root_rect.size.x < viewport.size.x or root_rect.size.y < viewport.size.y else root_rect
	_walk_controls(root, ".", entries, issues, viewport, include_hidden, parent_rect)
	var out := {
		"viewport": [int(viewport.size.x), int(viewport.size.y)],
		"controls": entries.size(),
		"issues": issues.slice(0, MAX_UI_ISSUES),
	}
	if entries.size() > MAX_UI_ENTRIES:
		out["truncated"] = true
	out["tree"] = entries.slice(0, MAX_UI_ENTRIES)
	var texts: Array = entries.filter(func(e: Dictionary) -> bool: return e.has("text") and e.visible)
	out["overlaps"] = _label_overlaps(texts).slice(0, 20)
	return Protocol.ok(out)


func _walk_controls(node: Node, path: String, entries: Array, issues: Array, viewport: Rect2, include_hidden: bool, parent_rect: Variant = null) -> void:
	for child in node.get_children():
		var child_path := str(child.name) if path == "" or path == "." else path.path_join(str(child.name))
		if child is Control:
			var c := child as Control
			_audit_control(c, child_path, entries, issues, viewport, include_hidden, parent_rect)
			_walk_controls(c, child_path, entries, issues, viewport, include_hidden, c.get_global_rect())
		elif child.get_child_count() > 0:
			_walk_controls(child, child_path, entries, issues, viewport, include_hidden, parent_rect)


func _audit_control(c: Control, path: String, entries: Array, issues: Array, viewport: Rect2, include_hidden: bool, parent_rect: Variant = null) -> void:
	var visible := c.is_visible_in_tree()
	if not visible and not include_hidden:
		return
	var rect := c.get_global_rect()
	var entry := {
		"path": path, "type": c.get_class(), "visible": visible,
		"rect": [rect.position.x, rect.position.y, rect.size.x, rect.size.y],
		"size": [c.size.x, c.size.y],
		"anchors": [c.anchor_left, c.anchor_top, c.anchor_right, c.anchor_bottom],
	}
	var text := _control_text(c)
	if text != "":
		entry["text"] = text
		var minimum := c.get_combined_minimum_size()
		entry["min_size"] = [minimum.x, minimum.y]
		if minimum.x > c.size.x + 1.0 or minimum.y > c.size.y + 1.0:
			issues.append({
				"path": path, "issue": "text_overflow",
				"min_size": [minimum.x, minimum.y], "size": [c.size.x, c.size.y],
				"message": "The text needs more room than the rect, so it is clipped.",
			})
	if c.size.x < 1.0 or c.size.y < 1.0:
		issues.append({"path": path, "issue": "zero_size", "size": [c.size.x, c.size.y],
			"message": "The Control has no size, so nothing of it is visible."})
	elif visible and not viewport.intersects(rect):
		issues.append({"path": path, "issue": "outside",
			"rect": [rect.position.x, rect.position.y, rect.size.x, rect.size.y],
			"message": "The rect does not overlap the viewport."})
	if parent_rect != null and visible and c.size.x >= 1.0 and c.size.y >= 1.0 and viewport.intersects(rect):
		var p: Rect2 = parent_rect
		if p.size.x >= 1.0 and (rect.position.x < p.position.x - 1.0 or rect.position.y < p.position.y - 1.0
				or rect.end.x > p.end.x + 1.0 or rect.end.y > p.end.y + 1.0):
			issues.append({"path": path, "issue": "escapes_parent",
				"rect": [rect.position.x, rect.position.y, rect.size.x, rect.size.y],
				"parent_rect": [p.position.x, p.position.y, p.size.x, p.size.y],
				"message": "The rect extends beyond its parent Control, so text can cross a panel border."})
	entries.append(entry)


func _control_text(c: Control) -> String:
	if c is Label:
		return (c as Label).text
	if c is Button:
		return (c as Button).text
	if c is RichTextLabel:
		return (c as RichTextLabel).get_parsed_text()
	if c is LineEdit:
		return (c as LineEdit).text
	return ""


func _label_overlaps(texts: Array) -> Array:
	var out: Array = []
	for i in texts.size():
		for j in range(i + 1, texts.size()):
			var ra: Array = texts[i].rect
			var rb: Array = texts[j].rect
			var a := Rect2(ra[0], ra[1], ra[2], ra[3])
			var b := Rect2(rb[0], rb[1], rb[2], rb[3])
			var inter := a.intersection(b)
			if inter.size.x > 1.0 and inter.size.y > 1.0:
				out.append({"a": texts[i].path, "b": texts[j].path, "area": int(inter.size.x * inter.size.y)})
	return out


## Is a node on screen for a camera? (The 3D trial had to write ball_on_screen() by hand.)
func _in_view(p: Dictionary) -> Dictionary:
	var target_path := String(p.get("node", "."))
	var target := _resolve(target_path)
	if target == null:
		return _not_found(target_path)
	if not (target is Node3D):
		return Protocol.err(Protocol.INVALID_PARAMS, "%s is not a Node3D, so it has no position in 3D." % target_path)
	var camera: Camera3D = null
	var camera_path := String(p.get("camera", ""))
	if camera_path != "":
		var found := _resolve(camera_path)
		if found == null:
			return _not_found(camera_path)
		if not (found is Camera3D):
			return Protocol.err(Protocol.INVALID_PARAMS, "%s is not a Camera3D." % camera_path)
		camera = found as Camera3D
	else:
		camera = _tree.root.get_camera_3d()
	if camera == null:
		return Protocol.err(Protocol.INVALID_PARAMS, "No Camera3D is active; pass 'camera'.", "For 2D games query position and the viewport size instead.")
	var point: Vector3 = (target as Node3D).global_position
	var behind := camera.is_position_behind(point)
	var size := _viewport_size()
	var screen := camera.unproject_position(point)
	# A headless game renders into a 64x64 stub; report the position in the project
	# viewport's pixels instead, which is what a player would see.
	var actual := camera.get_viewport().get_visible_rect().size
	if actual.x > 0.5 and actual.y > 0.5 and (absf(actual.x - size.x) > 0.5 or absf(actual.y - size.y) > 0.5):
		screen = Vector2(screen.x * size.x / actual.x, screen.y * size.y / actual.y)
	var on_screen := not behind and screen.x >= 0.0 and screen.y >= 0.0 and screen.x <= size.x and screen.y <= size.y
	return Protocol.ok({
		"node": target_path, "camera": str(camera.get_path()), "in_view": on_screen, "behind": behind,
		"screen": [screen.x, screen.y], "viewport": [size.x, size.y],
	})


## Casts a ray between two world-space points. A child RayCast3D rotates with its
## body (the 3D trial's jump bug); this one is always in world axes.
func _ray(p: Dictionary) -> Dictionary:
	var from := Codec.decode(p.get("from"), TYPE_VECTOR3)
	if not from.ok:
		return Protocol.err(Protocol.INVALID_PARAMS, "from: " + from.error)
	var to := Codec.decode(p.get("to"), TYPE_VECTOR3)
	if not to.ok:
		return Protocol.err(Protocol.INVALID_PARAMS, "to: " + to.error)
	var mask := int(p.get("collision_mask", 0xFFFFFFFF))
	var exclude: Array[RID] = []
	if p.get("exclude") != null:
		var ex := _resolve(String(p.get("exclude")))
		if ex == null:
			return _not_found(String(p.get("exclude")))
		if not (ex is CollisionObject3D):
			return Protocol.err(Protocol.INVALID_PARAMS, "%s is not a CollisionObject3D, so it cannot be excluded." % p.get("exclude"))
		exclude.append((ex as CollisionObject3D).get_rid())
	var query := PhysicsRayQueryParameters3D.create(from.value, to.value, mask, exclude)
	query.collide_with_areas = p.get("collide_with_areas", false) == true
	query.collide_with_bodies = p.get("collide_with_bodies", true) == true
	var hit := _tree.root.world_3d.direct_space_state.intersect_ray(query)
	if hit.is_empty():
		return Protocol.ok({"hit": false, "from": [from.value.x, from.value.y, from.value.z],
			"to": [to.value.x, to.value.y, to.value.z]})
	var collider: Variant = hit.get("collider")
	var at: Vector3 = hit.position
	var normal: Vector3 = hit.normal
	var out := {
		"hit": true, "position": [at.x, at.y, at.z], "normal": [normal.x, normal.y, normal.z],
		"distance": from.value.distance_to(at),
	}
	if collider is Node:
		out["collider"] = str(collider.get_path())
		out["collider_type"] = collider.get_class()
	return Protocol.ok(out)


## Contact points of a RigidBody3D with contact_monitor on, so grounding can be
## read instead of guessed from a screenshot.
func _contacts(p: Dictionary) -> Dictionary:
	var path := String(p.get("node", ""))
	var node := _resolve(path)
	if node == null:
		return _not_found(path)
	if not (node is RigidBody3D):
		return Protocol.err(Protocol.INVALID_PARAMS, "%s is not a RigidBody3D." % path)
	var body := node as RigidBody3D
	if not body.contact_monitor:
		return Protocol.err(Protocol.INVALID_PARAMS, "%s has contact_monitor off, so it records no contacts." % path,
			"Set contact_monitor = true and max_contacts_reported > 0 on the body.")
	# Godot 4.7 keeps the contact details on the body's direct physics state; RigidBody3D
	# itself only reports the count.
	var state := PhysicsServer3D.body_get_direct_state(body.get_rid())
	if state == null:
		return Protocol.err(Protocol.INTERNAL, "The physics state of %s is not available right now." % path,
			"Call again while the game is running.")
	var list: Array = []
	for i in state.get_contact_count():
		var point: Vector3 = state.get_contact_local_position(i)
		var normal: Vector3 = state.get_contact_local_normal(i)
		var other: Variant = state.get_contact_collider_object(i)
		var entry := {"position": [point.x, point.y, point.z], "normal": [normal.x, normal.y, normal.z]}
		if other is Node:
			entry["collider"] = str(other.get_path())
		list.append(entry)
	return Protocol.ok({"node": path, "contacts": list, "max_contacts_reported": body.max_contacts_reported})


func _viewport_size() -> Vector2:
	var size := _tree.root.get_visible_rect().size
	if DisplayServer.get_name() == "headless" or size.x < 1.0 or size.y < 1.0:
		return Vector2(
			int(ProjectSettings.get_setting("display/window/size/viewport_width", 1152)),
			int(ProjectSettings.get_setting("display/window/size/viewport_height", 648))
		)
	return size


func _no_rendering() -> Dictionary:
	return Protocol.err(Protocol.RENDERING_UNAVAILABLE, "The game is running without a renderer (headless), so no screenshot can be taken.",
		"Run the game with a window (remove --headless from Project Settings > Editor > Run > Main Run Args).")

@tool
extends RefCounted
## In-game commands executed by the runtime agent: query, input, wait_for, screenshot.
## Independent of the debugger channel so it can be unit-tested in a plain SceneTree.

const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")
const Codec = preload("res://addons/mcp_loop/util/value_codec.gd")
const PropertyPath = preload("res://addons/mcp_loop/util/property_path.gd")
const Compare = preload("res://addons/mcp_loop/util/compare.gd")

const MAX_WAIT_MS := 120_000
## Input sequences: per-step hold/wait limit and maximum number of steps.
const MAX_STEP_MS := 60_000
const MAX_STEPS := 200
const OVERVIEW_PROPS := ["position", "global_position", "rotation", "scale", "visible", "velocity", "text", "size"]

var _tree: SceneTree


func _init(tree: SceneTree) -> void:
	_tree = tree


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
	return Protocol.err(Protocol.UNKNOWN_METHOD, "Unknown runtime method '%s'." % method)


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
	var raw_args: Variant = p.get("args", [])
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
	var result: Variant = node.callv(method, args)
	# A coroutine returns a function state; wait for its real result.
	if result is Object and is_instance_valid(result) and result.has_signal("completed"):
		result = await result.completed
	return Protocol.ok({"node": str(node.get_path()), "method": method, "returned": Codec.encode(result)})


# ------------------------------------------------------------------ wait_for

const RELATIVE_OPS := ["changed", "increased", "decreased"]


func _wait_for(p: Dictionary) -> Dictionary:
	var path := String(p.get("node", ""))
	var prop := String(p.get("property", ""))
	var op := String(p.get("op", "=="))
	var expected: Variant = p.get("value")
	var timeout_ms := clampi(int(p.get("timeout_ms", 5000)), 0, MAX_WAIT_MS)
	var relative := RELATIVE_OPS.has(op)
	if relative and timeout_ms == 0:
		return Protocol.err(Protocol.INVALID_PARAMS,
			"'%s' compares with the value when waiting starts, so it needs timeout_ms > 0." % op)
	var start := Time.get_ticks_msec()
	var last: Variant = null
	var baseline: Variant = null
	var has_baseline := false
	var read_error := ""
	var condition := "%s %s" % [prop, op] if relative else "%s %s %s" % [prop, op, JSON.stringify(expected)]
	while true:
		var node := _resolve(path)
		if node != null:
			if not _has_property(node, prop):
				return Protocol.err(Protocol.INVALID_PARAMS, "%s has no property '%s'." % [node.get_class(), prop.split(":")[0]])
			# An element may not exist yet (e.g. an array that grows), so keep waiting.
			var got := PropertyPath.read(node, prop)
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
							var same := Compare.evaluate(last, "==", baseline)
							met = (not same.ok) or (not same.result)
						else:
							var c := Compare.evaluate(last, ">" if op == "increased" else "<", baseline)
							if not c.ok:
								return Protocol.err(Protocol.INVALID_PARAMS, c.error)
							met = c.result
						if met:
							return Protocol.ok({"met": true, "value": last, "baseline": baseline, "elapsed_ms": Time.get_ticks_msec() - start})
				else:
					var r := Compare.evaluate(last, op, expected)
					if not r.ok:
						return Protocol.err(Protocol.INVALID_PARAMS, r.error)
					if r.result:
						return Protocol.ok({"met": true, "value": last, "elapsed_ms": Time.get_ticks_msec() - start})
		var elapsed := Time.get_ticks_msec() - start
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


# ------------------------------------------------------------------ input

const MAX_STEP_FRAMES := 3600
const INLINE_KINDS := ["set", "call", "assert", "wait_for"]


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
			if (kind == "assert" or kind == "wait_for") and (typeof(body.get("property")) != TYPE_STRING or typeof(body.get("op")) != TYPE_STRING):
				return "Step %d: %s needs {node, property, op, value}." % [n, kind]
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
	var problem := _validate_steps(steps)
	if problem != "":
		return Protocol.err(Protocol.INVALID_PARAMS, problem)
	var recorder: Dictionary = {}
	if p.get("record") != null:
		var made := _make_recorder(p.record)
		if not made.ok:
			return made
		recorder = made.result
	var start := Time.get_ticks_msec()
	# Keep the per-frame callback out of the recorder dictionary: a callable
	# stored inside the data it captures is a reference cycle and leaks.
	var tick := _record_sample.bind(recorder)
	if not recorder.is_empty():
		recorder.start = start
		_record_sample(recorder)
		_tree.process_frame.connect(tick)
	var run: Dictionary = await _run_steps(steps)
	if not recorder.is_empty():
		_tree.process_frame.disconnect(tick)
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
	return Protocol.ok(out)


const EXPECT_STATS := ["min", "max", "first", "last", "min_at_ms", "max_at_ms"]


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
	for prop in props:
		var got := PropertyPath.read(node, String(prop))
		if not got.ok:
			return Protocol.err(Protocol.INVALID_PARAMS, got.error)
	var mode := String(spec.get("mode", "all"))
	if mode != "all" and mode != "changes":
		return Protocol.err(Protocol.INVALID_PARAMS, "record.mode must be 'all' (every frame) or 'changes' (only when a value changes).")
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
	}
	return Protocol.ok(rec)


func _record_sample(rec: Dictionary, force: bool = false) -> void:
	var t: int = Time.get_ticks_msec() - rec.start
	if not force and t - rec.last_t < rec.interval:
		return
	if not is_instance_valid(rec.node) or rec.samples.size() >= MAX_RECORD_SAMPLES:
		return
	var sample := {"t_ms": t}
	for prop in rec.properties:
		var got := PropertyPath.read(rec.node, prop)
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
	return {"node": rec.path, "samples_total": rec.total, "frames_observed": rec.frames, "samples": shown, "summary": summary,
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
	await RenderingServer.frame_post_draw
	var tex := _tree.root.get_texture()
	var img: Image = tex.get_image() if tex != null else null
	if img == null or img.is_empty():
		return _no_rendering()
	var max_width := clampi(int(p.get("max_width", 1280)), 64, 2560)
	if img.get_width() > max_width:
		var h := int(round(img.get_height() * float(max_width) / img.get_width()))
		img.resize(max_width, max(1, h), Image.INTERPOLATE_BILINEAR)
	return Protocol.ok({"png": img.save_png_to_buffer(), "width": img.get_width(), "height": img.get_height()})


func _no_rendering() -> Dictionary:
	return Protocol.err(Protocol.RENDERING_UNAVAILABLE, "The game is running without a renderer (headless), so no screenshot can be taken.",
		"Run the game with a window (remove --headless from Project Settings > Editor > Run > Main Run Args).")

@tool
extends RefCounted
## In-game commands executed by the runtime agent: query, input, wait_for, screenshot.
## Independent of the debugger channel so it can be unit-tested in a plain SceneTree.

const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")
const Codec = preload("res://addons/mcp_loop/util/value_codec.gd")
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
	var base := key.split(":")[0]
	for info in obj.get_property_list():
		if info.name == base:
			return true
	return false


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
			if not _has_property(node, key):
				return Protocol.err(Protocol.INVALID_PARAMS, "%s has no property '%s'." % [node.get_class(), key])
			out[key] = Codec.encode(node.get_indexed(NodePath(key)))
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


# ------------------------------------------------------------------ wait_for

func _wait_for(p: Dictionary) -> Dictionary:
	var path := String(p.get("node", ""))
	var prop := String(p.get("property", ""))
	var op := String(p.get("op", "=="))
	var expected: Variant = p.get("value")
	var timeout_ms := clampi(int(p.get("timeout_ms", 5000)), 0, MAX_WAIT_MS)
	var start := Time.get_ticks_msec()
	var last: Variant = null
	while true:
		var node := _resolve(path)
		if node != null:
			if not _has_property(node, prop):
				return Protocol.err(Protocol.INVALID_PARAMS, "%s has no property '%s'." % [node.get_class(), prop])
			last = Codec.encode(node.get_indexed(NodePath(prop)))
			var r := Compare.evaluate(last, op, expected)
			if not r.ok:
				return Protocol.err(Protocol.INVALID_PARAMS, r.error)
			if r.result:
				return Protocol.ok({"met": true, "value": last, "elapsed_ms": Time.get_ticks_msec() - start})
		var elapsed := Time.get_ticks_msec() - start
		if elapsed >= timeout_ms:
			var shown: String = JSON.stringify(last) if node != null else "(node '%s' not found)" % path
			if timeout_ms == 0:
				return Protocol.err(Protocol.ASSERTION_FAILED,
					"Condition %s %s %s is false. Actual value: %s" % [prop, op, JSON.stringify(expected), shown],
					"Use a timeout to wait for the condition instead of checking it once.")
			return Protocol.err(Protocol.TIMEOUT,
				"Condition %s %s %s not met within %d ms. Last value: %s" % [prop, op, JSON.stringify(expected), timeout_ms, shown],
				"Inspect the state with game_query or screenshot, or raise timeout_ms.")
		await _tree.process_frame
	return Protocol.err(Protocol.INTERNAL, "unreachable")


# ------------------------------------------------------------------ input

func _validate_steps(steps: Array) -> String:
	if steps.size() > MAX_STEPS:
		return "At most %d steps per call (got %d)." % [MAX_STEPS, steps.size()]
	for i in steps.size():
		var s: Variant = steps[i]
		if typeof(s) != TYPE_DICTIONARY:
			return "Step %d must be an object." % i
		for k in ["hold_ms", "wait_ms"]:
			if s.has(k) and (int(s[k]) < 0 or int(s[k]) > MAX_STEP_MS):
				return "Step %d: %s must be between 0 and %d." % [i, k, MAX_STEP_MS]
		if s.has("action"):
			if not InputMap.has_action(StringName(s.action)):
				return "Step %d: unknown input action '%s'. Use project_info to list actions." % [i, s.action]
		elif s.has("key"):
			if OS.find_keycode_from_string(String(s.key)) == KEY_NONE:
				return "Step %d: unknown key '%s' (examples: 'Space', 'A', 'Escape', 'Left')." % [i, s.key]
		elif s.has("mouse_click") or s.has("mouse_move"):
			var pos: Variant = s.get("mouse_click", s.get("mouse_move"))
			if typeof(pos) != TYPE_ARRAY or pos.size() != 2:
				return "Step %d: mouse position must be [x, y]." % i
		elif not s.has("wait_ms"):
			return "Step %d: expected one of action, key, mouse_click, mouse_move, wait_ms." % i
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
	await _run_steps(steps)
	var out := {"steps": steps.size(), "duration_ms": Time.get_ticks_msec() - start}
	if not recorder.is_empty():
		_tree.process_frame.disconnect(tick)
		_record_sample(recorder, true)
		out["record"] = _record_result(recorder)
	return Protocol.ok(out)


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
		if not _has_property(node, String(prop)):
			return Protocol.err(Protocol.INVALID_PARAMS, "%s has no property '%s'." % [node.get_class(), prop])
	var rec := {
		"node": node, "path": path, "properties": props.map(func(x: Variant) -> String: return String(x)),
		"interval": clampi(int(spec.get("interval_ms", 0)), 0, 1000),
		"samples": [], "total": 0, "last_t": -1000000, "start": 0,
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
		sample[prop] = Codec.encode(rec.node.get_indexed(NodePath(prop)))
	rec.samples.append(sample)
	rec.last_t = t
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
	return {"node": rec.path, "samples_total": rec.total, "samples": shown, "summary": summary,
		"note": "" if is_instance_valid(rec.node) else "The node was freed during recording."}


func _run_steps(steps: Array) -> void:
	for s in steps:
		if s.has("action"):
			var action := StringName(s.action)
			var strength := float(s.get("strength", 1.0))
			if s.get("release", false):
				_send_action(action, false, 0.0)
			elif s.get("press", false):
				_send_action(action, true, strength)
			else:
				_send_action(action, true, strength)
				await _sleep(int(s.get("hold_ms", 100)))
				_send_action(action, false, 0.0)
		elif s.has("key"):
			var code := OS.find_keycode_from_string(String(s.key))
			_send_key(code, true)
			await _sleep(int(s.get("hold_ms", 50)))
			_send_key(code, false)
		elif s.has("mouse_move"):
			_send_motion(Vector2(s.mouse_move[0], s.mouse_move[1]))
		elif s.has("mouse_click"):
			var pos := Vector2(s.mouse_click[0], s.mouse_click[1])
			var button := MOUSE_BUTTON_RIGHT if String(s.get("button", "left")) == "right" else MOUSE_BUTTON_LEFT
			_send_motion(pos)
			_send_click(pos, button, true)
			await _sleep(int(s.get("hold_ms", 50)))
			_send_click(pos, button, false)
		if s.has("wait_ms"):
			await _sleep(int(s.wait_ms))


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

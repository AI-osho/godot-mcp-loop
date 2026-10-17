@tool
extends RefCounted
## In-game commands executed by the runtime agent: query, input, wait_for, screenshot.
## Independent of the debugger channel so it can be unit-tested in a plain SceneTree.

const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")
const Codec = preload("res://addons/mcp_loop/util/value_codec.gd")
const Compare = preload("res://addons/mcp_loop/util/compare.gd")

const MAX_WAIT_MS := 120_000
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
			return Protocol.err(Protocol.TIMEOUT,
				"Condition %s %s %s not met within %d ms. Last value: %s" % [prop, op, JSON.stringify(expected), timeout_ms, shown],
				"Inspect the state with game_query or screenshot, or raise timeout_ms.")
		await _tree.process_frame
	return Protocol.err(Protocol.INTERNAL, "unreachable")


# ------------------------------------------------------------------ input

func _validate_steps(steps: Array) -> String:
	for i in steps.size():
		var s: Variant = steps[i]
		if typeof(s) != TYPE_DICTIONARY:
			return "Step %d must be an object." % i
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
	var start := Time.get_ticks_msec()
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
	return Protocol.ok({"steps": steps.size(), "duration_ms": Time.get_ticks_msec() - start})


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
	var max_width := clampi(int(p.get("max_width", 1280)), 64, 4096)
	if img.get_width() > max_width:
		var h := int(round(img.get_height() * float(max_width) / img.get_width()))
		img.resize(max_width, max(1, h), Image.INTERPOLATE_BILINEAR)
	return Protocol.ok({"png": img.save_png_to_buffer(), "width": img.get_width(), "height": img.get_height()})


func _no_rendering() -> Dictionary:
	return Protocol.err(Protocol.RENDERING_UNAVAILABLE, "The game is running without a renderer (headless), so no screenshot can be taken.",
		"Run the game with a window (remove --headless from Project Settings > Editor > Run > Main Run Args).")

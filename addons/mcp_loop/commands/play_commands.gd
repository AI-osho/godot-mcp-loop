@tool
extends RefCounted
## editor.status, editor.quit, game.run, game.stop, game.query, game.input, game.wait_for, game.set, game.call,
## screenshot, logs.read

const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")
const PathGuard = preload("res://addons/mcp_loop/util/path_guard.gd")

const RUNTIME_GRACE_MS := 5000

var ctx: RefCounted
var dbg: EditorDebuggerPlugin
var tree: SceneTree


func _init(context: RefCounted, debugger_bridge: EditorDebuggerPlugin, scene_tree: SceneTree) -> void:
	ctx = context
	dbg = debugger_bridge
	tree = scene_tree


func register(router: RefCounted) -> void:
	router.register("editor.status", _status)
	router.register("editor.quit", _quit)
	router.register("game.run", _run)
	router.register("game.stop", _stop)
	router.register("game.query", _query)
	router.register("game.input", _input)
	router.register("game.wait_for", _wait_for)
	router.register("game.set", _set_values)
	router.register("game.call", _call_method)
	router.register("game.pause", _pause)
	router.register("game.step", _step)
	router.register("screenshot", _screenshot)
	router.register("logs.read", _logs)


func _status(_p: Dictionary) -> Dictionary:
	var root: Node = ctx.edited_root()
	return Protocol.ok({
		"project_name": ProjectSettings.get_setting("application/config/name", ""),
		"main_scene": ProjectSettings.get_setting("application/run/main_scene", ""),
		"edited_scene": root.scene_file_path if root != null else null,
		"open_scenes": Array(EditorInterface.get_open_scenes()),
		"playing": EditorInterface.is_playing_scene(),
		"game": dbg.status(),
	})


func _wait_until(cond: Callable, timeout_ms: int) -> bool:
	var deadline := Time.get_ticks_msec() + timeout_ms
	while not cond.call():
		if Time.get_ticks_msec() > deadline:
			return false
		await tree.process_frame
	return true


func _run(p: Dictionary) -> Dictionary:
	var scene := String(p.get("scene", "main"))
	var timeout_ms := clampi(int(p.get("timeout_ms", 20000)), 1000, 120000)
	if EditorInterface.is_playing_scene():
		if not p.get("restart", false):
			return Protocol.err(Protocol.GAME_ALREADY_RUNNING, "The game is already running.",
				"Use game_stop first, or pass restart=true.")
		EditorInterface.stop_playing_scene()
		await _wait_until(func() -> bool: return not EditorInterface.is_playing_scene(), 5000)

	var target := ""
	match scene:
		"main", "":
			target = String(ProjectSettings.get_setting("application/run/main_scene", ""))
			if target == "":
				return Protocol.err(Protocol.INVALID_PARAMS, "The project has no main scene.",
					"Pass scene='current' or a res:// path, or set Project Settings > Application > Run > Main Scene.")
		"current":
			var root: Node = ctx.edited_root()
			if root == null or root.scene_file_path == "":
				return Protocol.err(Protocol.NO_EDITED_SCENE, "No saved scene is being edited.")
			target = root.scene_file_path
		_:
			var reason := PathGuard.check_read(scene)
			if reason != "":
				return Protocol.err(Protocol.PATH_FORBIDDEN, reason)
			if not FileAccess.file_exists(scene):
				return Protocol.err(Protocol.FILE_NOT_FOUND, "Scene not found: %s" % scene)
			target = scene

	# Launching while the editor is still scanning/importing can start a game
	# with stale or missing resources; wait for the scan to settle first.
	var fs := EditorInterface.get_resource_filesystem()
	await _wait_until(func() -> bool: return not fs.is_scanning(), timeout_ms)

	dbg.reset_for_run(bool(p.get("pause_on_error", false)))
	match scene:
		"main", "":
			EditorInterface.play_main_scene()
		"current":
			EditorInterface.play_current_scene()
		_:
			EditorInterface.play_custom_scene(target)

	var started_at := Time.get_ticks_msec()
	await _wait_until(func() -> bool:
		# Give the process a moment to appear before treating "not playing" as an exit.
		return dbg.ready or (Time.get_ticks_msec() - started_at > 2000 and not EditorInterface.is_playing_scene()), timeout_ms)
	if dbg.ready:
		return Protocol.ok({"running": true, "scene": dbg.runtime_info.get("scene", target), "pid": dbg.runtime_info.get("pid"), "display": dbg.runtime_info.get("display")})
	if not EditorInterface.is_playing_scene():
		return Protocol.err(Protocol.GAME_NOT_RUNNING, "The game exited before the MCP runtime connected.",
			"Check logs_read(source='editor') and the editor Output panel for errors.")
	return Protocol.err(Protocol.TIMEOUT, "The game started but the MCP runtime did not connect within %d ms." % timeout_ms,
		"Make sure the MCPLoopRuntime autoload is enabled (Project Settings > Globals > Autoload), or re-enable the plugin.")


func _stop(_p: Dictionary) -> Dictionary:
	if not EditorInterface.is_playing_scene():
		return Protocol.ok({"stopped": false, "was_running": false})
	EditorInterface.stop_playing_scene()
	var stopped: bool = await _wait_until(func() -> bool: return not EditorInterface.is_playing_scene(), 5000)
	return Protocol.ok({"stopped": stopped, "was_running": true, "game": dbg.status()})


## editor_quit: stops the game, saves the open scenes unless save=false, answers, then quits the editor.
func _quit(p: Dictionary) -> Dictionary:
	var was_playing := EditorInterface.is_playing_scene()
	if was_playing:
		EditorInterface.stop_playing_scene()
		await _wait_until(func() -> bool: return not EditorInterface.is_playing_scene(), 5000)
	var save := bool(p.get("save", true))
	if save:
		EditorInterface.save_all_scenes()
	# Quit only after the reply has gone out (the bridge sends it on the next poll).
	tree.create_timer(0.5, true).timeout.connect(func() -> void: tree.quit())
	return Protocol.ok({"quitting": true, "saved": save, "stopped_game": was_playing})


func _query(p: Dictionary) -> Dictionary:
	return await dbg.call_runtime(tree, "query", p, 10000)


func _wait_for(p: Dictionary) -> Dictionary:
	var t := clampi(int(p.get("timeout_ms", 5000)), 0, 120000)
	return await dbg.call_runtime(tree, "wait_for", p, t + RUNTIME_GRACE_MS)


func _set_values(p: Dictionary) -> Dictionary:
	return await dbg.call_runtime(tree, "set", p, 10000)


func _call_method(p: Dictionary) -> Dictionary:
	var t := clampi(int(p.get("timeout_ms", 10000)), 100, 60000)
	return await dbg.call_runtime(tree, "call", p, t + RUNTIME_GRACE_MS)


func _pause(p: Dictionary) -> Dictionary:
	return await dbg.call_runtime(tree, "pause", p, 10000)


func _step(p: Dictionary) -> Dictionary:
	return await dbg.call_runtime(tree, "step", p, _frames_ms(clampi(int(p.get("frames", 1)), 1, 3600)) + RUNTIME_GRACE_MS)


func _input(p: Dictionary) -> Dictionary:
	return await dbg.call_runtime(tree, "input", p, steps_duration_ms(p.get("steps", [])) + RUNTIME_GRACE_MS)


## Upper bound for how long input steps take (frames at 60 Hz with 2x headroom,
## inline waits and calls at their timeouts). Mirrors the server's stepsDurationMs.
static func steps_duration_ms(steps: Variant) -> int:
	if typeof(steps) != TYPE_ARRAY:
		return 0
	var total := 0
	for s in steps:
		if typeof(s) != TYPE_DICTIONARY:
			continue
		var holds: bool = (s.has("action") and not s.get("press", false) and not s.get("release", false)) or s.has("key") or s.has("mouse_click")
		if holds:
			total += _frames_ms(s.hold_frames) if s.has("hold_frames") else int(s.get("hold_ms", 100))
		if s.has("wait_frames"):
			total += _frames_ms(s.wait_frames)
		elif s.has("wait_ms"):
			total += int(s.wait_ms)
		if typeof(s.get("wait_for")) == TYPE_DICTIONARY:
			total += int(s.wait_for.get("timeout_ms", 5000))
		if typeof(s.get("call")) == TYPE_DICTIONARY:
			total += int(s.call.get("timeout_ms", 10000))
	return total


static func _frames_ms(n: Variant) -> int:
	return ceili(float(n) * 1000.0 * 2.0 / 60.0)


func _screenshot(p: Dictionary) -> Dictionary:
	var target := String(p.get("target", "game"))
	var res: Dictionary
	if target == "game":
		res = await dbg.call_runtime(tree, "screenshot", p, 15000)
	elif target == "editor":
		res = await _editor_screenshot(p)
	else:
		return Protocol.err(Protocol.INVALID_PARAMS, "target must be 'game' or 'editor'.")
	if not res.get("ok", false):
		return res
	var r: Dictionary = res.result
	return Protocol.ok({"png_base64": Marshalls.raw_to_base64(r.png), "width": r.width, "height": r.height, "target": target})


func _editor_screenshot(p: Dictionary) -> Dictionary:
	if DisplayServer.get_name() == "headless":
		return Protocol.err(Protocol.RENDERING_UNAVAILABLE, "The editor is running headless, so there is nothing to capture.")
	var root: Node = ctx.edited_root()
	var vp: SubViewport = EditorInterface.get_editor_viewport_3d() if root is Node3D else EditorInterface.get_editor_viewport_2d()
	await RenderingServer.frame_post_draw
	var img: Image = vp.get_texture().get_image() if vp != null else null
	if img == null or img.is_empty():
		return Protocol.err(Protocol.RENDERING_UNAVAILABLE, "Could not read the editor viewport.")
	var max_width := clampi(int(p.get("max_width", 1280)), 64, 2560)
	if img.get_width() > max_width:
		img.resize(max_width, max(1, int(round(img.get_height() * float(max_width) / img.get_width()))), Image.INTERPOLATE_BILINEAR)
	return Protocol.ok({"png": img.save_png_to_buffer(), "width": img.get_width(), "height": img.get_height()})


func _logs(p: Dictionary) -> Dictionary:
	var source := String(p.get("source", "game"))
	var since := int(p.get("since", 0))
	var min_level := String(p.get("min_level", "info"))
	var limit := clampi(int(p.get("limit", 200)), 1, 2000)
	var store: Variant
	match source:
		"game":
			store = dbg.game_logs
		"editor":
			store = ctx.log_capture
		_:
			return Protocol.err(Protocol.INVALID_PARAMS, "source must be 'game' or 'editor'.")
	var r: Dictionary = store.read(since, min_level, limit)
	r["source"] = source
	r["game_running"] = dbg.ready
	return Protocol.ok(r)

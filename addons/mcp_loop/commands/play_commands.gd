@tool
extends RefCounted
## editor.status, editor.quit, game.run, game.stop, game.query, game.input, game.wait_for, game.set, game.call,
## screenshot, logs.read

const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")
const PathGuard = preload("res://addons/mcp_loop/util/path_guard.gd")
const GodotArgs = preload("res://addons/mcp_loop/util/godot_args.gd")
const Movie = preload("res://addons/mcp_loop/commands/movie.gd")

const RUNTIME_GRACE_MS := 5000
## While recording a movie the game counts waits in game time and may run much slower than real time (software
## rendering, PNG encoding), so the editor's own safety timeouts get this much more room.
const MOVIE_SLOWDOWN := 10

var ctx: RefCounted
var dbg: EditorDebuggerPlugin
var tree: SceneTree
var _recording := false
var _lifecycle_busy := false
const RUN_NONCE_ENV := "GODOT_MCP_LOOP_LAUNCH_NONCE"


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
	router.register("game.ui_audit", _ui_audit)
	router.register("game.in_view", _in_view)
	router.register("game.ray", _ray)
	router.register("game.contacts", _contacts)
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


func _preflight_run_target(scene: String, target: String, current_id: int) -> Dictionary:
	if scene in ["main", ""] and String(ProjectSettings.get_setting("application/run/main_scene", "")) != target:
		return Protocol.err(Protocol.BUSY, "The main scene changed while waiting to launch.", "Check the selected target and retry game_run.")
	if scene == "current":
		var root: Node = ctx.edited_root()
		if root == null or root.get_instance_id() != current_id or root.scene_file_path != target:
			return Protocol.err(Protocol.BUSY, "The current edited scene changed while waiting to launch.", "Check the selected target and retry game_run.")
	var reason := GodotArgs.check(target)
	if reason != "":
		return Protocol.err(Protocol.INVALID_PARAMS, reason)
	var path := target
	if target.begins_with("uid://"):
		var uid := ResourceUID.text_to_id(target)
		if not ResourceUID.has_id(uid):
			return Protocol.err(Protocol.FILE_NOT_FOUND, "The selected scene UID is not registered after import.")
		path = ResourceUID.get_id_path(uid)
	reason = PathGuard.check_read(path)
	if reason != "":
		return Protocol.err(Protocol.PATH_FORBIDDEN, reason)
	if not FileAccess.file_exists(path):
		return Protocol.err(Protocol.FILE_NOT_FOUND, "Scene not found: " + path)
	reason = ctx.native_save_reason()
	if reason != "":
		return Protocol.err(Protocol.PATH_FORBIDDEN, reason)
	return Protocol.ok()


func _lifecycle_call(method: String, p: Dictionary) -> Dictionary:
	if _lifecycle_busy:
		return Protocol.err(Protocol.BUSY, "Another game run, stop or editor quit owns the lifecycle.", "Wait for that operation to finish; status queries remain available.")
	_lifecycle_busy = true
	var result: Dictionary
	if method == "run":
		result = await _run_owned(p)
	elif method == "stop":
		result = await _stop_owned(p)
	else:
		result = await _quit_owned(p)
	# A successful quit keeps admission closed until the deferred editor exit.
	_lifecycle_busy = method == "quit" and result.ok
	return result


func _run(p: Dictionary) -> Dictionary:
	return await _lifecycle_call("run", p)


func _stop(p: Dictionary) -> Dictionary:
	return await _lifecycle_call("stop", p)


func _quit(p: Dictionary) -> Dictionary:
	return await _lifecycle_call("quit", p)


func _run_owned(p: Dictionary) -> Dictionary:
	var scene := String(p.get("scene", "main"))
	for arg in [scene, ProjectSettings.globalize_path("res://")]:
		var reason := GodotArgs.check(arg)
		if reason != "":
			return Protocol.err(Protocol.INVALID_PARAMS, reason)
	var timeout_ms := clampi(int(p.get("timeout_ms", 20000)), 1000, 120000)
	var movie: Variant = p.get("movie", null)
	if movie != null and not (movie is Dictionary):
		return Protocol.err(Protocol.INVALID_PARAMS, "movie must be an object like {\"fps\": 30}.")
	if movie != null and not Movie.supported():
		return Protocol.err(Protocol.RENDERING_UNAVAILABLE, "This Godot version cannot record from the editor (Movie Maker).")
	var target := ""
	var current_id := 0
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
			current_id = root.get_instance_id()
		_:
			var reason := PathGuard.check_read(scene)
			if reason != "":
				return Protocol.err(Protocol.PATH_FORBIDDEN, reason)
			if not FileAccess.file_exists(scene):
				return Protocol.err(Protocol.FILE_NOT_FOUND, "Scene not found: %s" % scene)
			target = scene

	var arg_reason := GodotArgs.check(target)
	if arg_reason != "":
		return Protocol.err(Protocol.INVALID_PARAMS, arg_reason)
	var save_reason: String = ctx.native_save_reason()
	if save_reason != "":
		return Protocol.err(Protocol.PATH_FORBIDDEN, save_reason)
	# Finish preflight before stopping an existing game or creating a recording directory.
	if EditorInterface.is_playing_scene():
		if not p.get("restart", false):
			return Protocol.err(Protocol.GAME_ALREADY_RUNNING, "The game is already running.",
				"Use game_stop first, or pass restart=true.")
		EditorInterface.stop_playing_scene()
		if not await _wait_until(func() -> bool: return not EditorInterface.is_playing_scene(), 5000):
			return Protocol.err(Protocol.TIMEOUT, "The previous game did not stop; no replacement was launched.")

	# Launching while the editor is still scanning/importing can start a game
	# with stale or missing resources; wait for the scan to settle first.
	var fs := EditorInterface.get_resource_filesystem()
	await _wait_until(func() -> bool: return not fs.is_scanning(), timeout_ms)

	var checked := _preflight_run_target(scene, target, current_id)
	if not checked.ok:
		return checked
	dbg.reset_for_run(bool(p.get("pause_on_error", false)))
	_recording = movie != null
	var movie_info := {}
	var saved_movie := {}
	if movie != null:
		var fps := clampi(int(movie.get("fps", 30)), 1, 120)
		var dir := Movie.prepare()
		if dir == "":
			return Protocol.err(Protocol.PATH_FORBIDDEN, "The movie folder is not writable or contains a symbolic link.")
		movie_info = {"dir": dir, "fps": fps}
		saved_movie = Movie.begin(fps, dir.path_join("frame.png"))
	# Project/editor callbacks can run while movie settings change; recheck at the actual native sink too.
	checked = _preflight_run_target(scene, target, current_id)
	if not checked.ok:
		if movie != null:
			Movie.end(saved_movie)
		_recording = false
		return checked
	if EditorInterface.is_playing_scene():
		if movie != null:
			Movie.end(saved_movie)
		return Protocol.err(Protocol.BUSY, "A different game started while waiting to launch.")
	# Correlate the actual child hello with this launch, including a replacement
	# that starts before the first debugger session is established. Not an auth token.
	var run_nonce := Crypto.new().generate_random_bytes(16).hex_encode()
	var had_nonce := OS.has_environment(RUN_NONCE_ENV)
	var previous_nonce := OS.get_environment(RUN_NONCE_ENV)
	OS.set_environment(RUN_NONCE_ENV, run_nonce)
	if OS.get_environment(RUN_NONCE_ENV) != run_nonce:
		if movie != null:
			Movie.end(saved_movie)
		return Protocol.err(Protocol.INTERNAL, "Could not bind the native game launch.")
	match scene:
		"main", "":
			EditorInterface.play_main_scene()
		"current":
			EditorInterface.play_current_scene()
		_:
			EditorInterface.play_custom_scene(target)
	if had_nonce:
		OS.set_environment(RUN_NONCE_ENV, previous_nonce)
	else:
		OS.unset_environment(RUN_NONCE_ENV)
	if movie != null:
		Movie.end(saved_movie)

	var started_at := Time.get_ticks_msec()
	await _wait_until(func() -> bool:
		# Give the process a moment to appear before treating "not playing" as an exit.
		return dbg.ready or (Time.get_ticks_msec() - started_at > 2000 and not EditorInterface.is_playing_scene()), timeout_ms)
	if dbg.ready:
		var observed_nonce: Variant = dbg.runtime_info.get("launch_nonce")
		if typeof(observed_nonce) != TYPE_STRING or observed_nonce != run_nonce:
			return Protocol.err(Protocol.BUSY, "The running game changed before this launch completed.", "No replacement game was stopped. Inspect godot_status before retrying.")
		if not EditorInterface.is_playing_scene():
			return Protocol.err(Protocol.GAME_NOT_RUNNING, "The launched game has already exited.")
		var out := {"running": true, "scene": dbg.runtime_info.get("scene", target), "pid": dbg.runtime_info.get("pid"), "display": dbg.runtime_info.get("display")}
		if movie != null:
			if String(out.display) == "headless":
				EditorInterface.stop_playing_scene()
				return Protocol.err(Protocol.RENDERING_UNAVAILABLE, "The game runs headless, so there are no frames to record.",
					"Remove --headless from Project Settings > Editor > Run > Main Run Args for this run (recording needs a window).")
			out["movie"] = movie_info
		return Protocol.ok(out)
	if not EditorInterface.is_playing_scene():
		return Protocol.err(Protocol.GAME_NOT_RUNNING, "The game exited before the MCP runtime connected.",
			"Check logs_read(source='editor') and the editor Output panel for errors.")
	return Protocol.err(Protocol.TIMEOUT, "The game started but the MCP runtime did not connect within %d ms." % timeout_ms,
		"Make sure the MCPLoopRuntime autoload is enabled (Project Settings > Globals > Autoload), or re-enable the plugin.")


func _stop_owned(p: Dictionary) -> Dictionary:
	if not EditorInterface.is_playing_scene():
		return Protocol.ok({"stopped": false, "was_running": false})
	var owner_generation: int = dbg.current_generation()
	# graceful: let the game quit by itself (a Movie Maker recording is finished properly); kill it if it doesn't.
	var graceful := false
	if bool(p.get("graceful", false)) and dbg.ready:
		var r: Dictionary = await dbg.call_runtime(tree, "quit", {}, 3000)
		if EditorInterface.is_playing_scene() and dbg.current_generation() != owner_generation:
			return Protocol.err(Protocol.BUSY, "The game changed during graceful stop; its successor was not stopped.")
		if r.get("ok", false):
			await _wait_until(func() -> bool: return not EditorInterface.is_playing_scene() or dbg.current_generation() != owner_generation, 10000)
			graceful = not EditorInterface.is_playing_scene()
	if EditorInterface.is_playing_scene():
		if dbg.current_generation() != owner_generation:
			return Protocol.err(Protocol.BUSY, "The game changed before forced stop; its successor was not stopped.")
		EditorInterface.stop_playing_scene()
	var stopped: bool = await _wait_until(func() -> bool: return not EditorInterface.is_playing_scene() or (dbg.ready and dbg.current_generation() != owner_generation), 5000)
	if EditorInterface.is_playing_scene() and dbg.current_generation() != owner_generation:
		return Protocol.err(Protocol.BUSY, "The game changed while stopping; its successor was not stopped.")
	stopped = not EditorInterface.is_playing_scene()
	return Protocol.ok({"stopped": stopped, "was_running": true, "graceful": graceful, "game": dbg.status()})


## editor_quit: stops the game, saves the open scenes unless save=false, answers, then quits the editor.
func _quit_owned(p: Dictionary) -> Dictionary:
	var save := bool(p.get("save", true))
	if save:
		var reason: String = ctx.native_save_reason()
		if reason != "":
			return Protocol.err(Protocol.PATH_FORBIDDEN, reason)
	var was_playing := EditorInterface.is_playing_scene()
	if was_playing:
		EditorInterface.stop_playing_scene()
		await _wait_until(func() -> bool: return not EditorInterface.is_playing_scene(), 5000)
	if save:
		var reason: String = ctx.native_save_reason()
		if reason != "":
			return Protocol.err(Protocol.PATH_FORBIDDEN, reason)
		EditorInterface.save_all_scenes()
	# Quit only after the reply has gone out (the bridge sends it on the next poll).
	tree.create_timer(0.5, true).timeout.connect(func() -> void: tree.quit())
	return Protocol.ok({"quitting": true, "saved": save, "stopped_game": was_playing})


func _slack(ms: int) -> int:
	return ms * MOVIE_SLOWDOWN if _recording else ms


func _query(p: Dictionary) -> Dictionary:
	return await dbg.call_runtime(tree, "query", p, 10000)


func _ui_audit(p: Dictionary) -> Dictionary:
	return await dbg.call_runtime(tree, "ui.audit", p, 10000)


func _in_view(p: Dictionary) -> Dictionary:
	return await dbg.call_runtime(tree, "in_view", p, 10000)


func _ray(p: Dictionary) -> Dictionary:
	return await dbg.call_runtime(tree, "ray", p, 10000)


func _contacts(p: Dictionary) -> Dictionary:
	return await dbg.call_runtime(tree, "contacts", p, 10000)


func _wait_for(p: Dictionary) -> Dictionary:
	var t := clampi(int(p.get("timeout_ms", 5000)), 0, 120000)
	return await dbg.call_runtime(tree, "wait_for", p, _slack(t) + RUNTIME_GRACE_MS)


func _set_values(p: Dictionary) -> Dictionary:
	return await dbg.call_runtime(tree, "set", p, 10000)


func _call_method(p: Dictionary) -> Dictionary:
	var t := clampi(int(p.get("timeout_ms", 10000)), 100, 60000)
	return await dbg.call_runtime(tree, "call", p, _slack(t) + RUNTIME_GRACE_MS)


func _pause(p: Dictionary) -> Dictionary:
	return await dbg.call_runtime(tree, "pause", p, 10000)


func _step(p: Dictionary) -> Dictionary:
	return await dbg.call_runtime(tree, "step", p, _slack(_frames_ms(clampi(int(p.get("frames", 1)), 1, 3600))) + RUNTIME_GRACE_MS)


func _input(p: Dictionary) -> Dictionary:
	return await dbg.call_runtime(tree, "input", p, _slack(steps_duration_ms(p.get("steps", []))) + RUNTIME_GRACE_MS)


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
	var out := {"png_base64": Marshalls.raw_to_base64(r.png), "width": r.width, "height": r.height, "target": target}
	if r.has("source_width"):
		out["source_width"] = r.source_width
		out["source_height"] = r.source_height
	return Protocol.ok(out)


func _editor_screenshot(p: Dictionary) -> Dictionary:
	if DisplayServer.get_name() == "headless":
		return Protocol.err(Protocol.RENDERING_UNAVAILABLE, "The editor is running headless, so there is nothing to capture.")
	var root: Node = ctx.edited_root()
	var vp: SubViewport = EditorInterface.get_editor_viewport_3d() if root is Node3D else EditorInterface.get_editor_viewport_2d()
	# In low-processor mode the editor draws only when something changed, so an idle editor (e.g. one in the
	# background) would never emit frame_post_draw: ask for a redraw, and force one if it does not come.
	var drawn := [false]
	var on_drawn := func() -> void: drawn[0] = true
	RenderingServer.frame_post_draw.connect(on_drawn, CONNECT_ONE_SHOT)
	EditorInterface.get_base_control().queue_redraw()
	if vp != null and vp.get_parent() is CanvasItem:
		(vp.get_parent() as CanvasItem).queue_redraw()
	if not await _wait_until(func() -> bool: return drawn[0], 2000):
		if RenderingServer.frame_post_draw.is_connected(on_drawn):
			RenderingServer.frame_post_draw.disconnect(on_drawn)
		RenderingServer.force_draw()
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

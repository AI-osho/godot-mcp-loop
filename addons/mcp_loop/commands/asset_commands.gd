@tool
extends RefCounted
## image.write (pixel-art PNG from text), file.write (text files such as YAML scenarios)

const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")
const PathGuard = preload("res://addons/mcp_loop/util/path_guard.gd")
const PixelArt = preload("res://addons/mcp_loop/util/pixel_art.gd")
const TextDiff = preload("res://addons/mcp_loop/util/text_diff.gd")
const TextEdits = preload("res://addons/mcp_loop/util/text_edits.gd")

const TEXT_EXTENSIONS := ["yaml", "yml", "json", "md", "txt", "csv"]
const MAX_BYTES := 1024 * 1024
const MAX_DIFF_LINES := 300

var ctx: RefCounted


func _init(context: RefCounted) -> void:
	ctx = context


func register(router: RefCounted) -> void:
	router.register("image.write", _image_write)
	router.register("file.write", _file_write)


func _image_write(p: Dictionary) -> Dictionary:
	var path := PathGuard.normalize(String(p.get("path", "")))
	var reason := PathGuard.check_write(path, ["png"])
	if reason != "":
		return Protocol.err(Protocol.PATH_FORBIDDEN, reason)
	var built := PixelArt.build(p)
	if not built.ok:
		return Protocol.err(Protocol.INVALID_PARAMS, built.error, "Nothing was written.")
	var img: Image = built.image
	var exists := FileAccess.file_exists(path)
	var result := {
		"path": path, "created": not exists, "width": img.get_width(), "height": img.get_height(),
		"frames": built.frames, "frame_width": built.frame_width, "frame_height": built.frame_height,
		"tips": "Use it as {\"res\": \"%s\"} for a Sprite2D texture; set texture_filter = 1 (Nearest) on the node (or a parent) for crisp pixels; with several frames set hframes = %d and change 'frame' to animate." % [path, built.frames],
	}
	if p.get("dry_run", false):
		result["dry_run"] = true
		return Protocol.ok(result)
	var data := img.save_png_to_buffer()
	var old := FileAccess.get_file_as_bytes(path) if exists else PackedByteArray()
	var ops: RefCounted = ctx.file_ops
	ctx.commit("write %s" % path, null, func(ur: EditorUndoRedoManager) -> void:
		ur.add_do_method(ops, "write_bytes", path, data)
		if exists:
			ur.add_undo_method(ops, "write_bytes", path, old)
		else:
			ur.add_undo_method(ops, "remove_asset", path))
	# A file in a folder the editor hasn't seen yet is only imported after a scan.
	if not await _wait_until_importable(path):
		result["warning"] = "The PNG was written but the editor has not imported it yet; retry using it in a moment."
	return Protocol.ok(result)


func _wait_until_importable(path: String, timeout_ms: int = 15000) -> bool:
	if ResourceLoader.exists(path):
		return true
	var fs := EditorInterface.get_resource_filesystem()
	fs.scan()
	var tree := Engine.get_main_loop() as SceneTree
	var deadline := Time.get_ticks_msec() + timeout_ms
	var reimported := false
	while Time.get_ticks_msec() < deadline:
		await tree.process_frame
		if fs.is_scanning():
			continue
		if ResourceLoader.exists(path):
			return true
		# Once the scan has registered the new folder, importing works without
		# the "Can't find file" error that an earlier reimport would log.
		if not reimported and fs.get_filesystem_path(path.get_base_dir()) != null:
			fs.update_file(path)
			fs.reimport_files(PackedStringArray([path]))
			reimported = true
	return ResourceLoader.exists(path)


func _file_write(p: Dictionary) -> Dictionary:
	var path := PathGuard.normalize(String(p.get("path", "")))
	var reason := PathGuard.check_write(path, TEXT_EXTENSIONS)
	if reason != "":
		return Protocol.err(Protocol.PATH_FORBIDDEN, reason, "Use script_write for .gd and the scene/node tools for .tscn.")
	var has_content := p.get("content") != null
	var has_edits := p.get("edits") != null
	if has_content == has_edits:
		return Protocol.err(Protocol.INVALID_PARAMS, "Give either 'content' (whole file) or 'edits' (exact replacements).")
	var exists := FileAccess.file_exists(path)
	var old := FileAccess.get_file_as_string(path) if exists else ""
	var content: String
	var replacements := 0
	if has_content:
		if typeof(p.content) != TYPE_STRING:
			return Protocol.err(Protocol.INVALID_PARAMS, "'content' must be a string.")
		content = p.content
	else:
		if not exists:
			return Protocol.err(Protocol.FILE_NOT_FOUND, "File not found: %s" % path, "Create it with 'content' first.")
		var edited := TextEdits.apply(old, p.edits)
		if not edited.ok:
			return Protocol.err(Protocol.INVALID_PARAMS, edited.error, edited.get("hint", "Nothing was written."))
		content = edited.content
		replacements = edited.replacements
	if content.to_utf8_buffer().size() > MAX_BYTES:
		return Protocol.err(Protocol.INVALID_PARAMS, "Content is larger than 1 MB.")
	if path.get_extension().to_lower() == "json":
		var json := JSON.new()
		if json.parse(content) != OK:
			return Protocol.err(Protocol.INVALID_PARAMS, "Invalid JSON at line %d: %s" % [json.get_error_line(), json.get_error_message()], "Nothing was written.")
	var result := {"path": path, "created": not exists, "stats": TextDiff.stats(old, content)}
	if has_edits:
		result["replacements"] = replacements
	if exists:
		var diff := TextDiff.unified(old, content, path)
		var lines := diff.split("\n")
		if lines.size() > MAX_DIFF_LINES:
			diff = "\n".join(lines.slice(0, MAX_DIFF_LINES)) + "\n... (%d more diff lines)" % (lines.size() - MAX_DIFF_LINES)
		result["diff"] = diff
	else:
		result["summary"] = "created %s (%d lines)" % [path, content.count("\n") + (0 if content.ends_with("\n") or content == "" else 1)]
	if p.get("dry_run", false):
		result["dry_run"] = true
		return Protocol.ok(result)
	if exists and old == content:
		result["unchanged"] = true
		return Protocol.ok(result)
	var ops: RefCounted = ctx.file_ops
	ctx.commit("write %s" % path, null, func(ur: EditorUndoRedoManager) -> void:
		ur.add_do_method(ops, "write_text", path, content)
		if exists:
			ur.add_undo_method(ops, "write_text", path, old)
		else:
			ur.add_undo_method(ops, "remove_file", path))
	return Protocol.ok(result)

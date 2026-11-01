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
var _art_target_epoch := Crypto.new().generate_random_bytes(16).hex_encode()


func _init(context: RefCounted) -> void:
	ctx = context


func register(router: RefCounted) -> void:
	router.register("image.write", _image_write)
	router.register("file.write", _file_write)
	router.register("asset.scene_add", _art_scene_add)
	router.register("asset.scene_target", _art_scene_target)


func _image_write(p: Dictionary) -> Dictionary:
	var path := PathGuard.normalize(String(p.get("path", "")))
	var reason := PathGuard.check_write(path, ["png"])
	if reason != "":
		return Protocol.err(Protocol.PATH_FORBIDDEN, reason)
	var import_reason := PathGuard.check_write(path + ".import", ["import"])
	if import_reason != "":
		return Protocol.err(Protocol.PATH_FORBIDDEN, "The asset import path is not writable: " + import_reason)
	if not FileAccess.file_exists(path) and FileAccess.file_exists(path + ".import"):
		return Protocol.err(Protocol.ALREADY_EXISTS, "Import metadata already exists without the PNG; it is not owned by this new image.", "Inspect or move that .import file before creating the PNG.")
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
	var old := PackedByteArray()
	if exists:
		var snapshot: Dictionary = ctx.file_ops.snapshot_bytes(path)
		if not snapshot.ok:
			return snapshot
		old = snapshot.result.bytes
	var saved: Dictionary = ctx.commit_file("write %s" % path, "write_bytes", [path, data],
		"write_bytes" if exists else "remove_asset", [path, old] if exists else [path])
	if not saved.ok:
		return saved
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
	var old := ""
	if exists:
		var snapshot: Dictionary = ctx.file_ops.snapshot_bytes(path)
		if not snapshot.ok:
			return snapshot
		old = snapshot.result.bytes.get_string_from_utf8()
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
	var saved: Dictionary = ctx.commit_file("write %s" % path, "write_text", [path, content],
		"write_text" if exists else "remove_file", [path, old] if exists else [path])
	if not saved.ok:
		return saved
	return Protocol.ok(result)

# ---------------------------------------------------------------- generated artwork -> standard scene nodes

func _art_number(value: Variant) -> bool:
	return (typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT) and is_finite(value)


func _art_integer(value: Variant) -> bool:
	return _art_number(value) and value == floor(value)


func _art_name(value: Variant) -> bool:
	return typeof(value) == TYPE_STRING and not value.is_empty() and value.length() <= 64 and value == value.strip_edges() and value not in [".", ".."] and value.validate_node_name() == value


func _art_check_png(meta: Dictionary) -> Dictionary:
	var reason := PathGuard.check_read(meta.path)
	if reason == "":
		reason = PathGuard.check_write(meta.path + ".import", ["import"])
	if reason != "":
		return Protocol.err(Protocol.PATH_FORBIDDEN, reason)
	var file := FileAccess.open(meta.path, FileAccess.READ)
	if file == null:
		return Protocol.err(Protocol.FILE_NOT_FOUND, "Generated PNG not found.")
	if file.get_length() > 32000000 or file.get_length() != meta.bytes:
		return Protocol.err(Protocol.INVALID_PARAMS, "PNG byte length changed or exceeds bounds.")
	var data := file.get_buffer(file.get_length())
	file.close()
	var digest := HashingContext.new()
	digest.start(HashingContext.HASH_SHA256)
	digest.update(data)
	if digest.finish().hex_encode() != meta.sha256:
		return Protocol.err(Protocol.INVALID_PARAMS, "Generated PNG changed since validation.")
	var image := Image.new()
	if image.load_png_from_buffer(data) != OK or image.get_width() != int(meta.width) or image.get_height() != int(meta.height):
		return Protocol.err(Protocol.INVALID_PARAMS, "PNG does not match its frame metadata.")
	return Protocol.ok({})


func _art_scene_target(p: Dictionary) -> Dictionary:
	var root: Node = ctx.edited_root()
	if root == null:
		return ctx.no_scene_error()
	var path: Variant = p.get("parent", ".")
	if typeof(path) != TYPE_STRING:
		return Protocol.err(Protocol.INVALID_PARAMS, "parent must be a scene-relative node path.")
	var parent: Node = ctx.resolve_node(path)
	if parent == null:
		return ctx.node_not_found(path)
	if not (parent is Node2D or parent is Control):
		return Protocol.err(Protocol.INVALID_PARAMS, "Artwork needs a Node2D or Control parent.")
	return Protocol.ok({"epoch": _art_target_epoch, "root_id": str(root.get_instance_id()),
		"parent_id": str(parent.get_instance_id()), "scene_path": root.scene_file_path})


func _art_scene_add(p: Dictionary) -> Dictionary:
	var selected := _art_scene_target(p)
	if not selected.ok:
		return selected
	var expected: Variant = p.get("expected_target")
	if typeof(expected) != TYPE_DICTIONARY or expected != selected.result:
		return Protocol.err(Protocol.INVALID_PARAMS, "Artwork target scene or parent changed before import.", "No scene nodes were added. Inspect the selected scene and retry.")
	var root: Node = ctx.edited_root()
	if root == null:
		return ctx.no_scene_error()
	var scene_path := root.scene_file_path
	var parent_path: Variant = p.get("parent", ".")
	if typeof(parent_path) != TYPE_STRING:
		return Protocol.err(Protocol.INVALID_PARAMS, "parent must be a scene-relative node path.")
	var parent: Node = ctx.resolve_node(parent_path)
	if parent == null:
		return ctx.node_not_found(parent_path)
	if not (parent is Node2D or parent is Control):
		return Protocol.err(Protocol.INVALID_PARAMS, "Artwork needs a Node2D or Control parent.")
	var group_name: Variant = p.get("name", "Artwork")
	if not _art_name(group_name):
		return Protocol.err(Protocol.INVALID_PARAMS, "Give a valid literal group name; names are not repaired.")
	if parent.has_node(NodePath(group_name)):
		return Protocol.err(Protocol.ALREADY_EXISTS, "A child named %s already exists." % group_name)
	var assets: Variant = p.get("assets")
	var placements: Variant = p.get("placements")
	if typeof(assets) != TYPE_ARRAY or assets.is_empty() or assets.size() > 80 or typeof(placements) != TYPE_ARRAY or placements.is_empty() or placements.size() > 64:
		return Protocol.err(Protocol.INVALID_PARAMS, "Give bounded assets and placements arrays.")
	var by_id := {}
	var path_pattern := RegEx.create_from_string("^res://assets/generated/[a-z][a-z0-9_-]{0,47}/[a-z][a-z0-9_-]{0,47}\\.png$")
	for value in assets:
		if typeof(value) != TYPE_DICTIONARY:
			return Protocol.err(Protocol.INVALID_PARAMS, "Asset entries must be objects.")
		var meta: Dictionary = value
		if typeof(meta.get("id")) != TYPE_STRING or by_id.has(meta.id) or typeof(meta.get("path")) != TYPE_STRING or path_pattern.search(meta.path) == null:
			return Protocol.err(Protocol.INVALID_PARAMS, "Invalid generated asset identity.")
		if typeof(meta.get("sha256")) != TYPE_STRING or meta.sha256.length() != 64:
			return Protocol.err(Protocol.INVALID_PARAMS, "Missing asset byte digest.")
		for key in ["width", "height", "frame_width", "frame_height", "frames", "bytes"]:
			if not _art_integer(meta.get(key)) or meta[key] <= 0:
				return Protocol.err(Protocol.INVALID_PARAMS, "Invalid asset dimensions or frame count.")
		if meta.width > 16384 or meta.height > 4096 or meta.width * meta.height > 16000000 or meta.frames > 64 or meta.width != meta.frame_width * meta.frames or meta.height != meta.frame_height:
			return Protocol.err(Protocol.INVALID_PARAMS, "Atlas layout exceeds bounds or does not divide into frames.")
		var anchor: Variant = meta.get("anchor")
		if typeof(anchor) != TYPE_ARRAY or anchor.size() != 2 or not _art_integer(anchor[0]) or not _art_integer(anchor[1]) or anchor[0] < 0 or anchor[0] > meta.frame_width or anchor[1] < 0 or anchor[1] > meta.frame_height:
			return Protocol.err(Protocol.INVALID_PARAMS, "Invalid anchor.")
		var animation: Variant = meta.get("animation")
		if typeof(animation) != TYPE_DICTIONARY or not _art_number(animation.get("fps")) or animation.fps <= 0 or animation.fps > 120 or typeof(animation.get("loop")) != TYPE_BOOL:
			return Protocol.err(Protocol.INVALID_PARAMS, "Invalid animation playback metadata.")
		var checked := _art_check_png(meta)
		if not checked.ok:
			return checked
		by_id[meta.id] = meta
	var names := {}
	for value in placements:
		if typeof(value) != TYPE_DICTIONARY:
			return Protocol.err(Protocol.INVALID_PARAMS, "Placement entries must be objects.")
		var place: Dictionary = value
		if typeof(place.get("asset_id")) != TYPE_STRING or not by_id.has(place.asset_id) or not _art_name(place.get("name")) or names.has(place.name):
			return Protocol.err(Protocol.INVALID_PARAMS, "Placement has an unknown asset or repeated/invalid name.")
		names[place.name] = true
		if typeof(place.get("play", false)) != TYPE_BOOL:
			return Protocol.err(Protocol.INVALID_PARAMS, "play must be a boolean.")
		var pos: Variant = place.get("position")
		if typeof(pos) != TYPE_ARRAY or pos.size() != 2 or not _art_number(pos[0]) or not _art_number(pos[1]) or abs(pos[0]) > 1000000 or abs(pos[1]) > 1000000:
			return Protocol.err(Protocol.INVALID_PARAMS, "Invalid placement position.")
		if not _art_number(place.get("scale", 1.0)) or place.get("scale", 1.0) <= 0 or place.get("scale", 1.0) > 16:
			return Protocol.err(Protocol.INVALID_PARAMS, "Invalid uniform scale.")
		if not _art_integer(place.get("z_index", 0)) or abs(place.get("z_index", 0)) > 4096:
			return Protocol.err(Protocol.INVALID_PARAMS, "Invalid drawing order.")
		if not _art_integer(place.get("frame", 0)) or place.get("frame", 0) < 0 or place.get("frame", 0) >= by_id[place.asset_id].frames:
			return Protocol.err(Protocol.INVALID_PARAMS, "Frame index outside atlas.")
	var result := {"path": group_name if parent == root else ctx.rel_path(parent).path_join(group_name), "placements": placements.size(), "dry_run": bool(p.get("dry_run", false))}
	if result.dry_run:
		return Protocol.ok(result)
	var textures := {}
	for id in by_id:
		var meta: Dictionary = by_id[id]
		if not await _wait_until_importable(meta.path):
			return Protocol.err(Protocol.TIMEOUT, "Editor has not imported the PNG yet.", "No scene nodes were added. Wait for import, then retry.")
	# No await after this point: revalidate each PNG after the final import
	# wait, before loading its texture or committing scene nodes.
	for id in by_id:
		var meta: Dictionary = by_id[id]
		var checked := _art_check_png(meta)
		if not checked.ok:
			return checked
		var texture := ResourceLoader.load(meta.path, "Texture2D") as Texture2D
		if texture == null:
			return Protocol.err(Protocol.INVALID_PARAMS, "Generated PNG is not a Texture2D.")
		textures[id] = texture
	# Imports yield to the editor. A scene switch or deleted/replaced parent must
	# not turn this request into an edit of a stale target.
	if not is_instance_valid(root) or ctx.edited_root() != root or root.scene_file_path != scene_path or not is_instance_valid(parent) or ctx.resolve_node(parent_path) != parent:
		return Protocol.err(Protocol.INVALID_PARAMS, "Artwork target scene or parent changed during import.", "No scene nodes were added. Inspect the selected scene before retrying.")
	if parent.has_node(NodePath(group_name)):
		return Protocol.err(Protocol.ALREADY_EXISTS, "A child named %s appeared during import." % group_name, "No scene nodes were added; choose a new literal group name.")
	var group := Node2D.new()
	group.name = group_name
	for place in placements:
		var meta: Dictionary = by_id[place.asset_id]
		var sprite: Node2D
		if int(meta.frames) == 1:
			var still := Sprite2D.new()
			still.texture = textures[place.asset_id]
			sprite = still
		else:
			var frames := SpriteFrames.new()
			frames.clear("default")
			for index in range(int(meta.frames)):
				var region := AtlasTexture.new()
				region.atlas = textures[place.asset_id]
				region.region = Rect2(index * int(meta.frame_width), 0, int(meta.frame_width), int(meta.frame_height))
				frames.add_frame("default", region)
			frames.set_animation_speed("default", float(meta.animation.fps))
			frames.set_animation_loop("default", bool(meta.animation.loop))
			var animated := AnimatedSprite2D.new()
			animated.sprite_frames = frames
			animated.frame = int(place.get("frame", 0))
			if place.get("play", false):
				animated.autoplay = "default"
			sprite = animated
		sprite.name = place.name
		sprite.set("centered", false)
		sprite.set("offset", -Vector2(meta.anchor[0], meta.anchor[1]))
		sprite.position = Vector2(place.position[0], place.position[1])
		var factor := float(place.get("scale", 1.0))
		sprite.scale = Vector2(factor, factor)
		sprite.z_index = int(place.get("z_index", 0))
		sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		group.add_child(sprite)
	ctx.commit("place artwork %s" % group_name, root, func(ur: EditorUndoRedoManager) -> void:
		ur.add_do_method(parent, "add_child", group, false)
		ur.add_do_method(group, "set_owner", root)
		for child in group.get_children():
			ur.add_do_method(child, "set_owner", root)
		ur.add_do_reference(group)
		ur.add_undo_method(parent, "remove_child", group))
	return Protocol.ok(result)


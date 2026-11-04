@tool
extends RefCounted
## Addition-only subtree construction. Target files and source PNGs are never written here.
const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")
const PathGuard = preload("res://addons/mcp_loop/util/path_guard.gd")
const Codec = preload("res://addons/mcp_loop/util/value_codec.gd")
const Plan = preload("res://addons/mcp_loop/commands/tree_build_plan.gd")

class ErrorCounter extends Logger:
	var mutex := Mutex.new()
	var errors := 0
	func _log_message(_message: String, is_error: bool) -> void:
		if is_error:
			mutex.lock()
			errors += 1
			mutex.unlock()
	func _log_error(_function: String, _file: String, _line: int, _code: String, _rationale: String, _notify: bool, kind: int, _backtraces: Array[ScriptBacktrace]) -> void:
		if kind != Logger.ERROR_TYPE_WARNING:
			mutex.lock()
			errors += 1
			mutex.unlock()
	func total() -> int:
		mutex.lock()
		var result := errors
		mutex.unlock()
		return result

var ctx: RefCounted
var _policy_result: Dictionary
var _busy := false

func _init(context: RefCounted) -> void:
	ctx = context
	_policy_result = Plan.load_policy()

func register(router: RefCounted) -> void:
	router.register("node.add_tree", _add_tree)

func _add_tree(input: Dictionary) -> Dictionary:
	if _busy:
		return Protocol.err(Protocol.BUSY, "Another subtree construction is still running.")
	if not _policy_result.ok:
		return _policy_result
	_busy = true
	var result := _run(input, _policy_result.result)
	_busy = false
	return result

func _target(scene: String) -> Dictionary:
	var root: Node = ctx.edited_root()
	if root == null or root.scene_file_path != scene:
		return Protocol.err(Protocol.SCENE_TARGET_MISMATCH, "The explicitly named scene is not the edited scene.")
	if PathGuard.check_write(scene, ["tscn"]) != "":
		return Protocol.err(Protocol.PATH_FORBIDDEN, "The scene save destination is protected or unsafe.")
	if root.get_class() not in ["Node2D", "Control"] or root.get_script() != null or root.owner != null:
		return Protocol.err(Protocol.SCENE_TARGET_MISMATCH, "The target must be an ordinary scriptless Node2D or Control root.")
	if root.get_child_count(true) != 0:
		return Protocol.err(Protocol.SCENE_NOT_EMPTY, "The target scene already contains child nodes.")
	var manager := EditorInterface.get_editor_undo_redo()
	if manager.is_committing_action() or ctx._file_busy or not ctx._file_registration_fault.is_empty():
		return Protocol.err(Protocol.BUSY, "Native history or a prior file operation is not available for a new subtree.")
	# Native Node.get_scene_inherited_state is not bound. Inspect an in-memory pack of this empty native root instead.
	var packed := PackedScene.new()
	if packed.pack(root) != OK:
		return Protocol.err(Protocol.SCENE_TARGET_MISMATCH, "The empty target cannot be represented as an ordinary scene.")
	var state := packed.get_state()
	if state.get_base_scene_state() != null or state.get_node_instance(0) != null:
		return Protocol.err(Protocol.SCENE_TARGET_MISMATCH, "Inherited or instanced target roots are outside this tool's scope.")
	return Protocol.ok({"root": root, "history": manager.get_history_undo_redo(manager.get_object_history_id(root))})

func _reply(plan: Dictionary, applied: bool, action: Variant = null) -> Dictionary:
	var result := {"schema_version": 1, "scene": plan.scene, "dry_run": plan.dry_run,
		"applied": applied, "disk_saved": false, "planned_count": plan.nodes.size(),
		"created_count": plan.nodes.size() if applied else 0, "undo_action": action}
	result["created_nodes" if applied else "planned_nodes"] = plan.planned_nodes
	return result

func _u32(bytes: PackedByteArray, offset: int) -> int:
	return (int(bytes[offset]) << 24) | (int(bytes[offset + 1]) << 16) | (int(bytes[offset + 2]) << 8) | int(bytes[offset + 3])

func _png_header_valid(header: PackedByteArray) -> bool:
	if header.size() != 33 or header.slice(0, 8) != PackedByteArray([137, 80, 78, 71, 13, 10, 26, 10]) or _u32(header, 8) != 13 or header.slice(12, 16) != PackedByteArray([73, 72, 68, 82]):
		return false
	var depths := {0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16]}
	if not depths.has(int(header[25])) or not depths[int(header[25])].has(int(header[24])) or header[26] != 0 or header[27] != 0 or header[28] not in [0, 1]:
		return false
	var crc: int = 0xffffffff
	for byte in header.slice(12, 29):
		crc = crc ^ int(byte)
		for bit in 8:
			crc = (crc >> 1) ^ (0xedb88320 if (crc & 1) != 0 else 0)
	return (crc ^ 0xffffffff) == _u32(header, 29)

func _valid_import_utf8(bytes: PackedByteArray) -> bool:
	var index := 0
	while index < bytes.size():
		var first := int(bytes[index])
		if first == 0:
			return false
		if first < 128:
			index += 1
			continue
		var count := 1 if first >= 0xc2 and first <= 0xdf else (2 if first >= 0xe0 and first <= 0xef else (3 if first >= 0xf0 and first <= 0xf4 else -1))
		if count < 0 or index + count >= bytes.size():
			return false
		for offset in range(1, count + 1):
			if bytes[index + offset] < 0x80 or bytes[index + offset] > 0xbf:
				return false
		var second := int(bytes[index + 1])
		if (first == 0xe0 and second < 0xa0) or (first == 0xed and second >= 0xa0) or (first == 0xf0 and second < 0x90) or (first == 0xf4 and second >= 0x90):
			return false
		index += count + 1
	return true

func _import_values(text: String, key_pattern: String, array_value: bool = false) -> Array:
	var literal := '(\\[[^\\r\\n]*\\])' if array_value else '("(?:[^"\\\\]|\\\\.)*")'
	var pattern := RegEx.create_from_string('(?m)^' + key_pattern + '=' + literal + '\\r?$')
	var values: Array = []
	for matched in pattern.search_all(text):
		var parser := JSON.new()
		if parser.parse(matched.get_string(1)) != OK:
			return []
		values.append(parser.data)
	return values

func _safe_import_remap(path: String) -> bool:
	var file := FileAccess.open(path + ".import", FileAccess.READ)
	if file == null:
		return false
	var length := file.get_length()
	if length <= 0 or length > 65536:
		file.close()
		return false
	var bytes := file.get_buffer(length)
	file.close()
	if bytes.size() != length or not _valid_import_utf8(bytes):
		return false
	var text := bytes.get_string_from_utf8()
	# Godot's native Variant parser can construct objects. Admit no unquoted constructor syntax.
	var quoted := false
	var escaped := false
	for character in text:
		if quoted:
			if escaped:
				escaped = false
			elif character == "\\":
				escaped = true
			elif character == "\"":
				quoted = false
		elif character == "\"":
			quoted = true
		elif character in ["(", ")", "&", "^"]:
			return false
	if quoted or escaped:
		return false
	var importer := _import_values(text, "importer")
	var type := _import_values(text, "type")
	var source := _import_values(text, "source_file")
	var destinations := _import_values(text, "dest_files", true)
	var remaps := _import_values(text, 'path(?:\\.[a-z0-9_]{1,16})?')
	if importer.size() != 1 or importer[0] != "texture" or type.size() != 1 or type[0] != "CompressedTexture2D" or source.size() != 1 or source[0] != path or destinations.size() != 1 or typeof(destinations[0]) != TYPE_ARRAY or remaps.is_empty() or remaps.size() > 16:
		return false
	var stem := "res://.godot/imported/" + path.get_file() + "-" + path.md5_text()
	var suffix := RegEx.create_from_string('^\\.[a-z0-9_]{1,16}\\.ctex$')
	for remap in remaps:
		if typeof(remap) != TYPE_STRING or not remap.begins_with(stem):
			return false
		var tail: String = remap.substr(stem.length())
		if tail != ".ctex" and suffix.search(tail) == null:
			return false
	if destinations[0].size() != remaps.size():
		return false
	for destination in destinations[0]:
		if typeof(destination) != TYPE_STRING or not remaps.has(destination):
			return false
	return true

func _import_source_matches(path: String) -> bool:
	# Only this derived native cache metadata is read, never a caller-selected .godot path.
	var directory := DirAccess.open("res://")
	for segment in [".godot", "imported"]:
		if directory == null or directory.is_link(segment) or not directory.dir_exists(segment):
			return false
		directory = DirAccess.open(directory.get_current_dir().path_join(segment))
	var name := path.get_file() + "-" + path.md5_text() + ".md5"
	if directory == null or directory.is_link(name) or not directory.file_exists(name):
		return false
	var file := FileAccess.open(directory.get_current_dir().path_join(name), FileAccess.READ)
	if file == null:
		return false
	var length := file.get_length()
	if length <= 0 or length > 512:
		file.close()
		return false
	var bytes := file.get_buffer(length)
	file.close()
	if bytes.size() != length or bytes.has(0):
		return false
	for byte in bytes:
		if byte > 127:
			return false
	var pattern := RegEx.create_from_string('(?m)^source_md5="([0-9a-f]{32})"\\r?$')
	var matches := pattern.search_all(bytes.get_string_from_ascii())
	return matches.size() == 1 and matches[0].get_string(1) == FileAccess.get_md5(path)

func _load_texture(path: String) -> Texture2D:
	return ResourceLoader.load(path, "Texture2D", ResourceLoader.CACHE_MODE_IGNORE) as Texture2D

func _textures(paths: Array, policy: Dictionary) -> Dictionary:
	var metadata := {}
	var pixels := 0
	if not paths.is_empty() and EditorInterface.get_resource_filesystem().is_scanning():
		return Protocol.err(Protocol.RESOURCE_NOT_READY, "PNG import is still in progress; this tool does not import or wait.")
	for path in paths:
		if PathGuard.check_read(path) != "" or PathGuard.check_read(path + ".import") != "":
			return Protocol.err(Protocol.PATH_FORBIDDEN, "A PNG reference or its metadata path is protected or unsafe.")
		var file := FileAccess.open(path, FileAccess.READ)
		if file == null:
			return Protocol.err(Protocol.RESOURCE_NOT_READY, "A referenced PNG is not readable.")
		var length := file.get_length()
		if length < 33 or length > policy.limits.png_bytes:
			file.close()
			return Protocol.err(Protocol.RESOURCE_NOT_READY, "A referenced PNG exceeds the byte limit or lacks a complete header.")
		var header := file.get_buffer(33)
		file.close()
		if not _png_header_valid(header):
			return Protocol.err(Protocol.RESOURCE_NOT_READY, "A referenced file does not have a supported PNG header.")
		var width := _u32(header, 16)
		var height := _u32(header, 20)
		if width <= 0 or height <= 0 or width > policy.limits.png_side or height > policy.limits.png_side:
			return Protocol.err(Protocol.RESOURCE_NOT_READY, "A PNG dimension exceeds the declared side limit.")
		pixels += width * height
		if pixels > policy.limits.png_pixels_total:
			return Protocol.err(Protocol.RESOURCE_NOT_READY, "Referenced PNGs exceed the total decoded pixel budget.")
		if not FileAccess.file_exists(path + ".import") or not _safe_import_remap(path) or not ResourceLoader.exists(path, "Texture2D"):
			return Protocol.err(Protocol.RESOURCE_NOT_READY, "A referenced PNG has no ready Texture2D import.")
		if not _import_source_matches(path):
			return Protocol.err(Protocol.RESOURCE_NOT_READY, "PNG source bytes do not match a current native import.")
		metadata[path] = {"width": width, "height": height}
	# All headers and the aggregate pixel budget were checked before loading any texture.
	var textures := {}
	for path in metadata:
		var texture := _load_texture(path)
		if texture == null or texture.get_width() != metadata[path].width or texture.get_height() != metadata[path].height:
			return Protocol.err(Protocol.RESOURCE_NOT_READY, "The ready texture does not match its PNG header.")
		textures[path] = texture
	return Protocol.ok(textures)

func _priority(key: String) -> int:
	if key.begins_with("theme_override_"):
		return 0
	if key == "autowrap_mode":
		return 1
	if key.begins_with("anchor_"):
		return 2
	if key.begins_with("offset_"):
		return 3
	if key == "custom_minimum_size":
		return 4
	return 6 if key == "text" else 5

func _ordered_resource(value: Variant) -> Variant:
	if typeof(value) != TYPE_DICTIONARY or not value.has("new"):
		return value
	var properties: Dictionary = value.get("properties", {})
	var ordered := {}
	# Capsule setters interact with defaults; radius must be assigned before the requested height.
	for key in ["radius", "height"]:
		if properties.has(key):
			ordered[key] = properties[key]
	for key in properties:
		if not ordered.has(key):
			ordered[key] = properties[key]
	return {"new": value.new, "properties": ordered}

func _property(obj: Object, key: String) -> Dictionary:
	for info in obj.get_property_list():
		if info.name == key:
			return info
	return {}

func _same_value(actual: Variant, expected: Variant) -> bool:
	if typeof(actual) != typeof(expected):
		return false
	if typeof(expected) == TYPE_FLOAT:
		if actual == expected:
			return true
		var rounded: float = PackedFloat32Array([expected])[0]
		return actual == rounded and (rounded != 0 or expected == 0)
	return actual == expected

func _readback(obj: Object, properties: Dictionary, rules: Dictionary, policy: Dictionary, textures: Dictionary) -> bool:
	for key in properties:
		var info := _property(obj, key)
		if info.is_empty():
			return false
		var raw: Variant = properties[key]
		var actual: Variant = obj.get(key)
		var rule: Dictionary = rules[key]
		if rule.kind == "resource":
			if raw == null:
				if actual != null:
					return false
			elif not actual is Resource or actual.get_class() != raw.new or not _readback(actual, raw.get("properties", {}), policy.resources[raw.new], policy, textures):
				return false
		elif rule.kind == "texture":
			if actual != (null if raw == null else textures[raw.res]):
				return false
		else:
			var expected := Codec.decode(raw, int(info.type))
			if not expected.ok or not _same_value(actual, expected.value):
				return false
	return true

func _stage_failure(top: Node, field: String) -> Dictionary:
	return {"ok": false, "top": top, "error": Protocol.err(Protocol.TREE_BUILD_VALIDATION_FAILED,
		field + " failed detached native validation or setter readback.").error}

func _stage(plan: Dictionary, policy: Dictionary, textures: Dictionary) -> Dictionary:
	var top: Node = null
	var by_id := {}
	var nodes: Array = []
	for spec in plan.nodes:
		var node: Node = ClassDB.instantiate(spec.type)
		if node == null:
			return _stage_failure(top, "nodes.type")
		if top == null:
			top = node
		else:
			by_id[spec.parent_id].add_child(node, false)
		node.name = spec.name
		by_id[spec.id] = node
		nodes.append(node)
		if node.get_script() != null or node.get_class() != spec.type or String(node.name) != spec.name:
			return _stage_failure(top, "nodes.name or nodes.type")
	# Build the hierarchy first; then theme/wrap/geometry precede literal text.
	for index in plan.nodes.size():
		var spec: Dictionary = plan.nodes[index]
		var node: Node = nodes[index]
		var rules: Dictionary = policy.nodes[spec.type]
		var wire := {}
		for priority in 7:
			for key in spec.properties:
				if _priority(key) == priority and rules[key].kind != "texture":
					wire[key] = _ordered_resource(spec.properties[key])
		var decoded: Dictionary = ctx.decode_properties(node, wire)
		if not decoded.ok:
			return _stage_failure(top, "nodes[%d].properties" % index)
		for key in decoded.values:
			node.set(key, decoded.values[key])
		for key in spec.properties:
			if rules[key].kind == "texture":
				var reference: Variant = spec.properties[key]
				node.set(key, null if reference == null else textures[reference.res])
		if not _readback(node, spec.properties, rules, policy, textures):
			return _stage_failure(top, "nodes[%d].properties" % index)
	return {"ok": true, "top": top, "nodes": nodes, "by_id": by_id}

func _before_commit_failure(top: Node, scope: ErrorCounter, error: Dictionary) -> Dictionary:
	if is_instance_valid(top):
		top.free()
	OS.remove_logger(scope)
	return error

func _run(input: Dictionary, policy: Dictionary) -> Dictionary:
	var validated := Plan.validate_request(input, policy)
	if not validated.ok:
		return validated
	var plan: Dictionary = validated.result
	var target := _target(plan.scene)
	if not target.ok:
		return target
	var root: Node = target.result.root
	var history: UndoRedo = target.result.history
	var version := history.get_version()
	# Both possible complete success replies must fit before nodes are allocated or committed.
	if JSON.stringify(_reply(plan, false)).to_utf8_buffer().size() > policy.limits.reply_bytes or JSON.stringify(_reply(plan, true, "MCP#999999999999: add subtree")).to_utf8_buffer().size() > policy.limits.reply_bytes:
		return Protocol.err(Protocol.INVALID_TREE_PLAN, "The complete subtree reply exceeds its byte budget.")
	var scope := ErrorCounter.new()
	OS.add_logger(scope)
	var loaded := _textures(plan.png_paths, policy)
	if not loaded.ok:
		return _before_commit_failure(null, scope, loaded)
	var staged := _stage(plan, policy, loaded.result)
	if not staged.ok:
		return _before_commit_failure(staged.top, scope, {"ok": false, "error": staged.error})
	var top: Node = staged.top
	if scope.total() != 0:
		return _before_commit_failure(top, scope, Protocol.err(Protocol.TREE_BUILD_VALIDATION_FAILED, "Detached construction reported a native error."))
	var final_target := _target(plan.scene)
	if not final_target.ok or not is_instance_valid(root) or ctx.edited_root() != root or history.get_version() != version:
		return _before_commit_failure(top, scope, Protocol.err(Protocol.SCENE_TARGET_MISMATCH, "The target scene or native history changed during validation."))
	if plan.dry_run:
		top.free()
		var clean := scope.total() == 0
		OS.remove_logger(scope)
		return Protocol.ok(_reply(plan, false)) if clean else Protocol.err(Protocol.TREE_BUILD_VALIDATION_FAILED, "Preview cleanup reported a native error.")
	# No await after final validation. Ownership passes to native history at this commit; never manually free afterwards.
	var action: String = ctx.commit("add subtree", root, func(manager: EditorUndoRedoManager) -> void:
		manager.add_do_method(root, "add_child", top, false)
		for node in staged.nodes:
			manager.add_do_method(node, "set_owner", root)
		manager.add_do_reference(top)
		manager.add_undo_method(root, "remove_child", top))
	var confirmed: bool = is_instance_valid(root) and ctx.edited_root() == root and root.scene_file_path == plan.scene and history.get_current_action_name() == action and root.get_child_count(true) == 1 and scope.total() == 0
	for index in staged.nodes.size():
		var node: Node = staged.nodes[index]
		var spec: Dictionary = plan.nodes[index]
		var parent: Node = root if index == 0 else staged.by_id[spec.parent_id]
		if not is_instance_valid(node) or node.get_parent() != parent or node.owner != root or node.get_class() != spec.type or String(node.name) != spec.name or str(root.get_path_to(node)) != plan.planned_nodes[index].path:
			confirmed = false
	OS.remove_logger(scope)
	if not confirmed:
		return Protocol.err(Protocol.TREE_BUILD_STATE_UNCERTAIN, "Native commit finished but its complete subtree could not be confirmed.", "Inspect scene_tree and native history before retrying; applied=null and created_count=null.")
	return Protocol.ok(_reply(plan, true, action))

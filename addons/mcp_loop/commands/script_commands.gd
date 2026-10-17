@tool
extends RefCounted
## script.read, script.write, script.edit, script.attach

const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")
const PathGuard = preload("res://addons/mcp_loop/util/path_guard.gd")
const TextDiff = preload("res://addons/mcp_loop/util/text_diff.gd")
const TextEdits = preload("res://addons/mcp_loop/util/text_edits.gd")

const MAX_BYTES := 1024 * 1024
const MAX_DIFF_LINES := 300

var ctx: RefCounted
var _class_name_re := RegEx.create_from_string("(?m)^(\\s*)class_name\\s+([A-Za-z_][A-Za-z0-9_]*)")
# "@tool" as an annotation (not inside a comment or string on the same line).
var _tool_re := RegEx.create_from_string("(?m)^[ \\t]*(@tool)\\b")

const TOOL_WARNING := "This is a @tool script: once it is used in an open scene, attached, or instantiated by the editor, its code runs inside the Godot editor with your user's permissions. It was compiled with @tool disabled for validation."


func _init(context: RefCounted) -> void:
	ctx = context


func register(router: RefCounted) -> void:
	router.register("script.read", _read)
	router.register("script.write", _write)
	router.register("script.edit", _edit)
	router.register("script.attach", _attach)


func _read(p: Dictionary) -> Dictionary:
	var path := PathGuard.normalize(String(p.get("path", "")))
	var reason := PathGuard.check_read(path)
	if reason != "":
		return Protocol.err(Protocol.PATH_FORBIDDEN, reason)
	if not FileAccess.file_exists(path):
		return Protocol.err(Protocol.FILE_NOT_FOUND, "File not found: %s" % path)
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return Protocol.err(Protocol.INTERNAL, "Could not open %s." % path)
	if f.get_length() > MAX_BYTES:
		return Protocol.err(Protocol.INVALID_PARAMS, "%s is larger than 1 MB." % path)
	var content := f.get_as_text()
	return Protocol.ok({"path": path, "content": content, "lines": content.count("\n") + (0 if content.ends_with("\n") or content == "" else 1)})


func _write(p: Dictionary) -> Dictionary:
	var path := PathGuard.normalize(String(p.get("path", "")))
	var reason := PathGuard.check_write(path, ["gd"])
	if reason != "":
		return Protocol.err(Protocol.PATH_FORBIDDEN, reason)
	var content: Variant = p.get("content")
	if typeof(content) != TYPE_STRING:
		return Protocol.err(Protocol.INVALID_PARAMS, "'content' must be a string.")
	return _apply_write(path, content, p.get("dry_run", false), "script_write")


func _edit(p: Dictionary) -> Dictionary:
	var path := PathGuard.normalize(String(p.get("path", "")))
	var reason := PathGuard.check_write(path, ["gd"])
	if reason != "":
		return Protocol.err(Protocol.PATH_FORBIDDEN, reason)
	if not FileAccess.file_exists(path):
		return Protocol.err(Protocol.FILE_NOT_FOUND, "File not found: %s" % path, "Create new scripts with script_write.")
	var current := FileAccess.get_file_as_string(path)
	var edited := TextEdits.apply(current, p.get("edits"))
	if not edited.ok:
		return Protocol.err(Protocol.INVALID_PARAMS, edited.error, edited.get("hint", "Nothing was written."))
	var result := _apply_write(path, edited.content, p.get("dry_run", false), "script_edit")
	if result.get("ok", false):
		result.result["replacements"] = edited.replacements
	return result


## Shared by script_write and script_edit: size check, compile check, diff, undoable write.
func _apply_write(path: String, content: String, dry_run: bool, tool: String) -> Dictionary:
	if content.to_utf8_buffer().size() > MAX_BYTES:
		return Protocol.err(Protocol.INVALID_PARAMS, "Content is larger than 1 MB.")

	var errors := _validate(path, content)
	if not errors.is_empty():
		var lines: Array = errors.map(func(e: Dictionary) -> String: return "line %d: %s" % [e.line, e.message])
		return Protocol.err(Protocol.SCRIPT_PARSE_ERROR, "GDScript does not compile: " + "; ".join(lines),
			"Nothing was written. Fix the code and call %s again." % tool)

	var exists := FileAccess.file_exists(path)
	var old := FileAccess.get_file_as_string(path) if exists else ""
	var result := {"path": path, "created": not exists, "stats": TextDiff.stats(old, content)}
	if exists:
		var diff := TextDiff.unified(old, content, path)
		var diff_lines := diff.split("\n")
		if diff_lines.size() > MAX_DIFF_LINES:
			diff = "\n".join(diff_lines.slice(0, MAX_DIFF_LINES)) + "\n... (%d more diff lines)" % (diff_lines.size() - MAX_DIFF_LINES)
			result["diff_truncated"] = true
		result["diff"] = diff
	else:
		# Echoing a whole new file back as a diff only costs tokens.
		result["summary"] = "created %s (%d lines)" % [path, content.count("\n") + (0 if content.ends_with("\n") or content == "" else 1)]
	if _tool_re.search(content) != null:
		result["warnings"] = [TOOL_WARNING]
	if dry_run:
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


## Compiles `content` in isolation. Returns [{line, message}] (empty = OK).
func _validate(path: String, content: String) -> Array:
	var src := content
	var m := _class_name_re.search(content)
	var own_class := ""
	if m != null:
		own_class = m.get_string(2)
		for g in ProjectSettings.get_global_class_list():
			if String(g["class"]) == own_class and String(g["path"]) != path:
				var line := content.substr(0, m.get_start()).count("\n") + 1
				return [{"line": line, "message": "class_name '%s' is already used by %s" % [own_class, g["path"]]}]
		# A path-less copy would clash with the existing global class of this
		# same file, so blank the declaration (keeping line numbers intact).
		src = content.substr(0, m.get_start(2) - "class_name ".length()) \
			+ " ".repeat("class_name ".length() + own_class.length()) \
			+ content.substr(m.get_end(2))

	# Compiling a @tool script runs its static initializers in the editor.
	# Validate a copy with the annotation blanked (same length keeps columns).
	for tm in _tool_re.search_all(src):
		src = src.substr(0, tm.get_start(1)) + "     " + src.substr(tm.get_end(1))

	var cursor: int = ctx.log_capture.cursor()
	var script := GDScript.new()
	script.source_code = src
	var err := script.reload()
	if err == OK:
		return []
	var out: Array = []
	for e in ctx.log_capture.read(cursor, "error").entries:
		var msg: String = e.message
		msg = msg.trim_prefix("Parse Error: ")
		if own_class != "" and msg.contains("\"%s\"" % own_class):
			continue # reference to the blanked class_name itself
		out.append({"line": int(e.get("line", 0)), "message": msg})
	if out.is_empty() and own_class == "":
		out.append({"line": 0, "message": "Compilation failed (%s)." % error_string(err)})
	return out


func _attach(p: Dictionary) -> Dictionary:
	var root: Node = ctx.edited_root()
	if root == null:
		return ctx.no_scene_error()
	var node_path := String(p.get("node", ""))
	var node: Node = ctx.resolve_node(node_path)
	if node == null:
		return ctx.node_not_found(node_path)
	var script: Script = null
	var script_path: Variant = p.get("script")
	if script_path != null:
		var sp := String(script_path)
		var reason := PathGuard.check_read(sp)
		if reason != "":
			return Protocol.err(Protocol.PATH_FORBIDDEN, reason)
		if not ResourceLoader.exists(sp):
			return Protocol.err(Protocol.FILE_NOT_FOUND, "Script not found: %s" % sp)
		script = load(sp) as Script
		if script == null:
			return Protocol.err(Protocol.INVALID_PARAMS, "%s is not a script." % sp)
		var base := String(script.get_instance_base_type())
		if base != "" and not node.is_class(base):
			return Protocol.err(Protocol.INVALID_PARAMS, "%s extends %s, but node '%s' is a %s." % [sp, base, node.name, node.get_class()])
	var old: Variant = node.get_script()
	if p.get("dry_run", false):
		return Protocol.ok({"dry_run": true, "node": ctx.rel_path(node), "script": script_path})
	ctx.commit("attach script to %s" % node.name, root, func(ur: EditorUndoRedoManager) -> void:
		ur.add_do_property(node, "script", script)
		ur.add_undo_property(node, "script", old))
	return Protocol.ok({"node": ctx.rel_path(node), "script": script_path})

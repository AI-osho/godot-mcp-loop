@tool
extends RefCounted
## node.add, node.delete, node.get, node.set

const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")
const PathGuard = preload("res://addons/mcp_loop/util/path_guard.gd")
const Codec = preload("res://addons/mcp_loop/util/value_codec.gd")
const PropertyPath = preload("res://addons/mcp_loop/util/property_path.gd")
const NodeFactory = preload("res://addons/mcp_loop/commands/node_factory.gd")

const SKIP_USAGE := PROPERTY_USAGE_GROUP | PROPERTY_USAGE_CATEGORY | PROPERTY_USAGE_SUBGROUP

var ctx: RefCounted


func _init(context: RefCounted) -> void:
	ctx = context


func register(router: RefCounted) -> void:
	router.register("node.add", _add)
	router.register("node.delete", _delete)
	router.register("node.get", _get_props)
	router.register("node.set", _set_props)


func _add(p: Dictionary) -> Dictionary:
	var root: Node = ctx.edited_root()
	if root == null:
		return ctx.no_scene_error()
	var parent_path := String(p.get("parent", "."))
	var parent: Node = ctx.resolve_node(parent_path)
	if parent == null:
		return ctx.node_not_found(parent_path)
	var type := String(p.get("type", ""))
	var scene_path := String(p.get("scene", ""))
	if (type == "") == (scene_path == ""):
		return Protocol.err(Protocol.INVALID_PARAMS, "Provide exactly one of 'type' or 'scene'.")

	var node: Node
	if type != "":
		var made: Dictionary = NodeFactory.instantiate(type)
		if not made.ok:
			return Protocol.err(Protocol.INVALID_PARAMS, made.error)
		node = made.node
	else:
		var reason := PathGuard.check_read(scene_path)
		if reason != "":
			return Protocol.err(Protocol.PATH_FORBIDDEN, reason)
		if not ResourceLoader.exists(scene_path):
			return Protocol.err(Protocol.FILE_NOT_FOUND, "Scene not found: %s" % scene_path)
		if scene_path == root.scene_file_path:
			return Protocol.err(Protocol.INVALID_PARAMS, "A scene cannot be instanced inside itself.")
		var packed := load(scene_path) as PackedScene
		if packed == null:
			return Protocol.err(Protocol.INVALID_PARAMS, "%s is not a scene." % scene_path)
		node = packed.instantiate(PackedScene.GEN_EDIT_STATE_INSTANCE)

	var wanted_name := String(p.get("name", ""))
	if wanted_name != "":
		node.name = wanted_name.validate_node_name()

	var props: Dictionary = p.get("properties", {})
	var decoded: Dictionary = ctx.decode_properties(node, props)
	if not decoded.ok:
		node.free()
		return ctx.invalid_properties(decoded.errors)
	var values: Dictionary = ctx.merge_indexed(node, decoded.values)
	for k in values:
		node.set(k, values[k])

	if p.get("dry_run", false):
		var preview := {
			"dry_run": true,
			"would_add": {"parent": ctx.rel_path(parent), "name": String(node.name), "type": node.get_class()},
			"properties": _encode_values(decoded.values),
		}
		node.free()
		return Protocol.ok(preview)

	ctx.commit("add %s" % node.name, root, func(ur: EditorUndoRedoManager) -> void:
		ur.add_do_method(parent, "add_child", node, true)
		ur.add_do_method(node, "set_owner", root)
		ur.add_do_reference(node)
		ur.add_undo_method(parent, "remove_child", node))
	return Protocol.ok({"path": ctx.rel_path(node), "name": String(node.name), "type": node.get_class()})


func _delete(p: Dictionary) -> Dictionary:
	var root: Node = ctx.edited_root()
	if root == null:
		return ctx.no_scene_error()
	var path := String(p.get("path", ""))
	var node: Node = ctx.resolve_node(path)
	if node == null:
		return ctx.node_not_found(path)
	if node == root:
		return Protocol.err(Protocol.INVALID_PARAMS, "The scene root cannot be deleted.", "Delete its children, or create a new scene.")
	var parent := node.get_parent()
	var index := node.get_index()
	# Remember owners so undo restores the subtree exactly as it was.
	var owners: Array = []
	_collect_owners(node, owners)
	var rel: String = ctx.rel_path(node)
	if p.get("dry_run", false):
		return Protocol.ok({"dry_run": true, "would_delete": rel, "nodes_affected": owners.size()})
	ctx.commit("delete %s" % node.name, root, func(ur: EditorUndoRedoManager) -> void:
		ur.add_do_method(parent, "remove_child", node)
		ur.add_undo_method(parent, "add_child", node, false)
		ur.add_undo_method(parent, "move_child", node, index)
		for pair in owners:
			ur.add_undo_method(pair[0], "set_owner", pair[1])
		ur.add_undo_reference(node))
	return Protocol.ok({"deleted": rel, "nodes_affected": owners.size()})


func _collect_owners(n: Node, out: Array) -> void:
	if n.owner != null:
		out.append([n, n.owner])
	for c in n.get_children():
		_collect_owners(c, out)


func _get_props(p: Dictionary) -> Dictionary:
	var path := String(p.get("path", ""))
	if ctx.edited_root() == null:
		return ctx.no_scene_error()
	var node: Node = ctx.resolve_node(path)
	if node == null:
		return ctx.node_not_found(path)
	var out := {}
	var names: Variant = p.get("properties", null)
	if typeof(names) == TYPE_ARRAY and not names.is_empty():
		var missing: Array = []
		for k in names:
			var key := String(k)
			if ctx._find_property(node, key.split(":")[0]).is_empty():
				missing.append(key)
				continue
			var got := PropertyPath.read(node, key)
			if not got.ok:
				return Protocol.err(Protocol.INVALID_PARAMS, got.error)
			out[key] = Codec.encode(got.value)
		if not missing.is_empty():
			return Protocol.err(Protocol.INVALID_PARAMS, "Unknown properties on %s: %s" % [node.get_class(), ", ".join(missing)])
	else:
		var changed_only: bool = p.get("changed_only", true)
		var script: Script = node.get_script()
		for info in node.get_property_list():
			if info.usage & SKIP_USAGE:
				continue
			var is_script_var: bool = info.usage & PROPERTY_USAGE_SCRIPT_VARIABLE
			if not (info.usage & PROPERTY_USAGE_EDITOR) and not is_script_var:
				continue
			var value: Variant = node.get(info.name)
			if changed_only and not is_script_var and info.name != "script":
				if _equals_default(node, info.name, value):
					continue
			out[info.name] = Codec.encode(value)
		if script != null:
			out["script"] = Codec.encode(script)
	return Protocol.ok({"path": ctx.rel_path(node), "type": node.get_class(), "properties": out})


func _equals_default(node: Node, prop: String, value: Variant) -> bool:
	var cls := node.get_class()
	var def: Variant = ClassDB.class_get_property_default_value(cls, prop)
	if def == null and value != null:
		# Unknown default (e.g. script-provided or object-typed): treat nulls as default only.
		return false
	return typeof(def) == typeof(value) and def == value


func _set_props(p: Dictionary) -> Dictionary:
	var root: Node = ctx.edited_root()
	if root == null:
		return ctx.no_scene_error()
	var path := String(p.get("path", ""))
	var node: Node = ctx.resolve_node(path)
	if node == null:
		return ctx.node_not_found(path)
	var props: Variant = p.get("properties", {})
	if typeof(props) != TYPE_DICTIONARY or props.is_empty():
		return Protocol.err(Protocol.INVALID_PARAMS, "'properties' must be a non-empty object.")
	var decoded: Dictionary = ctx.decode_properties(node, props)
	if not decoded.ok:
		return ctx.invalid_properties(decoded.errors)
	var new_values: Dictionary = ctx.merge_indexed(node, decoded.values)
	var changes := {}
	for k in decoded.values:
		changes[k] = {"before": Codec.encode(node.get_indexed(NodePath(k))), "after": Codec.encode(decoded.values[k])}
	if p.get("dry_run", false):
		return Protocol.ok({"dry_run": true, "path": ctx.rel_path(node), "changes": changes})
	var old_values := {}
	for base in new_values:
		old_values[base] = node.get(base)
	ctx.commit("set %s on %s" % [", ".join(decoded.values.keys()), node.name], root, func(ur: EditorUndoRedoManager) -> void:
		for base in new_values:
			ur.add_do_property(node, base, new_values[base])
			ur.add_undo_property(node, base, old_values[base]))
	# Report actual values after the engine applied them (setters may clamp).
	for k in changes:
		changes[k]["after"] = Codec.encode(node.get_indexed(NodePath(k)))
	return Protocol.ok({"path": ctx.rel_path(node), "changes": changes})


func _encode_values(values: Dictionary) -> Dictionary:
	var out := {}
	for k in values:
		out[k] = Codec.encode(values[k])
	return out

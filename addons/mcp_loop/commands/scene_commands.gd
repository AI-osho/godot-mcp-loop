@tool
extends RefCounted
## scene.open, scene.create, scene.save, scene.tree

const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")
const PathGuard = preload("res://addons/mcp_loop/util/path_guard.gd")
const NodeFactory = preload("res://addons/mcp_loop/commands/node_factory.gd")

var ctx: RefCounted


func _init(context: RefCounted) -> void:
	ctx = context


func register(router: RefCounted) -> void:
	router.register("scene.open", _open)
	router.register("scene.create", _create)
	router.register("scene.save", _save)
	router.register("scene.tree", _tree)


func _open(p: Dictionary) -> Dictionary:
	var path := String(p.get("path", ""))
	var reason := PathGuard.check_read(path)
	if reason != "":
		return Protocol.err(Protocol.PATH_FORBIDDEN, reason)
	if not ["tscn", "scn"].has(path.get_extension()):
		return Protocol.err(Protocol.INVALID_PARAMS, "Not a scene file: %s" % path)
	if not FileAccess.file_exists(path):
		return Protocol.err(Protocol.FILE_NOT_FOUND, "Scene not found: %s" % path, "Use project_info with glob '*.tscn' to list scenes.")
	EditorInterface.open_scene_from_path(path)
	var root: Node = ctx.edited_root()
	if root == null or root.scene_file_path != path:
		return Protocol.err(Protocol.INTERNAL, "The editor did not open %s." % path)
	return Protocol.ok({"path": path, "root": String(root.name), "type": root.get_class()})


func _create(p: Dictionary) -> Dictionary:
	var path := PathGuard.normalize(String(p.get("path", "")))
	var reason := PathGuard.check_write(path, ["tscn"])
	if reason != "":
		return Protocol.err(Protocol.PATH_FORBIDDEN, reason)
	if FileAccess.file_exists(path):
		return Protocol.err(Protocol.ALREADY_EXISTS, "%s already exists." % path, "Open it with scene_open, or choose another path.")
	var type := String(p.get("root_type", ""))
	var made: Dictionary = NodeFactory.instantiate(type)
	if not made.ok:
		return Protocol.err(Protocol.INVALID_PARAMS, made.error)
	var root: Node = made.node
	var root_name := String(p.get("root_name", ""))
	if root_name == "":
		root_name = path.get_file().get_basename().to_pascal_case()
	root.name = root_name.validate_node_name()
	if p.get("dry_run", false):
		var preview := {"dry_run": true, "would_create": path, "root": String(root.name), "type": type}
		root.free()
		return Protocol.ok(preview)
	var packed := PackedScene.new()
	var pack_err := packed.pack(root)
	root.free()
	if pack_err != OK:
		return Protocol.err(Protocol.INTERNAL, "Could not pack scene: %s" % error_string(pack_err))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(path.get_base_dir()))
	var save_err := ResourceSaver.save(packed, path)
	if save_err != OK:
		return Protocol.err(Protocol.INTERNAL, "Could not save %s: %s" % [path, error_string(save_err)])
	EditorInterface.get_resource_filesystem().update_file(path)
	EditorInterface.open_scene_from_path(path)
	return Protocol.ok({"path": path, "root": root_name.validate_node_name(), "type": type})


func _save(_p: Dictionary) -> Dictionary:
	var root: Node = ctx.edited_root()
	if root == null:
		return ctx.no_scene_error()
	if root.scene_file_path == "":
		return Protocol.err(Protocol.INVALID_PARAMS, "The edited scene has never been saved and has no path.")
	var err := EditorInterface.save_scene()
	if err != OK:
		return Protocol.err(Protocol.INTERNAL, "Saving failed: %s" % error_string(err))
	return Protocol.ok({"path": root.scene_file_path})


func _tree(p: Dictionary) -> Dictionary:
	var root: Node = ctx.edited_root()
	if root == null:
		return ctx.no_scene_error()
	var start_path := String(p.get("path", "."))
	var start: Node = ctx.resolve_node(start_path)
	if start == null:
		return ctx.node_not_found(start_path)
	return Protocol.ok(_describe(start, root, 0, int(p.get("depth", 10))))


func _describe(n: Node, root: Node, depth: int, max_depth: int) -> Dictionary:
	var d := {"name": String(n.name), "type": n.get_class(), "path": ctx.rel_path(n)}
	var s: Script = n.get_script()
	if s != null:
		d["script"] = s.resource_path
		if s.get_global_name() != &"":
			d["class"] = String(s.get_global_name())
	if n != root and n.scene_file_path != "":
		d["scene"] = n.scene_file_path
	var kids: Array = []
	for c in n.get_children():
		# Only nodes that belong to the edited scene (what the Scene dock shows).
		if c.owner == root or (c.owner != null and root.is_editable_instance(c.owner)):
			kids.append(c)
	if kids.is_empty():
		return d
	if depth >= max_depth:
		d["child_count"] = kids.size()
		return d
	d["children"] = kids.map(func(c: Node) -> Dictionary: return _describe(c, root, depth + 1, max_depth))
	return d

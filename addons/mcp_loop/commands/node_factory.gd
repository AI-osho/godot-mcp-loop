@tool
extends RefCounted
## Creates nodes from engine class names or project global script classes (class_name).

## Returns {ok, node, error}.
static func instantiate(type: String) -> Dictionary:
	if type == "":
		return {"ok": false, "node": null, "error": "A node type is required (e.g. 'Node2D')."}
	if ClassDB.class_exists(type):
		if not ClassDB.is_parent_class(type, "Node"):
			return {"ok": false, "node": null, "error": "'%s' is not a Node class." % type}
		if not ClassDB.can_instantiate(type):
			return {"ok": false, "node": null, "error": "'%s' is abstract and cannot be instantiated." % type}
		return {"ok": true, "node": ClassDB.instantiate(type), "error": ""}
	for g in ProjectSettings.get_global_class_list():
		if String(g["class"]) == type:
			var script: Script = load(g["path"])
			if script == null or not script.can_instantiate():
				return {"ok": false, "node": null, "error": "Script class '%s' cannot be instantiated." % type}
			var obj: Object = script.new()
			if not obj is Node:
				if not obj is RefCounted:
					obj.free()
				return {"ok": false, "node": null, "error": "'%s' is not a Node class." % type}
			return {"ok": true, "node": obj, "error": ""}
	return {"ok": false, "node": null, "error": "Unknown class '%s'." % type}

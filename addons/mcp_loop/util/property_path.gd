extends RefCounted
## Reads "property:sub:sub" paths from an object, like Godot's get_indexed but
## also through arrays (numeric index, negative from the end), dictionaries
## (string or int keys) and objects, with errors that say what went wrong.
## Built-in types (vectors, colors, rects, transforms) use their member names.

const MEMBERS := {
	TYPE_VECTOR2: ["x", "y"], TYPE_VECTOR2I: ["x", "y"],
	TYPE_VECTOR3: ["x", "y", "z"], TYPE_VECTOR3I: ["x", "y", "z"],
	TYPE_VECTOR4: ["x", "y", "z", "w"], TYPE_VECTOR4I: ["x", "y", "z", "w"],
	TYPE_COLOR: ["r", "g", "b", "a", "h", "s", "v", "r8", "g8", "b8", "a8"],
	TYPE_RECT2: ["position", "size", "end"], TYPE_RECT2I: ["position", "size", "end"],
	TYPE_TRANSFORM2D: ["x", "y", "origin"],
	TYPE_QUATERNION: ["x", "y", "z", "w"],
	TYPE_BASIS: ["x", "y", "z"],
	TYPE_TRANSFORM3D: ["basis", "origin"],
	TYPE_PLANE: ["normal", "d", "x", "y", "z"],
	TYPE_AABB: ["position", "size", "end"],
}
const INDEXABLE := [TYPE_ARRAY, TYPE_PACKED_BYTE_ARRAY, TYPE_PACKED_INT32_ARRAY, TYPE_PACKED_INT64_ARRAY,
	TYPE_PACKED_FLOAT32_ARRAY, TYPE_PACKED_FLOAT64_ARRAY, TYPE_PACKED_STRING_ARRAY, TYPE_PACKED_VECTOR2_ARRAY,
	TYPE_PACKED_VECTOR3_ARRAY, TYPE_PACKED_COLOR_ARRAY, TYPE_PACKED_VECTOR4_ARRAY]


static func _has_property(obj: Object, name: String) -> bool:
	for info in obj.get_property_list():
		if info.name == name:
			return true
	return false


## True when the first segment names an existing property (typos fail fast).
static func has_head(obj: Object, path: String) -> bool:
	return _has_property(obj, path.split(":")[0])


static func read(obj: Object, path: String) -> Dictionary:
	var parts := path.split(":")
	var head := parts[0]
	if not _has_property(obj, head):
		return {"ok": false, "error": "%s has no property '%s'." % [obj.get_class(), head]}
	var value: Variant = obj.get(head)
	var walked := head
	for i in range(1, parts.size()):
		var step := _step(value, parts[i], walked)
		if not step.ok:
			return step
		value = step.value
		walked += ":" + parts[i]
	return {"ok": true, "value": value}


static func _step(value: Variant, key: String, at: String) -> Dictionary:
	var t := typeof(value)
	if INDEXABLE.has(t):
		if not key.is_valid_int():
			return {"ok": false, "error": "%s is an array; index it with a number (e.g. %s:0), not '%s'." % [at, at, key]}
		var size: int = value.size()
		var idx := int(key)
		if idx < 0:
			idx += size
		if idx < 0 or idx >= size:
			return {"ok": false, "error": "Index %s is out of range for %s (size %d)." % [key, at, size]}
		return {"ok": true, "value": value[idx]}
	if t == TYPE_DICTIONARY:
		if value.has(key):
			return {"ok": true, "value": value[key]}
		if key.is_valid_int() and value.has(int(key)):
			return {"ok": true, "value": value[int(key)]}
		var keys: Array = value.keys().slice(0, 10).map(func(k: Variant) -> String: return str(k))
		return {"ok": false, "error": "Key '%s' not found in %s (keys: %s)." % [key, at, ", ".join(keys)]}
	if t == TYPE_OBJECT:
		if value == null or not is_instance_valid(value):
			return {"ok": false, "error": "%s is null, so '%s' can't be read." % [at, key]}
		if not _has_property(value, key):
			return {"ok": false, "error": "%s (%s) has no property '%s'." % [at, value.get_class(), key]}
		return {"ok": true, "value": value.get(key)}
	if t == TYPE_NIL:
		return {"ok": false, "error": "%s is null, so '%s' can't be read." % [at, key]}
	if MEMBERS.has(t):
		if not MEMBERS[t].has(key):
			return {"ok": false, "error": "%s (%s) has no member '%s' (members: %s)." % [at, type_string(t), key, ", ".join(MEMBERS[t])]}
		return {"ok": true, "value": value[key]}
	return {"ok": false, "error": "%s is a %s and has no members, so '%s' can't be read." % [at, type_string(t), key]}

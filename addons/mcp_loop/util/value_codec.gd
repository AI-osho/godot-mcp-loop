@tool
extends RefCounted
## JSON <-> Variant conversion in one place.
## decode(): JSON value -> Variant of the property's declared type.
## encode(): any Variant -> JSON-safe value.

const PathGuard = preload("res://addons/mcp_loop/util/path_guard.gd")

const MAX_ARRAY_ITEMS := 64
const MAX_DEPTH := 8


static func _ok(v: Variant) -> Dictionary:
	return {"ok": true, "value": v, "error": ""}


static func _fail(msg: String) -> Dictionary:
	return {"ok": false, "value": null, "error": msg}


static func _is_num(v: Variant) -> bool:
	return typeof(v) == TYPE_INT or typeof(v) == TYPE_FLOAT


static func _components(v: Variant, keys: Array, type_name: String) -> Dictionary:
	var out: Array = []
	if typeof(v) == TYPE_ARRAY:
		if v.size() != keys.size():
			return _fail("%s expects %d numbers, got %d." % [type_name, keys.size(), v.size()])
		out = v
	elif typeof(v) == TYPE_DICTIONARY:
		for k in keys:
			if not v.has(k):
				return _fail("%s expects keys %s." % [type_name, str(keys)])
			out.append(v[k])
	else:
		return _fail("%s expects an array %s or an object." % [type_name, str(keys)])
	for c in out:
		if not _is_num(c):
			return _fail("%s components must be numbers." % type_name)
	return _ok(out)


## Targets for which a string value is taken literally.
const STRING_TARGETS := [TYPE_NIL, TYPE_STRING, TYPE_STRING_NAME, TYPE_NODE_PATH]


static func decode(v: Variant, target_type: int, depth: int = 0) -> Dictionary:
	if depth > MAX_DEPTH:
		return _fail("Value is nested too deeply.")
	# Some MCP clients send untyped values as strings ("120", "[10, 20]").
	if typeof(v) == TYPE_STRING and not STRING_TARGETS.has(target_type):
		if target_type == TYPE_COLOR:
			var direct := _decode_color(v)
			if direct.ok:
				return direct
		var json := JSON.new()
		if json.parse(v) == OK and typeof(json.data) != TYPE_STRING:
			return decode(json.data, target_type, depth + 1)
	match target_type:
		TYPE_NIL:
			return _ok(v)
		TYPE_BOOL:
			return _ok(v) if typeof(v) == TYPE_BOOL else _fail("Expected true/false.")
		TYPE_INT:
			if _is_num(v) and float(v) == floor(float(v)):
				return _ok(int(v))
			return _fail("Expected an integer.")
		TYPE_FLOAT:
			return _ok(float(v)) if _is_num(v) else _fail("Expected a number.")
		TYPE_STRING:
			return _ok(v) if typeof(v) == TYPE_STRING else _fail("Expected a string.")
		TYPE_STRING_NAME:
			return _ok(StringName(v)) if typeof(v) == TYPE_STRING else _fail("Expected a string.")
		TYPE_NODE_PATH:
			return _ok(NodePath(v)) if typeof(v) == TYPE_STRING else _fail("Expected a node path string.")
		TYPE_VECTOR2, TYPE_VECTOR2I:
			var c := _components(v, ["x", "y"], type_string(target_type))
			if not c.ok:
				return c
			return _ok(Vector2(c.value[0], c.value[1]) if target_type == TYPE_VECTOR2 else Vector2i(int(c.value[0]), int(c.value[1])))
		TYPE_VECTOR3, TYPE_VECTOR3I:
			var c := _components(v, ["x", "y", "z"], type_string(target_type))
			if not c.ok:
				return c
			var a: Array = c.value
			return _ok(Vector3(a[0], a[1], a[2]) if target_type == TYPE_VECTOR3 else Vector3i(int(a[0]), int(a[1]), int(a[2])))
		TYPE_VECTOR4:
			var c := _components(v, ["x", "y", "z", "w"], "Vector4")
			if not c.ok:
				return c
			var a: Array = c.value
			return _ok(Vector4(a[0], a[1], a[2], a[3]))
		TYPE_COLOR:
			return _decode_color(v)
		TYPE_RECT2, TYPE_RECT2I:
			var nums: Array = []
			if typeof(v) == TYPE_ARRAY and v.size() == 4:
				nums = v
			elif typeof(v) == TYPE_DICTIONARY and v.has("position") and v.has("size"):
				var p := _components(v["position"], ["x", "y"], "Rect2.position")
				var s := _components(v["size"], ["x", "y"], "Rect2.size")
				if not p.ok:
					return p
				if not s.ok:
					return s
				nums = p.value + s.value
			else:
				return _fail("Rect2 expects [x, y, w, h] or {position, size}.")
			for n in nums:
				if not _is_num(n):
					return _fail("Rect2 components must be numbers.")
			if target_type == TYPE_RECT2:
				return _ok(Rect2(nums[0], nums[1], nums[2], nums[3]))
			return _ok(Rect2i(int(nums[0]), int(nums[1]), int(nums[2]), int(nums[3])))
		TYPE_OBJECT:
			return _decode_resource(v, depth)
		TYPE_ARRAY:
			return _ok(v) if typeof(v) == TYPE_ARRAY else _fail("Expected an array.")
		TYPE_DICTIONARY:
			return _ok(v) if typeof(v) == TYPE_DICTIONARY else _fail("Expected an object.")
	# Other types: accept if JSON already maps to them, else try str_to_var.
	if typeof(v) == target_type:
		return _ok(v)
	if typeof(v) == TYPE_STRING:
		var parsed: Variant = str_to_var(v)
		if typeof(parsed) == target_type:
			return _ok(parsed)
	return _fail("Cannot convert to %s. Pass a Godot literal string like \"%s(...)\"." % [type_string(target_type), type_string(target_type)])


static func _decode_color(v: Variant) -> Dictionary:
	if typeof(v) == TYPE_STRING:
		var s: String = v
		if s.begins_with("#") and Color.html_is_valid(s):
			return _ok(Color.html(s))
		var named := Color.from_string(s, Color(0, 0, 0, -1))
		if named.a >= 0:
			return _ok(named)
		return _fail("Invalid color '%s'. Use '#rrggbb', '#rrggbbaa', a name like 'red', or [r, g, b, a]." % s)
	if typeof(v) == TYPE_ARRAY and (v.size() == 3 or v.size() == 4):
		for c in v:
			if not _is_num(c):
				return _fail("Color components must be numbers 0..1.")
		return _ok(Color(v[0], v[1], v[2], v[3] if v.size() == 4 else 1.0))
	return _fail("Invalid color. Use '#rrggbb', a name, or [r, g, b(, a)].")


static func _decode_resource(v: Variant, depth: int = 0) -> Dictionary:
	if v == null:
		return _ok(null)
	if typeof(v) == TYPE_DICTIONARY and typeof(v.get("new")) == TYPE_STRING:
		return _decode_new_resource(v, depth)
	if typeof(v) != TYPE_DICTIONARY or typeof(v.get("res")) != TYPE_STRING:
		return _fail("Resources are given as {\"res\": \"res://path\"} for a file, {\"new\": \"ClassName\", \"properties\": {...}} for an embedded resource, or null to clear.")
	var path: String = v["res"]
	var reason := PathGuard.check_read(path)
	if reason != "":
		return _fail(reason)
	if not ResourceLoader.exists(path):
		return _fail("Resource not found: %s" % path)
	var res := load(path)
	if res == null:
		return _fail("Could not load resource: %s" % path)
	return _ok(res)


## {"new": "RectangleShape2D", "properties": {"size": [32, 48]}} -> a new embedded
## resource. Scripts are excluded: code goes through script_write/script_attach.
static func _decode_new_resource(spec: Dictionary, depth: int) -> Dictionary:
	var cls: String = spec["new"]
	if not ClassDB.class_exists(cls):
		return _fail("Unknown resource class: %s" % cls)
	if cls == "Script" or ClassDB.is_parent_class(cls, "Script"):
		return _fail("Scripts can't be created inline; write them with script_write and attach them with script_attach.")
	if not ClassDB.is_parent_class(cls, "Resource"):
		return _fail("%s is not a Resource class." % cls)
	if not ClassDB.can_instantiate(cls):
		return _fail("%s is abstract; use a concrete subclass (e.g. RectangleShape2D for Shape2D)." % cls)
	var props: Variant = spec.get("properties", {})
	if typeof(props) != TYPE_DICTIONARY:
		return _fail("\"properties\" of a new resource must be an object.")
	var res: Resource = ClassDB.instantiate(cls)
	var info := {}
	for p in res.get_property_list():
		if p.usage & (PROPERTY_USAGE_STORAGE | PROPERTY_USAGE_EDITOR):
			info[p.name] = p
	for key in props:
		var prop := str(key)
		if not info.has(prop) or prop == "script" or prop == "resource_path":
			return _fail("%s has no settable property '%s'." % [cls, prop])
		var d := decode(props[key], info[prop].type, depth + 1)
		if not d.ok:
			return _fail("%s.%s: %s" % [cls, prop, d.error])
		if not matches_resource_hint(d.value, info[prop]):
			return _fail("%s.%s expects %s." % [cls, prop, info[prop].hint_string])
		res.set(prop, d.value)
	return _ok(res)


## True unless `value` is a resource that doesn't fit the property's resource type hint.
static func matches_resource_hint(value: Variant, prop: Dictionary) -> bool:
	if not (value is Resource) or prop.get("hint", 0) != PROPERTY_HINT_RESOURCE_TYPE:
		return true
	for t in str(prop.get("hint_string", "")).split(","):
		if t.strip_edges() == "" or value.is_class(t.strip_edges()):
			return true
	return false


## Embedded resource -> {"new": class, "properties": {non-default stored values}}.
static func _encode_embedded(res: Resource, depth: int) -> Dictionary:
	var cls := res.get_class()
	var out := {}
	for p in res.get_property_list():
		if not (p.usage & PROPERTY_USAGE_STORAGE):
			continue
		var prop: String = p.name
		if prop == "script" or prop.begins_with("resource_"):
			continue
		var value: Variant = res.get(prop)
		var default_value: Variant = ClassDB.class_get_property_default_value(cls, prop)
		if typeof(value) == typeof(default_value) and value == default_value:
			continue
		out[prop] = encode(value, depth + 1)
	return {"new": cls, "properties": out}


## Returns a copy of `base` with the value at `subpath` (e.g. ["origin", "y"])
## replaced. Used to turn "position:x" edits into whole-property undo steps.
static func with_indexed(base: Variant, subpath: Array, value: Variant) -> Variant:
	if subpath.is_empty():
		return value
	var key: Variant = subpath[0]
	var copy: Variant = base.duplicate() if (typeof(base) == TYPE_DICTIONARY or typeof(base) == TYPE_ARRAY) else base
	var child: Variant = copy.get(key) if typeof(copy) == TYPE_DICTIONARY else copy[key]
	copy[key] = with_indexed(child, subpath.slice(1), value)
	return copy


static func encode(v: Variant, depth: int = 0) -> Variant:
	if depth > MAX_DEPTH:
		return "<max depth>"
	match typeof(v):
		TYPE_NIL, TYPE_BOOL, TYPE_INT, TYPE_STRING:
			return v
		TYPE_FLOAT:
			if is_nan(v):
				return "nan"
			if is_inf(v):
				return "inf" if v > 0 else "-inf"
			return v
		TYPE_STRING_NAME, TYPE_NODE_PATH:
			return str(v)
		TYPE_VECTOR2, TYPE_VECTOR2I:
			return [v.x, v.y]
		TYPE_VECTOR3, TYPE_VECTOR3I:
			return [v.x, v.y, v.z]
		TYPE_VECTOR4, TYPE_VECTOR4I:
			return [v.x, v.y, v.z, v.w]
		TYPE_COLOR:
			return "#" + v.to_html(true)
		TYPE_RECT2, TYPE_RECT2I:
			return {"position": encode(v.position), "size": encode(v.size)}
		TYPE_OBJECT:
			if v == null or not is_instance_valid(v):
				return null
			if v is Resource:
				var path: String = v.resource_path
				if path == "" or path.contains("::"):
					return _encode_embedded(v, depth)
				return {"res": path, "type": v.get_class()}
			if v is Node:
				var path: String = str(v.get_path()) if v.is_inside_tree() else str(v.name)
				return {"node": path, "type": v.get_class()}
			return {"type": v.get_class()}
		TYPE_ARRAY, TYPE_PACKED_BYTE_ARRAY, TYPE_PACKED_INT32_ARRAY, TYPE_PACKED_INT64_ARRAY, \
		TYPE_PACKED_FLOAT32_ARRAY, TYPE_PACKED_FLOAT64_ARRAY, TYPE_PACKED_STRING_ARRAY, \
		TYPE_PACKED_VECTOR2_ARRAY, TYPE_PACKED_VECTOR3_ARRAY, TYPE_PACKED_COLOR_ARRAY, TYPE_PACKED_VECTOR4_ARRAY:
			var items: Array = []
			var n: int = v.size()
			for i in min(n, MAX_ARRAY_ITEMS):
				items.append(encode(v[i], depth + 1))
			if n > MAX_ARRAY_ITEMS:
				return {"size": n, "items": items, "truncated": true}
			return items
		TYPE_DICTIONARY:
			var out := {}
			for k in v:
				out[str(k)] = encode(v[k], depth + 1)
			return out
	# Transforms, quaternions, planes, AABB, etc.
	return var_to_str(v)

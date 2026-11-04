@tool
extends RefCounted
## Bounded data-only validation for node.add_tree. No node or Resource construction.
const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")
const POLICY_PATH := "res://addons/mcp_loop/commands/tree_build_policy.json"
const POLICY_BYTES := 65536
const LIMIT_CEILINGS := {"nodes": 64, "depth": 8, "properties_per_node": 32, "properties_total": 512, "resources": 64, "resource_depth": 4, "array_items": 64, "string_bytes": 2048, "name_bytes": 64, "path_bytes": 1024, "request_bytes": 131072, "reply_bytes": 131072, "png_references": 16, "png_bytes": 8388608, "png_side": 4096, "png_pixels_total": 16000000}
static var _color_pattern := RegEx.create_from_string("^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$")
static var _property_pattern := RegEx.create_from_string("^[a-z][a-z0-9_/]*$")
static var _id_pattern := RegEx.create_from_string("^[a-z][a-z0-9_]{0,31}$")
const NODE_TYPES := ["Node", "Node2D", "CharacterBody2D", "StaticBody2D", "Area2D", "Sprite2D", "CollisionShape2D", "Camera2D", "CanvasLayer", "Control", "ColorRect", "Label", "Button", "PanelContainer", "MarginContainer", "VBoxContainer", "HBoxContainer", "CenterContainer", "GridContainer"]
const RESOURCE_TYPES := ["RectangleShape2D", "CircleShape2D", "CapsuleShape2D", "StyleBoxFlat"]

static func _error(message: String = "Invalid tree request.") -> Dictionary:
	return Protocol.err(Protocol.INVALID_TREE_PLAN, message)

static func _space(code: int) -> bool:
	return code in [9, 10, 11, 12, 13, 32, 160, 5760, 8232, 8233, 8239, 8287, 12288, 65279] or (code >= 8192 and code <= 8202)

static func literal_name(value: String, max_bytes: int) -> bool:
	if value.is_empty() or value.to_utf8_buffer().size() > max_bytes or _space(value.unicode_at(0)) or _space(value.unicode_at(value.length() - 1)):
		return false
	if value.validate_node_name() != value or value.contains("\\"):
		return false
	for index in value.length():
		var code := value.unicode_at(index)
		if code < 32 or code == 127:
			return false
	return true

static func literal_path(value: String, extension: String, max_bytes: int) -> bool:
	if not value.begins_with("res://") or value.get_extension().to_lower() != extension or value.to_utf8_buffer().size() > max_bytes:
		return false
	var body := value.substr(6)
	if body.is_empty() or body.contains("\\") or body.contains(":") or _space(body.unicode_at(0)) or _space(body.unicode_at(body.length() - 1)):
		return false
	for part in body.split("/"):
		if part.is_empty() or part in [".", ".."]:
			return false
	for index in body.length():
		if body.unicode_at(index) < 32 or body.unicode_at(index) == 127:
			return false
	return true

static func _keys(data: Dictionary, allowed: Array) -> bool:
	for key in data:
		if typeof(key) != TYPE_STRING or not allowed.has(key):
			return false
	return true

static func load_policy() -> Dictionary:
	var file := FileAccess.open(POLICY_PATH, FileAccess.READ)
	if file == null:
		return Protocol.err(Protocol.TREE_POLICY_INVALID, "The bundled tree policy is missing or invalid.")
	var length := file.get_length()
	if length <= 0 or length > POLICY_BYTES:
		file.close()
		return Protocol.err(Protocol.TREE_POLICY_INVALID, "The bundled tree policy is missing or invalid.")
	var bytes := file.get_buffer(length)
	file.close()
	var text := bytes.get_string_from_utf8()
	if bytes.size() != length or text.to_utf8_buffer() != bytes:
		return Protocol.err(Protocol.TREE_POLICY_INVALID, "The bundled tree policy is missing or invalid.")
	return decode_policy_text(text)

static func _unique_policy_keys(text: String) -> bool:
	var objects: Array = []
	var index := 0
	while index < text.length():
		var character := text[index]
		if character == "{":
			objects.append({})
		elif character == "}":
			objects.pop_back()
		elif character == "\"":
			var start := index
			index += 1
			while index < text.length():
				if text[index] == "\\":
					index += 2
					continue
				if text[index] == "\"":
					break
				index += 1
			var next := index + 1
			while next < text.length() and text[next] in [" ", "\t", "\r", "\n"]:
				next += 1
			if next < text.length() and text[next] == ":":
				var key_parser := JSON.new()
				if key_parser.parse(text.substr(start, index - start + 1)) != OK or typeof(key_parser.data) != TYPE_STRING or objects.is_empty():
					return false
				var key: String = key_parser.data
				if key in ["__proto__", "constructor", "prototype"] or objects.back().has(key):
					return false
				objects.back()[key] = true
		index += 1
	return true

static func decode_policy_text(text: String) -> Dictionary:
	var parser := JSON.new()
	if text.to_utf8_buffer().size() > POLICY_BYTES or parser.parse(text) != OK or typeof(parser.data) != TYPE_DICTIONARY or not _policy_valid(parser.data) or not _unique_policy_keys(text):
		return Protocol.err(Protocol.TREE_POLICY_INVALID, "The bundled tree policy is missing or invalid.")
	return Protocol.ok(parser.data)

static func _number(value: Variant) -> bool:
	return (typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT) and is_finite(value)

static func _numeric_value(value: Variant, rule: Dictionary) -> bool:
	if not _number(value):
		return false
	if value > rule.max or value < rule.min or (rule.get("exclusive_min", false) and value == rule.min) or (rule.get("nonzero", false) and value == 0):
		return false
	return rule.kind != "int" or value == floor(value)

static func _invalid_value(field: String) -> Dictionary:
	return Protocol.err(Protocol.TREE_BUILD_VALIDATION_FAILED, field + " has an invalid value for its allowed property.")

static func _validate_value(value: Variant, rule: Dictionary, field: String, policy: Dictionary) -> Dictionary:
	if rule.get("kind") in ["resource", "texture"] and value == null:
		return Protocol.ok() if rule.get("nullable", false) else _invalid_value(field)
	if rule.get("kind") == "resource":
		if typeof(value) != TYPE_DICTIONARY or typeof(value.get("new")) != TYPE_STRING or not _keys(value, ["new", "properties"]):
			return Protocol.err(Protocol.UNSUPPORTED_PROPERTY, field + " must use an allowed embedded Resource.")
		if not RESOURCE_TYPES.has(value.new) or not rule.classes.has(value.new):
			return Protocol.err(Protocol.UNSUPPORTED_PROPERTY, field + " has an unsupported Resource class.")
		if typeof(value.get("properties", {})) != TYPE_DICTIONARY:
			return _invalid_value(field + ".properties")
		var properties: Dictionary = value.get("properties", {})
		var rules: Dictionary = policy.resources[value.new]
		for key in properties:
			if typeof(key) != TYPE_STRING or not rules.has(key):
				return Protocol.err(Protocol.UNSUPPORTED_PROPERTY, field + ".properties contains an unsupported Resource property.")
			var checked := _validate_value(properties[key], rules[key], field + ".properties." + key, policy)
			if not checked.ok:
				return checked
		if value.new == "CapsuleShape2D":
			var radius: Variant = properties.get("radius", policy.capsule_defaults.radius)
			var height: Variant = properties.get("height", policy.capsule_defaults.height)
			if not _number(radius) or not _number(height) or height < 2 * radius:
				return _invalid_value(field + ".properties.height")
	if rule.get("kind") == "texture":
		if typeof(value) != TYPE_DICTIONARY or not _keys(value, ["res"]) or typeof(value.get("res")) != TYPE_STRING or not literal_path(value.res, "png", int(policy.limits.path_bytes)):
			return Protocol.err(Protocol.RESOURCE_NOT_READY, field + " must reference a literal project-local PNG.")
	if rule.get("kind") in ["number", "int"] and not _numeric_value(value, rule):
		return _invalid_value(field)
	if rule.get("kind") == "vector2":
		if typeof(value) != TYPE_ARRAY or value.size() != 2:
			return _invalid_value(field)
		for component in value:
			if not _numeric_value(component, rule):
				return _invalid_value(field)
	if rule.get("kind") == "enum":
		if not _number(value) or value != floor(value):
			return _invalid_value(field)
		var found := false
		for option in rule.values:
			if value == option:
				found = true
		if not found:
			return _invalid_value(field)
	if rule.get("kind") == "color":
		if typeof(value) == TYPE_STRING:
			if _color_pattern.search(value) == null:
				return _invalid_value(field)
		elif typeof(value) == TYPE_ARRAY and value.size() in [3, 4]:
			for component in value:
				if not _number(component) or component < 0 or component > 1:
					return _invalid_value(field)
		else:
			return _invalid_value(field)
	if rule.get("kind") == "text" and (typeof(value) != TYPE_STRING or value.to_utf8_buffer().size() > policy.limits.string_bytes):
		return _invalid_value(field)
	if rule.get("kind") == "bool" and typeof(value) != TYPE_BOOL:
		return _invalid_value(field)
	return Protocol.ok()

static func _json_budget(input: Dictionary, policy: Dictionary) -> Dictionary:
	var stack: Array = [{"value": input, "rd": 0, "depth": 0}]
	var properties := 0
	var resources := 0
	var visits := 0
	var references := {}
	while not stack.is_empty():
		var entry: Dictionary = stack.pop_back()
		visits += 1
		if entry.depth > 6 + 2 * policy.limits.resource_depth:
			return _error("request exceeds its bounded JSON nesting limit.")
		if visits > policy.limits.request_bytes:
			return _error("request exceeds its data budget.")
		var value: Variant = entry.value
		if typeof(value) == TYPE_STRING and value.to_utf8_buffer().size() > policy.limits.string_bytes:
			return _error("request exceeds its string byte budget.")
		if typeof(value) == TYPE_ARRAY:
			if value.size() > policy.limits.array_items:
				return _error("request exceeds its array count limit.")
			for child in value:
				stack.append({"value": child, "rd": entry.rd, "depth": entry.depth + 1})
		elif typeof(value) == TYPE_DICTIONARY:
			for key in value:
				if typeof(key) != TYPE_STRING or key in ["__proto__", "constructor", "prototype"]:
					return _error("request contains a forbidden object key.")
			if typeof(value.get("res")) == TYPE_STRING:
				references[value.res] = true
			if references.size() > policy.limits.png_references:
				return _error("request exceeds its distinct PNG reference count limit.")
			var resource_depth: int = int(entry.rd) + (1 if value.has("new") else 0)
			if value.has("new"):
				resources += 1
			if resource_depth > policy.limits.resource_depth:
				return _error("request exceeds its Resource nesting limit.")
			if resources > policy.limits.resources:
				return _error("request exceeds its Resource count limit.")
			if typeof(value.get("properties")) == TYPE_DICTIONARY:
				properties += value.properties.size()
			if properties > policy.limits.properties_total:
				return _error("request exceeds its total property count limit.")
			for child in value.values():
				stack.append({"value": child, "rd": resource_depth, "depth": entry.depth + 1})
	if JSON.stringify(input).to_utf8_buffer().size() > policy.limits.request_bytes:
		return _error("request exceeds its serialized UTF-8 byte budget.")
	return Protocol.ok()

static func _rule_valid(rule: Dictionary) -> bool:
	var kind: Variant = rule.get("kind")
	if typeof(kind) != TYPE_STRING:
		return false
	if kind in ["bool", "text", "color"]:
		return _keys(rule, ["kind"]) and rule.size() == 1
	if kind in ["number", "int", "vector2"]:
		if not _keys(rule, ["kind", "min", "max", "exclusive_min", "nonzero"]) or not _number(rule.get("min")) or not _number(rule.get("max")):
			return false
		if typeof(rule.get("exclusive_min", false)) != TYPE_BOOL or typeof(rule.get("nonzero", false)) != TYPE_BOOL:
			return false
		return rule.min <= rule.max and not (rule.get("exclusive_min", false) and rule.min == rule.max) and not (rule.get("nonzero", false) and rule.min == 0 and rule.max == 0)
	if kind == "enum":
		if not _keys(rule, ["kind", "values"]) or typeof(rule.get("values")) != TYPE_ARRAY or rule.values.is_empty() or rule.values.size() > 32:
			return false
		var seen: Array = []
		for value in rule.values:
			if not _number(value) or value != floor(value):
				return false
			for previous in seen:
				if previous == value:
					return false
			seen.append(value)
		return true
	if kind == "texture":
		return _keys(rule, ["kind", "nullable"]) and rule.size() == 2 and typeof(rule.get("nullable")) == TYPE_BOOL
	if kind == "resource":
		if not _keys(rule, ["kind", "classes", "nullable"]) or rule.size() != 3 or typeof(rule.get("nullable")) != TYPE_BOOL or typeof(rule.get("classes")) != TYPE_ARRAY or rule.classes.is_empty() or rule.classes.size() > 4:
			return false
		var seen: Array = []
		for cls in rule.classes:
			if typeof(cls) != TYPE_STRING or not RESOURCE_TYPES.has(cls) or seen.has(cls):
				return false
			seen.append(cls)
		return true
	return false

static func _policy_valid(policy: Dictionary) -> bool:
	if not _keys(policy, ["schema_version", "limits", "nodes", "resources", "capsule_defaults"]) or policy.size() != 5 or not _number(policy.get("schema_version")) or policy.schema_version != 1:
		return false
	for key in ["limits", "nodes", "resources", "capsule_defaults"]:
		if typeof(policy.get(key)) != TYPE_DICTIONARY:
			return false
	if not _keys(policy.limits, LIMIT_CEILINGS.keys()) or policy.limits.size() != LIMIT_CEILINGS.size():
		return false
	for key in LIMIT_CEILINGS:
		var limit: Variant = policy.limits.get(key)
		if not _number(limit) or limit != floor(limit) or limit <= 0 or limit > LIMIT_CEILINGS[key]:
			return false
	if not _keys(policy.nodes, NODE_TYPES) or policy.nodes.size() != NODE_TYPES.size() or not _keys(policy.resources, RESOURCE_TYPES) or policy.resources.size() != RESOURCE_TYPES.size():
		return false
	for table in [policy.nodes, policy.resources]:
		for cls in table:
			if typeof(table[cls]) != TYPE_DICTIONARY:
				return false
			for key in table[cls]:
				if typeof(key) != TYPE_STRING or _property_pattern.search(key) == null or key in ["name", "owner", "script", "scene_file_path", "resource_path", "metadata"] or key.begins_with("metadata/") or typeof(table[cls][key]) != TYPE_DICTIONARY or not _rule_valid(table[cls][key]):
					return false
	var defaults: Dictionary = policy.capsule_defaults
	if not _keys(defaults, ["radius", "height"]) or defaults.size() != 2 or not _number(defaults.get("radius")) or not _number(defaults.get("height")) or defaults.radius <= 0 or defaults.height < 2 * defaults.radius:
		return false
	return true

static func validate_request(input: Dictionary, policy: Dictionary) -> Dictionary:
	if not _policy_valid(policy):
		return Protocol.err(Protocol.TREE_POLICY_INVALID, "The bundled tree policy is missing or invalid.")
	if not _keys(input, ["schema_version", "scene", "nodes", "dry_run"]):
		return _error("request contains unknown fields.")
	var version: Variant = input.get("schema_version")
	if (typeof(version) != TYPE_INT and typeof(version) != TYPE_FLOAT) or not is_finite(version) or version != 1:
		return _error("schema_version must be one.")
	if typeof(input.get("scene")) != TYPE_STRING or typeof(input.get("nodes")) != TYPE_ARRAY or typeof(input.get("dry_run", false)) != TYPE_BOOL:
		return _error("request fields have invalid types.")
	var budget := _json_budget(input, policy)
	if not budget.ok:
		return budget
	if not literal_path(input.scene, "tscn", int(policy.limits.path_bytes)):
		return _error("scene must be a bounded literal res:// .tscn path.")
	if input.nodes.is_empty() or input.nodes.size() > policy.limits.nodes:
		return _error("nodes exceed the one-to-64 computation limit.")
	var paths := {}
	var sibling_names := {}
	var depths := {}
	var png_paths := {}
	var nodes: Array = []
	var planned: Array = []
	for value in input.nodes:
		if typeof(value) != TYPE_DICTIONARY:
			return _error("nodes entries must be objects.")
		if not _keys(value, ["id", "parent_id", "type", "name", "properties"]):
			return _error("nodes entries contain unknown fields.")
		var node: Dictionary = value.duplicate(true)
		for key in ["id", "type", "name"]:
			if typeof(node.get(key)) != TYPE_STRING:
				return _error("nodes entries require literal id, type and name strings.")
		if not literal_name(node.name, int(policy.limits.name_bytes)):
			return _error("nodes.name must be a bounded literal node name.")
		if _id_pattern.search(node.id) == null:
			return _error("nodes.id must match the literal identifier grammar.")
		if not NODE_TYPES.has(node.type):
			return Protocol.err(Protocol.UNSUPPORTED_NODE_TYPE, "nodes.type is not an allowed native class.")
		if nodes.is_empty() and node.type not in ["Node2D", "Control"]:
			return Protocol.err(Protocol.UNSUPPORTED_NODE_TYPE, "The new top node must be Node2D or Control.")
		if node.has("parent_id") and typeof(node.parent_id) != TYPE_STRING:
			return _error("parent_id must be a literal string.")
		if typeof(node.get("properties", {})) != TYPE_DICTIONARY:
			return _error("properties must be objects.")
		node["properties"] = node.get("properties", {})
		if node.properties.size() > policy.limits.properties_per_node:
			return _error("nodes exceed the per-node property count limit.")
		if not nodes.is_empty() and not node.has("parent_id"):
			return _error("Every node after the top needs parent_id.")
		if paths.has(node.id):
			return _error("nodes.id must be unique.")
		var rules: Dictionary = policy.nodes[node.type]
		for key in node.properties:
			if typeof(key) != TYPE_STRING or not rules.has(key):
				return Protocol.err(Protocol.UNSUPPORTED_PROPERTY, "nodes.properties contains an unsupported property.")
			var checked := _validate_value(node.properties[key], rules[key], "nodes[%d].properties.%s" % [nodes.size(), key], policy)
			if not checked.ok:
				return checked
			if rules[key].kind == "texture" and node.properties[key] != null:
				png_paths[node.properties[key].res] = true
		var path: String = node.name
		if node.has("parent_id"):
			if not paths.has(node.parent_id):
				return _error("parent_id must refer to an earlier node.")
			path = String(paths[node.parent_id]).path_join(node.name)
		var depth: int = int(depths[node.parent_id]) + 1 if node.has("parent_id") else 1
		if depth > policy.limits.depth:
			return _error("nodes exceed the hierarchy depth limit.")
		depths[node.id] = depth
		if sibling_names.has(path):
			return _error("nodes.name must be unique among siblings.")
		sibling_names[path] = true
		paths[node.id] = path
		nodes.append(node)
		planned.append({"id": node.id, "type": node.type, "path": path})
	return Protocol.ok({"scene": input.scene, "dry_run": input.get("dry_run", false), "nodes": nodes, "planned_nodes": planned, "png_paths": png_paths.keys()})

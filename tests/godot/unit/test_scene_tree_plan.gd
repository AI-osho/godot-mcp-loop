extends "res://tests/godot/test_case.gd"

const Plan = preload("res://addons/mcp_loop/commands/tree_build_plan.gd")

func _request() -> Dictionary:
	return {"schema_version": 1, "scene": "res://work.tscn", "dry_run": true, "nodes": [
		{"id": "group", "type": "Node2D", "name": "Group"},
		{"id": "body", "parent_id": "group", "type": "CharacterBody2D", "name": "Player"},
	]}

func test_native_plan_accepts_one_parent_first_tree() -> void:
	var loaded: Dictionary = Plan.load_policy()
	assert_true(loaded.ok, "The same bundled policy must load natively.")
	if not loaded.ok:
		return
	var result: Dictionary = Plan.validate_request(_request(), loaded.result)
	assert_true(result.ok)
	if result.ok:
		assert_eq(result.result.nodes.size(), 2)
		assert_eq(result.result.planned_nodes[1].path, "Group/Player")


func test_native_plan_rejects_unknown_fields() -> void:
	var request := _request()
	request["unexpected"] = true
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "INVALID_TREE_PLAN")



func test_native_plan_bounds_node_count() -> void:
	var request := _request()
	request.nodes = []
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "INVALID_TREE_PLAN")



func test_native_plan_rejects_non_native_or_out_of_scope_classes() -> void:
	var request := _request()
	request.nodes[1].type = "HTTPRequest"
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "UNSUPPORTED_NODE_TYPE")



func test_native_plan_rejects_forward_or_missing_parents() -> void:
	var request := _request()
	request.nodes[1].parent_id = "missing"
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "INVALID_TREE_PLAN")



func test_native_plan_rejects_a_second_root() -> void:
	var request := _request()
	request.nodes[1].erase("parent_id")
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "INVALID_TREE_PLAN")



func test_native_plan_rejects_duplicate_literal_ids() -> void:
	var request := _request()
	request.nodes[1].id = "group"
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "INVALID_TREE_PLAN")



func test_native_plan_rejects_same_named_siblings() -> void:
	var request := _request()
	request.nodes.append({"id": "other", "parent_id": "group", "type": "Node2D", "name": "Player"})
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "INVALID_TREE_PLAN")



func test_native_plan_rejects_malformed_ids() -> void:
	var request := _request()
	request.nodes[1].id = "Bad-ID"
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "INVALID_TREE_PLAN")



func test_native_plan_rejects_repaired_names() -> void:
	var request := _request()
	request.nodes[1].name = "Invalid/Name"
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "INVALID_TREE_PLAN")



func test_native_plan_bounds_depth() -> void:
	var request := _request()
	request.nodes = []
	for index in 9:
		var entry := {"id": "n%d" % index, "type": "Node2D", "name": "N%d" % index}
		if index > 0:
			entry["parent_id"] = "n%d" % (index - 1)
		request.nodes.append(entry)
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "INVALID_TREE_PLAN")



func test_native_plan_rejects_nonliteral_scene_path() -> void:
	var request := _request()
	request.scene = "res://levels/../work.tscn"
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "INVALID_TREE_PLAN")



func test_native_plan_bounds_properties_per_node() -> void:
	var request := _request()
	request.nodes[0]["properties"] = {}
	for index in 33:
		request.nodes[0].properties["p%d" % index] = index
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "INVALID_TREE_PLAN")



func test_native_plan_rejects_unsupported_properties() -> void:
	var request := _request()
	request.nodes[0]["properties"] = {"script": "res://arbitrary.gd"}
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "UNSUPPORTED_PROPERTY")



func test_native_plan_does_not_coerce_boolean_strings() -> void:
	var request := _request()
	request.nodes[0]["properties"] = {"visible": "false"}
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "TREE_BUILD_VALIDATION_FAILED")



func test_native_plan_does_not_coerce_numeric_strings() -> void:
	var request := _request()
	request.nodes[0]["properties"] = {"rotation": "0.5"}
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "TREE_BUILD_VALIDATION_FAILED")



func test_native_plan_validates_vector_components() -> void:
	var request := _request()
	request.nodes[0]["properties"] = {"position": ["10", 20]}
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "TREE_BUILD_VALIDATION_FAILED")



func test_native_plan_validates_enum_values_without_float_integer_alias_errors() -> void:
	var request := _request()
	request.nodes[0].type = "Control"
	request.nodes[0]["properties"] = {"mouse_filter": 99}
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "TREE_BUILD_VALIDATION_FAILED")
	request.nodes[0].properties.mouse_filter = 1
	assert_true(Plan.validate_request(request, Plan.load_policy().result).ok)



func test_native_plan_rejects_named_color_expressions() -> void:
	var request := _request()
	request.nodes[1].type = "Sprite2D"
	request.nodes[1]["properties"] = {"modulate": "red"}
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "TREE_BUILD_VALIDATION_FAILED")



func test_native_plan_bounds_literal_text_utf8() -> void:
	var request := _request()
	request.nodes[1].type = "Label"
	request.nodes[1]["properties"] = {"text": "あ".repeat(683)}
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "INVALID_TREE_PLAN")



func test_native_plan_refuses_script_resources() -> void:
	var request := _request()
	request.nodes[1].type = "CollisionShape2D"
	request.nodes[1]["properties"] = {"shape": {"new": "GDScript", "properties": {}}}
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "UNSUPPORTED_PROPERTY")



func test_native_plan_validates_embedded_resource_values() -> void:
	var request := _request()
	request.nodes[1].type = "CollisionShape2D"
	request.nodes[1]["properties"] = {"shape": {"new": "RectangleShape2D", "properties": {"size": "Vector2(24,32)"}}}
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "TREE_BUILD_VALIDATION_FAILED")



func test_native_plan_checks_capsule_effective_defaults() -> void:
	var request := _request()
	request.nodes[1].type = "CollisionShape2D"
	request.nodes[1]["properties"] = {"shape": {"new": "CapsuleShape2D", "properties": {"radius": 10, "height": 10}}}
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "TREE_BUILD_VALIDATION_FAILED")



func test_native_plan_limits_texture_specs_to_png() -> void:
	var request := _request()
	request.nodes[1].type = "Sprite2D"
	request.nodes[1]["properties"] = {"texture": {"res": "res://assets/untrusted.tres"}}
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "RESOURCE_NOT_READY")



func test_native_plan_counts_resource_properties_in_total_budget() -> void:
	var request := _request()
	request.nodes[0]["properties"] = {"position": [0, 0]}
	request.nodes[1].type = "CollisionShape2D"
	request.nodes[1]["properties"] = {"shape": {"new": "RectangleShape2D", "properties": {"size": [24, 32]}}}
	var policy: Dictionary = Plan.load_policy().result
	policy.limits.properties_total = 2
	assert_error_code(Plan.validate_request(request, policy), "INVALID_TREE_PLAN")



func test_native_plan_bounds_arrays_before_vector_decode() -> void:
	var request := _request()
	var values: Array = []
	values.resize(65)
	values.fill(0)
	request.nodes[0]["properties"] = {"position": values}
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "INVALID_TREE_PLAN")



func test_native_plan_counts_each_resource() -> void:
	var request := _request()
	request.nodes[1].type = "CollisionShape2D"
	request.nodes[1]["properties"] = {"shape": {"new": "CircleShape2D"}}
	request.nodes.append({"id": "second", "parent_id": "group", "type": "CollisionShape2D", "name": "Second", "properties": {"shape": {"new": "CircleShape2D"}}})
	var policy: Dictionary = Plan.load_policy().result
	policy.limits.resources = 1
	assert_error_code(Plan.validate_request(request, policy), "INVALID_TREE_PLAN")



func test_native_plan_bounds_resource_nesting_before_leaf_decode() -> void:
	var request := _request()
	request.nodes[1].type = "PanelContainer"
	var value: Dictionary = {"new": "StyleBoxFlat", "properties": {"bg_color": "#ffffff"}}
	for index in 4:
		value = {"new": "StyleBoxFlat", "properties": {"bg_color": value}}
	request.nodes[1]["properties"] = {"theme_override_styles/panel": value}
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "INVALID_TREE_PLAN")



func test_native_plan_bounds_all_string_values() -> void:
	var request := _request()
	request.nodes[1].type = "N".repeat(2049)
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "INVALID_TREE_PLAN")



func test_native_plan_bounds_generic_json_nesting() -> void:
	var request := _request()
	var value: Dictionary = {}
	for index in 40:
		value = {"nested": value}
	request.nodes[0]["properties"] = {"position": value}
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "INVALID_TREE_PLAN")



func test_native_plan_bounds_serialized_utf8_bytes() -> void:
	var policy: Dictionary = Plan.load_policy().result
	policy.limits.request_bytes = 100
	assert_error_code(Plan.validate_request(_request(), policy), "INVALID_TREE_PLAN")



func test_native_plan_bounds_distinct_png_references() -> void:
	var request := _request()
	request.nodes.resize(1)
	for index in 17:
		request.nodes.append({"id": "s%d" % index, "parent_id": "group", "type": "Sprite2D", "name": "S%d" % index, "properties": {"texture": {"res": "res://assets/p%d.png" % index}}})
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "INVALID_TREE_PLAN")



func test_native_plan_rejects_forbidden_object_keys() -> void:
	var request := _request()
	request.nodes[0]["properties"] = {"__proto__": {"visible": false}}
	assert_error_code(Plan.validate_request(request, Plan.load_policy().result), "INVALID_TREE_PLAN")



func test_native_plan_refuses_unknown_policy_version() -> void:
	var policy: Dictionary = Plan.load_policy().result
	policy.schema_version = 2
	assert_error_code(Plan.validate_request(_request(), policy), "TREE_POLICY_INVALID")



func test_native_policy_rejects_limits_above_version_one_ceiling() -> void:
	var policy: Dictionary = Plan.load_policy().result
	policy.limits.nodes = 65
	assert_error_code(Plan.validate_request(_request(), policy), "TREE_POLICY_INVALID")



func test_native_policy_rejects_malformed_property_descriptors() -> void:
	var policy: Dictionary = Plan.load_policy().result
	policy.nodes.Node2D.position.min = "not a number"
	assert_error_code(Plan.validate_request(_request(), policy), "TREE_POLICY_INVALID")



func test_native_policy_exposes_pure_text_decoder() -> void:
	var found := false
	var script: GDScript = Plan
	for method in script.get_script_method_list():
		if method.name == "decode_policy_text":
			found = true
	assert_true(found, "A pure decoder is required to test malformed policy without editing the live addon.")
	if not found:
		return
	var text := FileAccess.get_file_as_string("res://addons/mcp_loop/commands/tree_build_policy.json")
	var result: Dictionary = script.call("decode_policy_text", text)
	assert_true(result.ok)



func test_native_policy_rejects_duplicate_json_keys() -> void:
	var text := FileAccess.get_file_as_string("res://addons/mcp_loop/commands/tree_build_policy.json")
	var duplicate := "{\"schema_version\":1," + text.substr(text.find("{") + 1)
	assert_error_code(Plan.decode_policy_text(duplicate), "TREE_POLICY_INVALID")


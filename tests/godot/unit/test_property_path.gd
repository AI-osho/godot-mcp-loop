extends "res://tests/godot/test_case.gd"

const PropertyPath = preload("res://addons/mcp_loop/util/property_path.gd")

const HOLDER_SRC := """extends Node2D
var items := [10, 20, 30]
var grid := [[0, 1], [2, 3], [4, 5]]
var data := {"name": "hero", 5: "five", "inner": {"hp": 7}}
var packed := PackedInt32Array([4, 5, 6])
var tint := Color(0.5, 0.25, 1.0)
var area := Rect2(1, 2, 3, 4)
var score := 42
var res: Resource = null
"""

var _node: Node2D


func _holder() -> Node2D:
	var s := GDScript.new()
	s.source_code = HOLDER_SRC
	s.reload()
	var n := Node2D.new()
	n.set_script(s)
	n.position = Vector2(7, 8)
	_node = n
	return n


func after_each() -> void:
	if is_instance_valid(_node):
		_node.free()


func _read(path: String) -> Variant:
	var r: Dictionary = PropertyPath.read(_node, path)
	assert_true(r.ok, "%s: %s" % [path, r.get("error", "")])
	return r.get("value")


func _error(path: String) -> String:
	var r: Dictionary = PropertyPath.read(_node, path)
	assert_false(r.ok, path + " should fail")
	return str(r.get("error", ""))


func test_plain_and_builtin_members() -> void:
	_holder()
	assert_eq(_read("position"), Vector2(7, 8))
	assert_eq(_read("position:y"), 8.0)
	assert_eq(_read("tint:g"), 0.25)
	assert_eq(_read("area:size:x"), 3.0)
	assert_eq(_read("score"), 42)


func test_array_indexes_including_negative_and_nested() -> void:
	_holder()
	assert_eq(_read("items:1"), 20)
	assert_eq(_read("items:-1"), 30)
	assert_eq(_read("grid:2:1"), 5)
	assert_eq(_read("packed:0"), 4)


func test_dictionary_keys_string_and_int() -> void:
	_holder()
	assert_eq(_read("data:name"), "hero")
	assert_eq(_read("data:5"), "five")
	assert_eq(_read("data:inner:hp"), 7)


func test_object_properties() -> void:
	_holder()
	var shape := RectangleShape2D.new()
	shape.size = Vector2(3, 4)
	_node.set("res", shape)
	assert_eq(_read("res:size"), Vector2(3, 4))


func test_unknown_property_names_the_property() -> void:
	_holder()
	assert_string_contains(_error("nope"), "no property 'nope'")


func test_index_out_of_range_reports_the_size() -> void:
	_holder()
	var e := _error("items:9")
	assert_string_contains(e, "out of range")
	assert_string_contains(e, "size 3")


func test_non_numeric_array_index() -> void:
	_holder()
	assert_string_contains(_error("items:first"), "number")


func test_missing_dictionary_key_lists_keys() -> void:
	_holder()
	var e := _error("data:missing")
	assert_string_contains(e, "missing")
	assert_string_contains(e, "name")


func test_invalid_builtin_member_lists_valid_ones() -> void:
	_holder()
	var e := _error("position:q")
	assert_string_contains(e, "'q'")
	assert_string_contains(e, "x")


func test_indexing_into_a_scalar_fails_cleanly() -> void:
	_holder()
	assert_string_contains(_error("score:1"), "int")


func test_null_in_the_middle_fails_cleanly() -> void:
	_holder()
	assert_string_contains(_error("res:size"), "null")


func test_head_exists_helper() -> void:
	_holder()
	assert_true(PropertyPath.has_head(_node, "items:9"))
	assert_false(PropertyPath.has_head(_node, "nope:1"))

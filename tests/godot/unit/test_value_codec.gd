extends "res://tests/godot/test_case.gd"

const Codec = preload("res://addons/mcp_loop/util/value_codec.gd")


func _dec(v: Variant, t: int) -> Variant:
	var r := Codec.decode(v, t)
	if not r.ok:
		fail("decode failed: " + r.error)
	return r.value


# ---- decode ----

func test_decode_vector2_from_array_and_object() -> void:
	assert_eq(_dec([1, 2.5], TYPE_VECTOR2), Vector2(1, 2.5))
	assert_eq(_dec({"x": 3, "y": 4}, TYPE_VECTOR2), Vector2(3, 4))


func test_decode_vector2i_and_vector3() -> void:
	assert_eq(_dec([1, 2], TYPE_VECTOR2I), Vector2i(1, 2))
	assert_eq(_dec([1, 2, 3], TYPE_VECTOR3), Vector3(1, 2, 3))
	assert_eq(_dec({"x": 1, "y": 2, "z": 3}, TYPE_VECTOR3I), Vector3i(1, 2, 3))


func test_decode_vector_wrong_length_fails() -> void:
	var r := Codec.decode([1], TYPE_VECTOR2)
	assert_false(r.ok)
	assert_true(r.error.contains("Vector2"))


func test_decode_color_from_hex_name_and_array() -> void:
	assert_eq(_dec("#ff0000", TYPE_COLOR), Color(1, 0, 0, 1))
	assert_eq(_dec("#00ff0080", TYPE_COLOR), Color("#00ff0080"))
	assert_eq(_dec("red", TYPE_COLOR), Color.RED)
	assert_eq(_dec([0, 0, 1], TYPE_COLOR), Color(0, 0, 1, 1))
	assert_eq(_dec([0, 0, 1, 0.5], TYPE_COLOR), Color(0, 0, 1, 0.5))


func test_decode_invalid_color_fails() -> void:
	assert_false(Codec.decode("notacolor", TYPE_COLOR).ok)


func test_decode_numbers() -> void:
	assert_eq(_dec(3.0, TYPE_INT), 3)
	assert_eq(_dec(3, TYPE_FLOAT), 3.0)
	assert_false(Codec.decode(3.5, TYPE_INT).ok, "non-integral to int must fail")
	assert_false(Codec.decode("3", TYPE_FLOAT).ok, "string to float must fail")


func test_decode_bool_string_stringname_nodepath() -> void:
	assert_eq(_dec(true, TYPE_BOOL), true)
	assert_false(Codec.decode(1, TYPE_BOOL).ok)
	assert_eq(_dec("hi", TYPE_STRING), "hi")
	assert_eq(_dec("walk", TYPE_STRING_NAME), &"walk")
	assert_eq(_dec("../Player", TYPE_NODE_PATH), NodePath("../Player"))


func test_decode_rect2() -> void:
	assert_eq(_dec([1, 2, 3, 4], TYPE_RECT2), Rect2(1, 2, 3, 4))
	assert_eq(_dec({"position": [1, 2], "size": [3, 4]}, TYPE_RECT2), Rect2(1, 2, 3, 4))


func test_decode_resource_reference() -> void:
	# Missing resources fail with a clear message.
	var r := Codec.decode({"res": "res://definitely_missing.tres"}, TYPE_OBJECT)
	assert_false(r.ok)
	assert_true(r.error.contains("definitely_missing"))


func test_decode_resource_outside_res_is_rejected() -> void:
	var r := Codec.decode({"res": "/etc/passwd"}, TYPE_OBJECT)
	assert_false(r.ok)


func test_decode_null_object_clears() -> void:
	var r := Codec.decode(null, TYPE_OBJECT)
	assert_true(r.ok)
	assert_eq(r.value, null)


func test_decode_nil_type_passes_through() -> void:
	assert_eq(_dec({"a": 1}, TYPE_NIL), {"a": 1})


# ---- encode ----

func test_encode_vectors_and_color() -> void:
	assert_eq(Codec.encode(Vector2(1, 2)), [1.0, 2.0])
	assert_eq(Codec.encode(Vector3i(1, 2, 3)), [1, 2, 3])
	assert_eq(Codec.encode(Color(1, 0, 0, 1)), "#ff0000ff")


func test_encode_nodepath_stringname_rect() -> void:
	assert_eq(Codec.encode(NodePath("A/B")), "A/B")
	assert_eq(Codec.encode(&"x"), "x")
	assert_eq(Codec.encode(Rect2(1, 2, 3, 4)), {"position": [1.0, 2.0], "size": [3.0, 4.0]})


func test_encode_nested_containers() -> void:
	assert_eq(Codec.encode({"p": [Vector2(1, 1)]}), {"p": [[1.0, 1.0]]})


func test_encode_resource_and_node() -> void:
	var res := Resource.new()
	res.resource_path = "res://some.tres"
	assert_eq(Codec.encode(res), {"res": "res://some.tres", "type": "Resource"})
	var n := Node.new()
	n.name = "Lonely"
	assert_eq(Codec.encode(n), {"node": "Lonely", "type": "Node"})
	n.free()


func test_encode_non_finite_floats_as_strings() -> void:
	assert_eq(Codec.encode(INF), "inf")
	assert_eq(Codec.encode(NAN), "nan")


func test_encode_large_packed_array_is_truncated() -> void:
	var a := PackedInt32Array()
	a.resize(1000)
	var out: Variant = Codec.encode(a)
	assert_eq(typeof(out), TYPE_DICTIONARY)
	assert_eq(out["size"], 1000)
	assert_eq(out["items"].size(), Codec.MAX_ARRAY_ITEMS)

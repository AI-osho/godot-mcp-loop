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
	assert_false(Codec.decode("three", TYPE_FLOAT).ok, "non-numeric string to float must fail")


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


# ---- with_indexed ----

func test_with_indexed_sets_vector_component() -> void:
	assert_eq(Codec.with_indexed(Vector2(1, 2), ["x"], 9.0), Vector2(9, 2))


func test_with_indexed_nested() -> void:
	var t := Transform2D.IDENTITY
	var out: Transform2D = Codec.with_indexed(t, ["origin", "y"], 5.0)
	assert_eq(out.origin, Vector2(0, 5))


func test_with_indexed_dictionary_key() -> void:
	assert_eq(Codec.with_indexed({"a": 1}, ["b"], 2), {"a": 1, "b": 2})


# ---- stringified input (some clients send untyped JSON values as strings) ----

func test_decode_numeric_strings() -> void:
	assert_eq(_dec("120", TYPE_FLOAT), 120.0)
	assert_eq(_dec("3", TYPE_INT), 3)
	assert_eq(_dec("true", TYPE_BOOL), true)


func test_decode_json_strings_for_structured_types() -> void:
	assert_eq(_dec("[10, 20]", TYPE_VECTOR2), Vector2(10, 20))
	assert_eq(_dec("{\"x\": 1, \"y\": 2}", TYPE_VECTOR2), Vector2(1, 2))
	assert_eq(_dec("[0, 0, 1, 1]", TYPE_COLOR), Color(0, 0, 1, 1))


func test_decode_string_types_are_not_reinterpreted() -> void:
	assert_eq(_dec("[1, 2]", TYPE_STRING), "[1, 2]")
	assert_eq(_dec("42", TYPE_STRING_NAME), &"42")


func test_decode_garbage_string_still_fails() -> void:
	assert_false(Codec.decode("abc", TYPE_FLOAT).ok)
	assert_false(Codec.decode("[1, 2", TYPE_VECTOR2).ok)


# ---- embedded resources: {"new": "Class", "properties": {...}} ----

func test_decode_new_resource_with_properties() -> void:
	var r: Dictionary = Codec.decode({"new": "RectangleShape2D", "properties": {"size": [32, 48]}}, TYPE_OBJECT)
	assert_true(r.ok, str(r.get("error", "")))
	assert_true(r.value is RectangleShape2D)
	assert_eq(r.value.size, Vector2(32, 48))


func test_decode_new_resource_without_properties() -> void:
	var r: Dictionary = Codec.decode({"new": "CircleShape2D"}, TYPE_OBJECT)
	assert_true(r.ok and r.value is CircleShape2D)


func test_decode_new_resource_decodes_typed_properties() -> void:
	var r: Dictionary = Codec.decode({"new": "StyleBoxFlat", "properties": {"bg_color": "#ff0000", "corner_radius_top_left": "4"}}, TYPE_OBJECT)
	assert_true(r.ok, str(r.get("error", "")))
	assert_eq(r.value.bg_color, Color(1, 0, 0))
	assert_eq(r.value.corner_radius_top_left, 4)


func test_decode_new_resource_nested() -> void:
	var r: Dictionary = Codec.decode({"new": "ParticleProcessMaterial", "properties": {
		"color_ramp": {"new": "GradientTexture1D", "properties": {"width": 64}}}}, TYPE_OBJECT)
	assert_true(r.ok, str(r.get("error", "")))
	assert_true(r.value.color_ramp is GradientTexture1D)
	assert_eq(r.value.color_ramp.width, 64)


func test_decode_new_rejects_unknown_class() -> void:
	var r: Dictionary = Codec.decode({"new": "NoSuchShape"}, TYPE_OBJECT)
	assert_false(r.ok)
	assert_string_contains(r.error, "NoSuchShape")


func test_decode_new_rejects_non_resources() -> void:
	assert_false(Codec.decode({"new": "Node2D"}, TYPE_OBJECT).ok)


func test_decode_new_rejects_abstract_classes() -> void:
	assert_false(Codec.decode({"new": "Shape2D"}, TYPE_OBJECT).ok)


func test_decode_new_rejects_scripts() -> void:
	for cls in ["GDScript", "Script"]:
		var r: Dictionary = Codec.decode({"new": cls, "properties": {"source_code": "extends Node"}}, TYPE_OBJECT)
		assert_false(r.ok, cls)
		assert_string_contains(r.error, "script_write")


func test_decode_new_rejects_unknown_property() -> void:
	var r: Dictionary = Codec.decode({"new": "RectangleShape2D", "properties": {"radius": 3}}, TYPE_OBJECT)
	assert_false(r.ok)
	assert_string_contains(r.error, "radius")


func test_decode_new_rejects_bad_property_value() -> void:
	assert_false(Codec.decode({"new": "RectangleShape2D", "properties": {"size": "big"}}, TYPE_OBJECT).ok)


func test_encode_embedded_resource_as_new_with_changed_properties() -> void:
	var shape := RectangleShape2D.new()
	shape.size = Vector2(32, 48)
	assert_eq(Codec.encode(shape), {"new": "RectangleShape2D", "properties": {"size": [32.0, 48.0]}})


func test_encode_embedded_resource_round_trips() -> void:
	var shape := RectangleShape2D.new()
	shape.size = Vector2(10, 20)
	var back: Dictionary = Codec.decode(Codec.encode(shape), TYPE_OBJECT)
	assert_true(back.ok and back.value is RectangleShape2D)
	assert_eq(back.value.size, Vector2(10, 20))


func test_encode_file_resource_as_reference() -> void:
	var res := load("res://examples/platformer/player.gd")
	assert_eq(Codec.encode(res), {"res": "res://examples/platformer/player.gd", "type": res.get_class()})


# ---- str_to_var builds objects (Object(...)) while parsing: only plain literals may reach it ----

func test_object_literals_are_never_parsed() -> void:
	var before := Performance.get_monitor(Performance.OBJECT_COUNT)
	for s in ['Object(Node,"name":"x")', 'Transform2D(Object(Node), 0, 0, 0, 0, 0)', 'Object(RefCounted)']:
		var r := Codec.decode(s, TYPE_TRANSFORM2D)
		assert_false(r.ok, "must be rejected: " + s)
	var leaked := Performance.get_monitor(Performance.OBJECT_COUNT) - before
	assert_eq(leaked, 0.0, "no objects may be constructed while decoding")
	assert_false(Codec.decode('Object(Node,"name":"x")', TYPE_CALLABLE).ok)


func test_plain_godot_literals_still_decode() -> void:
	var t := Codec.decode("Transform2D(1, 0, 0, 1, 5, 6)", TYPE_TRANSFORM2D)
	assert_true(t.ok, str(t.get("error", "")))
	assert_eq(t.value.origin, Vector2(5, 6))
	var pv := Codec.decode("PackedVector2Array(0, 0, 1, 1)", TYPE_PACKED_VECTOR2_ARRAY)
	assert_true(pv.ok, str(pv.get("error", "")))
	assert_eq(pv.value.size(), 2)
	var ps := Codec.decode('PackedStringArray("a", "b")', TYPE_PACKED_STRING_ARRAY)
	assert_true(ps.ok, str(ps.get("error", "")))


# ---- 3D values: Transform3D / Basis / Quaternion / AABB / Plane ----

func test_encode_3d_values_as_json() -> void:
	var t := Transform3D(Basis.IDENTITY, Vector3(1, 2, 3))
	assert_eq(Codec.encode(t), {
		"origin": [1.0, 2.0, 3.0],
		"basis": {"x": [1.0, 0.0, 0.0], "y": [0.0, 1.0, 0.0], "z": [0.0, 0.0, 1.0]},
	})
	assert_eq(Codec.encode(Basis.IDENTITY), {"x": [1.0, 0.0, 0.0], "y": [0.0, 1.0, 0.0], "z": [0.0, 0.0, 1.0]})
	assert_eq(Codec.encode(Quaternion(0, 0, 0, 1)), [0.0, 0.0, 0.0, 1.0])
	assert_eq(Codec.encode(AABB(Vector3(1, 2, 3), Vector3(4, 5, 6))),
		{"position": [1.0, 2.0, 3.0], "size": [4.0, 5.0, 6.0]})
	assert_eq(Codec.encode(Plane(Vector3(0, 1, 0), 2.0)), {"normal": [0.0, 1.0, 0.0], "d": 2.0})


func test_3d_values_round_trip_through_json() -> void:
	var t := Transform3D(
		Basis(Vector3(0.8, 0.6, 0.0), Vector3(-0.6, 0.8, 0.0), Vector3(0.0, 0.0, 1.0)),
		Vector3(1, 2, 3))
	var back: Transform3D = _dec(Codec.encode(t), TYPE_TRANSFORM3D)
	assert_true(back.is_equal_approx(t), "Transform3D round trip")
	var q := Quaternion(0.2, 0.3, 0.4, 0.5)
	var q_back: Quaternion = _dec(Codec.encode(q), TYPE_QUATERNION)
	assert_true(q_back.is_equal_approx(q))
	assert_eq(_dec(Codec.encode(AABB(Vector3(1, 2, 3), Vector3(4, 5, 6))), TYPE_AABB),
		AABB(Vector3(1, 2, 3), Vector3(4, 5, 6)))
	assert_eq(_dec(Codec.encode(Plane(Vector3(0, 1, 0), 2.5)), TYPE_PLANE), Plane(Vector3(0, 1, 0), 2.5))


func test_decode_3d_values_accepts_short_forms() -> void:
	# basis directly on the object, and 9 numbers meaning the columns x, y, z
	var flat: Transform3D = _dec({"origin": [0, 1, 0], "x": [1, 0, 0], "y": [0, 1, 0], "z": [0, 0, 1]}, TYPE_TRANSFORM3D)
	assert_eq(flat.origin, Vector3(0, 1, 0))
	assert_eq(_dec([1, 0, 0, 0, 1, 0, 0, 0, 1], TYPE_BASIS), Basis.IDENTITY)
	assert_eq(_dec({"x": 0, "y": 0, "z": 0, "w": 1}, TYPE_QUATERNION), Quaternion(0, 0, 0, 1))
	assert_eq(_dec([1, 2, 3, 4, 5, 6], TYPE_AABB), AABB(Vector3(1, 2, 3), Vector3(4, 5, 6)))
	assert_eq(_dec([0, 1, 0, 2.5], TYPE_PLANE), Plane(Vector3(0, 1, 0), 2.5))


func test_decode_3d_values_explain_what_is_missing() -> void:
	var t := Codec.decode({"origin": [1, 2]}, TYPE_TRANSFORM3D)
	assert_false(t.ok)
	assert_string_contains(t.error, "Transform3D.origin")
	var b := Codec.decode({"x": [1, 0, 0]}, TYPE_BASIS)
	assert_false(b.ok)
	assert_string_contains(b.error, "Basis")
	var q := Codec.decode([1, 2, 3], TYPE_QUATERNION)
	assert_false(q.ok)
	assert_string_contains(q.error, "Quaternion")
	var box := Codec.decode({"position": [1, 2, 3]}, TYPE_AABB)
	assert_false(box.ok)
	assert_string_contains(box.error, "AABB.size")

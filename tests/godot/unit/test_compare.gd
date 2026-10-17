extends "res://tests/godot/test_case.gd"

const Compare = preload("res://addons/mcp_loop/util/compare.gd")


func _is(actual: Variant, op: String, expected: Variant) -> bool:
	var r := Compare.evaluate(actual, op, expected)
	if not r.ok:
		fail("evaluate(%s %s %s) invalid: %s" % [var_to_str(actual), op, var_to_str(expected), r.error])
	return r.result


func test_numbers() -> void:
	assert_true(_is(5, ">", 3))
	assert_false(_is(5, "<", 3))
	assert_true(_is(5.0, ">=", 5))
	assert_true(_is(3, "<=", 3.0))
	assert_true(_is(0.1 + 0.2, "==", 0.3), "float equality uses an epsilon")
	assert_true(_is(1, "!=", 2))


func test_vectors_compare_elementwise() -> void:
	assert_true(_is([1.0, 2.0], "==", [1, 2]))
	assert_false(_is([1.0, 2.0], "==", [1, 3]))
	assert_true(_is([1.0, 2.0], "!=", [1, 3]))


func test_bools_strings_null() -> void:
	assert_true(_is(true, "==", true))
	assert_true(_is("hello world", "contains", "world"))
	assert_true(_is("a", "!=", "b"))
	assert_true(_is(null, "==", null))
	assert_false(_is(null, "==", 0))


func test_array_contains() -> void:
	assert_true(_is(["a", "b"], "contains", "b"))
	assert_false(_is(["a", "b"], "contains", "c"))


func test_ordering_on_non_numbers_is_invalid() -> void:
	assert_false(Compare.evaluate("a", ">", "b").ok)
	assert_false(Compare.evaluate([1, 2], "<", [3, 4]).ok)


func test_unknown_operator_is_invalid() -> void:
	var r := Compare.evaluate(1, "~=", 1)
	assert_false(r.ok)
	assert_true(r.error.contains("~="))


func test_dictionaries_deep_equal() -> void:
	assert_true(_is({"a": [1.0, 2.0]}, "==", {"a": [1, 2]}))


# Some MCP clients send untyped values as strings ("2"). Compare must cope.
func test_numeric_strings_compare_with_numbers() -> void:
	assert_true(_is(2, "==", "2"))
	assert_true(_is(375.13, ">=", "370"))
	assert_true(_is(144.0, "<", "600"))
	assert_false(_is(2, "==", "3"))


func test_bool_strings_compare_with_bools() -> void:
	assert_true(_is(true, "==", "true"))
	assert_true(_is(false, "==", "false"))


func test_json_array_strings_compare_with_vectors() -> void:
	assert_true(_is([1.0, 2.0], "==", "[1, 2]"))


func test_plain_strings_still_compare_as_strings() -> void:
	assert_true(_is("hello", "==", "hello"))
	assert_true(_is("hello world", "contains", "world"))

extends RefCounted
## Base class for godot-mcp-loop unit tests.
## Test files live in res://tests/godot/unit/test_*.gd, extend this script,
## and define methods whose names start with "test_". Tests may use `await`.

var _failures: Array[String] = []
var tree: SceneTree


func set_tree(t: SceneTree) -> void:
	tree = t


func get_failures() -> Array[String]:
	return _failures


func clear_failures() -> void:
	_failures.clear()


func fail(message: String) -> void:
	_failures.append(message)


func assert_true(value: Variant, message: String = "") -> void:
	if not value:
		fail("expected true, got %s %s" % [str(value), message])


func assert_false(value: Variant, message: String = "") -> void:
	if value:
		fail("expected false, got %s %s" % [str(value), message])


func assert_eq(actual: Variant, expected: Variant, message: String = "") -> void:
	if typeof(actual) != typeof(expected) or actual != expected:
		fail("expected %s (%s), got %s (%s) %s" % [
			var_to_str(expected), type_string(typeof(expected)),
			var_to_str(actual), type_string(typeof(actual)), message])


func assert_has(container: Variant, key: Variant, message: String = "") -> void:
	if not container.has(key):
		fail("expected %s to contain %s %s" % [var_to_str(container), var_to_str(key), message])


func assert_error_code(response: Dictionary, code: String, message: String = "") -> void:
	if response.get("ok", true) != false:
		fail("expected error %s, got ok response %s %s" % [code, JSON.stringify(response), message])
		return
	var actual: String = response.get("error", {}).get("code", "")
	if actual != code:
		fail("expected error code %s, got %s %s" % [code, actual, message])

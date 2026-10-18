@tool
extends RefCounted
## Structured comparisons for game_wait_for / scenario asserts.
## Values are JSON-shaped (see value_codec.encode). No code evaluation.

const EPSILON := 0.0001
const OPS := ["==", "!=", ">", ">=", "<", "<=", "contains"]


static func _num(v: Variant) -> bool:
	return typeof(v) == TYPE_INT or typeof(v) == TYPE_FLOAT


static func equals(a: Variant, b: Variant, tolerance: float = EPSILON) -> bool:
	if _num(a) and _num(b):
		return absf(float(a) - float(b)) <= tolerance
	if typeof(a) == TYPE_ARRAY and typeof(b) == TYPE_ARRAY:
		if a.size() != b.size():
			return false
		for i in a.size():
			if not equals(a[i], b[i], tolerance):
				return false
		return true
	if typeof(a) == TYPE_DICTIONARY and typeof(b) == TYPE_DICTIONARY:
		if a.size() != b.size():
			return false
		for k in a:
			if not b.has(k) or not equals(a[k], b[k], tolerance):
				return false
		return true
	if typeof(a) != typeof(b):
		return false
	return a == b


## Some MCP clients send untyped values as strings ("2", "true", "[1, 2]").
## When the game value is not a string, read such an expected value as JSON.
static func _coerce_expected(actual: Variant, expected: Variant) -> Variant:
	if typeof(expected) != TYPE_STRING or typeof(actual) == TYPE_STRING or typeof(actual) == TYPE_DICTIONARY:
		return expected
	var json := JSON.new()
	if json.parse(expected) == OK:
		return json.data
	return expected


## Returns {ok, result, error}. ok=false means the comparison itself is invalid.
## tolerance applies to numbers (also inside vectors/arrays) for ==, !=, >=, <=.
static func evaluate(actual: Variant, op: String, raw_expected: Variant, tolerance: float = EPSILON) -> Dictionary:
	var expected: Variant = _coerce_expected(actual, raw_expected)
	if not OPS.has(op):
		return {"ok": false, "result": false, "error": "Unknown operator '%s'. Use one of %s." % [op, ", ".join(OPS)]}
	match op:
		"==":
			return {"ok": true, "result": equals(actual, expected, tolerance), "error": ""}
		"!=":
			return {"ok": true, "result": not equals(actual, expected, tolerance), "error": ""}
		"contains":
			if typeof(actual) == TYPE_STRING and typeof(expected) == TYPE_STRING:
				return {"ok": true, "result": actual.contains(expected), "error": ""}
			if typeof(actual) == TYPE_ARRAY:
				for item in actual:
					if equals(item, expected):
						return {"ok": true, "result": true, "error": ""}
				return {"ok": true, "result": false, "error": ""}
			if typeof(actual) == TYPE_DICTIONARY:
				return {"ok": true, "result": actual.has(expected), "error": ""}
			return {"ok": false, "result": false, "error": "'contains' needs a string, array or object value (got %s)." % type_string(typeof(actual))}
	if not (_num(actual) and _num(expected)):
		return {"ok": false, "result": false, "error": "'%s' compares numbers only (got %s and %s). Compare a component like 'position:x'." % [op, type_string(typeof(actual)), type_string(typeof(expected))]}
	var a := float(actual)
	var b := float(expected)
	var r := false
	match op:
		">":
			r = a > b
		">=":
			r = a >= b - tolerance
		"<":
			r = a < b
		"<=":
			r = a <= b + tolerance
	return {"ok": true, "result": r, "error": ""}

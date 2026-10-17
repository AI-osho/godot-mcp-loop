@tool
extends RefCounted
## Structured comparisons for game_wait_for / scenario asserts.
## Values are JSON-shaped (see value_codec.encode). No code evaluation.

const EPSILON := 0.0001
const OPS := ["==", "!=", ">", ">=", "<", "<=", "contains"]


static func _num(v: Variant) -> bool:
	return typeof(v) == TYPE_INT or typeof(v) == TYPE_FLOAT


static func equals(a: Variant, b: Variant) -> bool:
	if _num(a) and _num(b):
		return absf(float(a) - float(b)) <= EPSILON
	if typeof(a) == TYPE_ARRAY and typeof(b) == TYPE_ARRAY:
		if a.size() != b.size():
			return false
		for i in a.size():
			if not equals(a[i], b[i]):
				return false
		return true
	if typeof(a) == TYPE_DICTIONARY and typeof(b) == TYPE_DICTIONARY:
		if a.size() != b.size():
			return false
		for k in a:
			if not b.has(k) or not equals(a[k], b[k]):
				return false
		return true
	if typeof(a) != typeof(b):
		return false
	return a == b


## Returns {ok, result, error}. ok=false means the comparison itself is invalid.
static func evaluate(actual: Variant, op: String, expected: Variant) -> Dictionary:
	if not OPS.has(op):
		return {"ok": false, "result": false, "error": "Unknown operator '%s'. Use one of %s." % [op, ", ".join(OPS)]}
	match op:
		"==":
			return {"ok": true, "result": equals(actual, expected), "error": ""}
		"!=":
			return {"ok": true, "result": not equals(actual, expected), "error": ""}
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
			r = a >= b - EPSILON
		"<":
			r = a < b
		"<=":
			r = a <= b + EPSILON
	return {"ok": true, "result": r, "error": ""}

@tool
extends RefCounted
## Reads JUnit XML test reports (as written by GUT and GdUnit4) into
## {ok, tests: [{suite, name, status, message, time}], totals: {tests, passed, failed, errors, skipped}}.
## status is "passed", "failed", "error" or "skipped".

const MAX_MESSAGE := 2000
const STATUS := {"failure": "failed", "error": "error", "skipped": "skipped"}
## Attribute texts that say nothing beyond the status (GUT writes these).
const GENERIC := ["", "failed", "failure", "pending", "skipped", "error"]


static func parse(xml: String) -> Dictionary:
	if xml.strip_edges() == "":
		return _fail("The report is empty.")
	var p := XMLParser.new()
	if p.open_buffer(xml.to_utf8_buffer()) != OK:
		return _fail("The report is not XML.")
	var tests: Array = []
	var suite := ""
	var current: Dictionary = {}
	var detail := ""  # the failure/error/skipped element we are inside
	var seen_suite := false
	while p.read() == OK:
		match p.get_node_type():
			XMLParser.NODE_ELEMENT:
				var n := p.get_node_name()
				if n == "testsuites" or n == "testsuite":
					seen_suite = true
				if n == "testsuite":
					var pkg := p.get_named_attribute_value_safe("package")
					var nm := p.get_named_attribute_value_safe("name")
					suite = "%s/%s" % [pkg, nm] if pkg != "" else nm
				elif n == "testcase":
					current = {
						"suite": suite,
						"name": p.get_named_attribute_value_safe("name"),
						"status": "passed",
						"message": "",
						"time": p.get_named_attribute_value_safe("time").to_float(),
					}
					tests.append(current)
					if p.is_empty():
						current = {}
				elif STATUS.has(n) and not current.is_empty():
					current.status = STATUS[n]
					current.message = _join(String(current.message), p.get_named_attribute_value_safe("message"))
					if not p.is_empty():
						detail = n
			XMLParser.NODE_TEXT, XMLParser.NODE_CDATA:
				if detail != "" and not current.is_empty():
					# Godot's XMLParser returns CDATA content through get_node_name(); get_node_data() is for text only.
					var data := p.get_node_data() if p.get_node_type() == XMLParser.NODE_TEXT else p.get_node_name()
					current.message = _join(String(current.message), data)
			XMLParser.NODE_ELEMENT_END:
				var n := p.get_node_name()
				if n == detail:
					detail = ""
				elif n == "testcase":
					current = {}
	if not seen_suite:
		return _fail("The report has no <testsuite>.")
	return {"ok": true, "tests": tests, "totals": totals(tests)}


static func totals(tests: Array) -> Dictionary:
	var t := {"tests": tests.size(), "passed": 0, "failed": 0, "errors": 0, "skipped": 0}
	for test in tests:
		match String(test.status):
			"passed": t.passed += 1
			"failed": t.failed += 1
			"error": t.errors += 1
			"skipped": t.skipped += 1
	return t


static func _join(a: String, b: String) -> String:
	b = b.strip_edges()
	if b == "":
		return a
	var joined := b if a.strip_edges().to_lower() in GENERIC else "%s\n%s" % [a, b]
	return joined.substr(0, MAX_MESSAGE)


static func _fail(message: String) -> Dictionary:
	return {"ok": false, "error": message, "tests": [], "totals": totals([])}

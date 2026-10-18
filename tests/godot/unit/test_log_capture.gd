extends "res://tests/godot/test_case.gd"

const LogCapture = preload("res://addons/mcp_loop/util/log_capture.gd")


func test_records_messages_with_increasing_seq() -> void:
	var c := LogCapture.new(10)
	c._log_message("hello\n", false)
	c._log_message("oops\n", true)
	var r := c.read(0)
	assert_eq(r.entries.size(), 2)
	assert_eq(r.entries[0].message, "hello")
	assert_eq(r.entries[0].level, "info")
	assert_eq(r.entries[1].level, "error")
	assert_true(r.entries[1].seq > r.entries[0].seq)
	assert_eq(r.next, r.entries[1].seq + 1)


func test_read_since_cursor() -> void:
	var c := LogCapture.new(10)
	c._log_message("a\n", false)
	var cur := c.cursor()
	c._log_message("b\n", false)
	var r := c.read(cur)
	assert_eq(r.entries.map(func(e): return e.message), ["b"])


func test_records_errors_with_location() -> void:
	var c := LogCapture.new(10)
	c._log_error("GDScript::reload", "built-in", 4, "", "Parse Error: Unexpected identifier", false, Logger.ERROR_TYPE_SCRIPT, [])
	var e: Dictionary = c.read(0).entries[0]
	assert_eq(e.level, "script_error")
	assert_eq(e.line, 4)
	assert_eq(e.file, "built-in")
	assert_eq(e.message, "Parse Error: Unexpected identifier")


func test_error_without_rationale_uses_code() -> void:
	var c := LogCapture.new(10)
	c._log_error("f", "x.cpp", 1, "Condition failed", "", false, Logger.ERROR_TYPE_ERROR, [])
	assert_eq(c.read(0).entries[0].message, "Condition failed")


func test_warning_level() -> void:
	var c := LogCapture.new(10)
	c._log_error("f", "x.gd", 1, "", "careful", false, Logger.ERROR_TYPE_WARNING, [])
	assert_eq(c.read(0).entries[0].level, "warning")


func test_ring_buffer_drops_oldest() -> void:
	var c := LogCapture.new(3)
	for i in 5:
		c._log_message("m%d\n" % i, false)
	var r := c.read(0)
	assert_eq(r.entries.map(func(e): return e.message), ["m2", "m3", "m4"])
	assert_eq(r.dropped, true)


func test_min_level_filter_and_limit() -> void:
	var c := LogCapture.new(10)
	c._log_message("info\n", false)
	c._log_error("f", "a.gd", 1, "", "warn", false, Logger.ERROR_TYPE_WARNING, [])
	c._log_message("err\n", true)
	assert_eq(c.read(0, "warning").entries.size(), 2)
	assert_eq(c.read(0, "error").entries.size(), 1)
	var limited := c.read(0, "info", 1)
	assert_eq(limited.entries.size(), 1)
	assert_eq(limited.entries[0].message, "info")
	assert_eq(limited.next, limited.entries[0].seq + 1, "next resumes after the last returned entry")


func test_ignores_own_prefix_to_avoid_feedback() -> void:
	var c := LogCapture.new(10)
	c._log_message("[mcp_loop] internal\n", false)
	assert_eq(c.read(0).entries.size(), 0)


func test_append_keeps_fields_and_assigns_local_seq() -> void:
	var c := LogCapture.new(10)
	c.append({"level": "error", "message": "boom", "line": 3, "seq": 999})
	var e: Dictionary = c.read(0).entries[0]
	assert_eq(e.message, "boom")
	assert_eq(e.line, 3)
	assert_eq(e.seq, 1)


func test_clear_empties_but_keeps_seq_monotonic() -> void:
	var c := LogCapture.new(10)
	c._log_message("a\n", false)
	var before := c.cursor()
	c.clear()
	assert_eq(c.read(0).entries.size(), 0)
	c._log_message("b\n", false)
	assert_true(c.read(0).entries[0].seq >= before)
	assert_eq(c.read(0).dropped, false)


func test_count_at_least_level() -> void:
	var c := LogCapture.new(10)
	c._log_message("a\n", false)
	c._log_message("b\n", true)
	c._log_error("f", "x.gd", 1, "", "w", false, Logger.ERROR_TYPE_WARNING, [])
	assert_eq(c.count("error"), 1)
	assert_eq(c.count("warning"), 2)


func test_terminal_color_codes_are_stripped() -> void:
	var cap := LogCapture.new()
	cap._log_message(char(27) + "[1;31mERROR:" + char(27) + "[0m something broke", true)
	var r: Dictionary = cap.read(0)
	assert_eq(r.entries[0].message, "ERROR: something broke")

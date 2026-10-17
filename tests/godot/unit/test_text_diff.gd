extends "res://tests/godot/test_case.gd"

const TextDiff = preload("res://addons/mcp_loop/util/text_diff.gd")


func test_identical_text_has_empty_diff() -> void:
	assert_eq(TextDiff.unified("a\nb\n", "a\nb\n", "res://x.gd"), "")


func test_single_line_change() -> void:
	var d := TextDiff.unified("a\nb\nc\n", "a\nB\nc\n", "res://x.gd")
	var expected := "\n".join([
		"--- a/res://x.gd",
		"+++ b/res://x.gd",
		"@@ -1,3 +1,3 @@",
		" a",
		"-b",
		"+B",
		" c",
	]) + "\n"
	assert_eq(d, expected)


func test_addition_to_empty_file() -> void:
	var d := TextDiff.unified("", "x\ny\n", "res://n.gd")
	assert_true(d.contains("@@ -0,0 +1,2 @@"), d)
	assert_true(d.contains("+x\n+y\n"), d)


func test_far_apart_changes_make_two_hunks() -> void:
	var old_lines: Array[String] = []
	for i in 30:
		old_lines.append("line%d" % i)
	var new_lines := old_lines.duplicate()
	new_lines[2] = "CHANGED2"
	new_lines[25] = "CHANGED25"
	var d := TextDiff.unified("\n".join(old_lines) + "\n", "\n".join(new_lines) + "\n", "res://x.gd")
	assert_eq(d.count("@@ -"), 2, d)
	assert_true(d.contains("-line2\n+CHANGED2"), d)
	assert_true(d.contains("-line25\n+CHANGED25"), d)


func test_stats() -> void:
	var s := TextDiff.stats("a\nb\nc\n", "a\nc\nd\ne\n")
	assert_eq(s, {"added": 2, "removed": 1})

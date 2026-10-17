extends "res://tests/godot/test_case.gd"

const TextEdits = preload("res://addons/mcp_loop/util/text_edits.gd")

const SRC := "extends Node\nvar speed := 100\nvar jump := 300\n\nfunc _ready() -> void:\n\tprint(speed)\n"


func _apply(edits: Array) -> Dictionary:
	return TextEdits.apply(SRC, edits)


func test_single_replacement() -> void:
	var r := _apply([{"old": "var speed := 100", "new": "var speed := 250"}])
	assert_true(r.ok, str(r.get("error", "")))
	assert_eq(r.content, SRC.replace("100", "250"))


func test_edits_apply_in_order() -> void:
	var r := _apply([
		{"old": "var speed := 100", "new": "var speed := 1"},
		{"old": "var speed := 1", "new": "var speed := 2"},
		{"old": "\tprint(speed)\n", "new": "\tprint(speed, jump)\n"},
	])
	assert_true(r.ok, str(r.get("error", "")))
	assert_string_contains(r.content, "var speed := 2")
	assert_string_contains(r.content, "print(speed, jump)")


func test_text_not_found_names_the_edit() -> void:
	var r := _apply([{"old": "var speed := 100", "new": "x"}, {"old": "var missing", "new": "y"}])
	assert_false(r.ok)
	assert_string_contains(r.error, "Edit 2")
	assert_string_contains(r.error, "not found")


func test_ambiguous_match_reports_count() -> void:
	var r := _apply([{"old": "var ", "new": "const "}])
	assert_false(r.ok)
	assert_string_contains(r.error, "2 times")
	assert_string_contains(r.hint, "replace_all")


func test_replace_all() -> void:
	var r := _apply([{"old": "var ", "new": "const ", "replace_all": true}])
	assert_true(r.ok, str(r.get("error", "")))
	assert_false(r.content.contains("var "))
	assert_eq(r.replacements, 2)


func test_rejects_empty_or_identical() -> void:
	assert_false(_apply([{"old": "", "new": "x"}]).ok)
	assert_false(_apply([{"old": "speed", "new": "speed", "replace_all": true}]).ok)
	assert_false(_apply([]).ok)
	assert_false(_apply([{"new": "x"}]).ok)

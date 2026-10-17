extends "res://tests/godot/test_case.gd"

const PathGuard = preload("res://addons/mcp_loop/util/path_guard.gd")


func test_read_allows_res_paths() -> void:
	assert_eq(PathGuard.check_read("res://scenes/main.tscn"), "")


func test_read_rejects_non_res() -> void:
	assert_true(PathGuard.check_read("/etc/passwd") != "")
	assert_true(PathGuard.check_read("user://save.dat") != "")
	assert_true(PathGuard.check_read("C:\\x.gd") != "")
	assert_true(PathGuard.check_read("") != "")


func test_rejects_parent_traversal() -> void:
	assert_true(PathGuard.check_read("res://../outside.gd") != "")
	assert_true(PathGuard.check_read("res://a/../../b.gd") != "")
	assert_true(PathGuard.check_write("res://a/../../b.gd", ["gd"]) != "")


func test_rejects_backslashes_and_control_chars() -> void:
	assert_true(PathGuard.check_read("res://a\\b.gd") != "")
	assert_true(PathGuard.check_read("res://a\nb.gd") != "")
	assert_true(PathGuard.check_read("res://a	b.gd") != "")


func test_write_allows_expected_extension() -> void:
	assert_eq(PathGuard.check_write("res://player.gd", ["gd"]), "")


func test_write_rejects_wrong_extension() -> void:
	assert_true(PathGuard.check_write("res://player.tscn", ["gd"]) != "")
	assert_true(PathGuard.check_write("res://project.godot", ["gd", "tscn"]) != "")


func test_write_rejects_protected_dirs() -> void:
	assert_true(PathGuard.check_write("res://.godot/x.gd", ["gd"]) != "")
	assert_true(PathGuard.check_write("res://addons/mcp_loop/plugin.gd", ["gd"]) != "")
	assert_true(PathGuard.check_write("res://.git/hooks/x.gd", ["gd"]) != "")


func test_write_allows_other_addons() -> void:
	assert_eq(PathGuard.check_write("res://addons/other/thing.gd", ["gd"]), "")


func test_normalize_collapses_dot_segments() -> void:
	assert_eq(PathGuard.normalize("res://a/./b.gd"), "res://a/b.gd")
	assert_eq(PathGuard.normalize("res://a//b.gd"), "res://a/b.gd")


func test_read_rejects_internal_dirs() -> void:
	assert_true(PathGuard.check_read("res://.godot/mcp_loop/session.json") != "")
	assert_true(PathGuard.check_read("res://.git/config") != "")

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


# ---- symlinks (Godot follows them, so they could escape the project) ----

const LINK_DIR := "res://tests/godot/tmp_link_dir"
const LINK_FILE := "res://tests/godot/tmp_link_file.gd"


func _outside_dir() -> String:
	var d := OS.get_user_data_dir().path_join("path_guard_outside")
	DirAccess.make_dir_recursive_absolute(d)
	return d


func after_each() -> void:
	for l in [LINK_DIR, LINK_FILE]:
		var abs := ProjectSettings.globalize_path(l)
		if DirAccess.dir_exists_absolute(abs) or FileAccess.file_exists(abs) or DirAccess.open("res://tests/godot").is_link(l.get_file()):
			DirAccess.remove_absolute(abs)


func test_rejects_paths_through_a_symlinked_directory() -> void:
	if OS.get_name() == "Windows":
		return
	var err := DirAccess.open("res://").create_link(_outside_dir(), ProjectSettings.globalize_path(LINK_DIR))
	assert_eq(err, OK, "test setup: create_link")
	assert_true(PathGuard.check_read(LINK_DIR + "/secret.gd") != "", "read through link")
	assert_true(PathGuard.check_write(LINK_DIR + "/evil.gd", ["gd"]) != "", "write through link")


func test_rejects_a_symlinked_file() -> void:
	if OS.get_name() == "Windows":
		return
	var target := _outside_dir().path_join("target.gd")
	var f := FileAccess.open(target, FileAccess.WRITE)
	f.store_string("extends Node\n")
	f.close()
	var err := DirAccess.open("res://").create_link(target, ProjectSettings.globalize_path(LINK_FILE))
	assert_eq(err, OK, "test setup: create_link")
	assert_true(PathGuard.check_read(LINK_FILE) != "")


func test_regular_nested_paths_still_allowed() -> void:
	assert_eq(PathGuard.check_read("res://tests/godot/test_case.gd"), "")
	assert_eq(PathGuard.check_write("res://tests/godot/new_dir/new.gd", ["gd"]), "")

extends "res://tests/godot/test_case.gd"

const ProjectCommands = preload("res://addons/mcp_loop/commands/project_commands.gd")
const BASE := "res://tests/godot/tmp_walk"


func after_each() -> void:
	var abs := ProjectSettings.globalize_path(BASE)
	DirAccess.remove_absolute(abs.path_join("loop"))
	DirAccess.remove_absolute(abs.path_join("a.txt"))
	DirAccess.remove_absolute(abs)


func test_walk_does_not_follow_symlinked_directories() -> void:
	var abs := ProjectSettings.globalize_path(BASE)
	DirAccess.make_dir_recursive_absolute(abs)
	var f := FileAccess.open(BASE.path_join("a.txt"), FileAccess.WRITE)
	f.store_string("x")
	f.close()
	# A link back to its own folder: following it would recurse forever.
	assert_eq(DirAccess.open(BASE).create_link(abs, abs.path_join("loop")), OK, "symlink created")
	var cmds := ProjectCommands.new(null)
	var out: Array = []
	var truncated: bool = cmds._walk(BASE, "*.txt", out, 50)
	assert_false(truncated)
	assert_eq(out, [BASE.path_join("a.txt")])

extends "res://tests/godot/test_case.gd"
## Every addon script must compile. Catches typos and signature clashes
## without starting the editor.

const ADDON_DIR := "res://addons/mcp_loop"


func _scripts(dir_path: String, out: Array) -> void:
	var dir := DirAccess.open(dir_path)
	for f in dir.get_files():
		if f.ends_with(".gd"):
			out.append(dir_path.path_join(f))
	for d in dir.get_directories():
		_scripts(dir_path.path_join(d), out)


func test_all_addon_scripts_compile() -> void:
	var paths: Array = []
	_scripts(ADDON_DIR, paths)
	assert_true(paths.size() >= 10, "expected the addon scripts to be found")
	for path in paths:
		var s := load(path) as GDScript
		if s == null:
			fail("could not load " + path)
			continue
		if not s.can_instantiate() and not s.is_abstract():
			fail("does not compile: " + path)

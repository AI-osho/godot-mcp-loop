extends "res://tests/godot/test_case.gd"
## Fixed internal paths need link checks too: public res:// guards intentionally cannot access .godot/.

const SessionFile = preload("res://addons/mcp_loop/bridge/session_file.gd")
const Movie = preload("res://addons/mcp_loop/commands/movie.gd")
const TestCommands = preload("res://addons/mcp_loop/commands/test_commands.gd")
var base: String


func before_each() -> void:
	base = "user://internal_security_%d_%d" % [OS.get_process_id(), Time.get_ticks_usec()]
	DirAccess.make_dir_recursive_absolute(base.path_join("outside"))


func after_each() -> void:
	_cleanup(base)


func _cleanup(path: String) -> void:
	var parent := DirAccess.open(path.get_base_dir())
	if parent != null and parent.is_link(path.get_file()):
		parent.remove(path.get_file())
		return
	var d := DirAccess.open(path)
	if d == null:
		return
	d.include_hidden = true
	for f in d.get_files():
		d.remove(f)
	for sub in d.get_directories():
		_cleanup(path.path_join(sub))
	DirAccess.remove_absolute(path)


func _store(path: String, text: String) -> void:
	var f := FileAccess.open(path, FileAccess.WRITE)
	f.store_string(text)
	f.close()


func test_session_write_refuses_a_linked_token_file() -> void:
	var sentinel := base.path_join("outside/keep.txt")
	_store(sentinel, "KEEP")
	var work := base.path_join("session")
	DirAccess.make_dir_recursive_absolute(work)
	assert_eq(DirAccess.open(work).create_link(ProjectSettings.globalize_path(sentinel), "session.json"), OK)
	var sf := SessionFile.new(work)
	sf.write(6510, "test-only-token")
	assert_eq(FileAccess.get_file_as_string(sentinel), "KEEP", "token write followed a link")


func test_session_write_does_not_change_a_hard_linked_external_file() -> void:
	if OS.get_name() == "Windows":
		return
	var sentinel := base.path_join("outside/hard-session.json")
	_store(sentinel, "KEEP")
	var original_mode := FileAccess.get_unix_permissions(sentinel)
	var work := base.path_join("hard-session")
	DirAccess.make_dir_recursive_absolute(work)
	var output: Array = []
	assert_eq(OS.execute("ln", PackedStringArray([ProjectSettings.globalize_path(sentinel), ProjectSettings.globalize_path(work.path_join("session.json"))]), output), 0)
	var sf := SessionFile.new(work)
	assert_eq(sf.write(6510, "test-only-token"), OK)
	assert_eq(FileAccess.get_file_as_string(sentinel), "KEEP", "token write changed an external hard link")
	assert_eq(FileAccess.get_unix_permissions(sentinel), original_mode, "chmod changed the external file's mode")


func test_movie_prepare_refuses_a_linked_recording_folder() -> void:
	var sentinel := base.path_join("outside/frame00000001.png")
	_store(sentinel, "KEEP")
	assert_eq(DirAccess.open(base).create_link(ProjectSettings.globalize_path(base.path_join("outside")), "movie"), OK)
	Movie.prepare(base.path_join("movie"))
	assert_true(FileAccess.file_exists(sentinel), "recording cleanup followed a link")


func test_test_prepare_refuses_a_linked_work_folder() -> void:
	var sentinel := base.path_join("outside/run.log")
	_store(sentinel, "KEEP")
	assert_eq(DirAccess.open(base).create_link(ProjectSettings.globalize_path(base.path_join("outside")), "tests"), OK)
	var cmd := TestCommands.new(tree)
	cmd._prepare(ProjectSettings.globalize_path(base.path_join("tests")))
	assert_true(FileAccess.file_exists(sentinel), "test cleanup followed a link")


func test_test_report_read_rechecks_a_replaced_parent() -> void:
	_store(base.path_join("outside/gut.xml"), "EXTERNAL_REPORT")
	assert_eq(DirAccess.open(base).create_link(ProjectSettings.globalize_path(base.path_join("outside")), "read-tests"), OK)
	var cmd := TestCommands.new(tree)
	assert_eq(cmd._read(ProjectSettings.globalize_path(base.path_join("read-tests/gut.xml"))), "", "report read followed a replaced parent")


func test_session_remove_does_not_follow_a_replaced_parent() -> void:
	var sentinel := base.path_join("outside/session.json")
	_store(sentinel, "KEEP")
	assert_eq(DirAccess.open(base).create_link(ProjectSettings.globalize_path(base.path_join("outside")), "remove-session"), OK)
	SessionFile.new(base.path_join("remove-session")).remove()
	assert_true(FileAccess.file_exists(sentinel), "session removal followed a linked parent")


func test_normal_internal_session_still_works() -> void:
	var sf := SessionFile.new(base.path_join("normal"))
	assert_eq(sf.write(6510, "test-only-token"), OK)
	assert_eq(sf.read().get("token"), "test-only-token")

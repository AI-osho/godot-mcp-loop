extends "res://tests/godot/test_case.gd"

const SessionFile = preload("res://addons/mcp_loop/bridge/session_file.gd")

const DIR := "user://test_session_file"


func after_each() -> void:
	var path := DIR.path_join("session.json")
	if FileAccess.file_exists(path):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(path))


func test_generate_token_is_64_hex_chars() -> void:
	var t := SessionFile.generate_token()
	assert_eq(t.length(), 64)
	assert_true(t.is_valid_hex_number(), "token must be hex")


func test_generate_token_is_random() -> void:
	assert_true(SessionFile.generate_token() != SessionFile.generate_token())


func test_write_then_read_round_trip() -> void:
	var sf := SessionFile.new(DIR)
	assert_eq(sf.write(6511, "abc"), OK)
	var data := sf.read()
	assert_eq(int(data["port"]), 6511)
	assert_eq(data["token"], "abc")
	assert_eq(int(data["protocol"]), 1)
	assert_eq(int(data["pid"]), OS.get_process_id())
	assert_has(data, "godot_version")
	assert_has(data, "project_path")


func test_old_writer_cannot_remove_a_successor_session_in_the_same_process() -> void:
	var first := SessionFile.new(DIR)
	var second := SessionFile.new(DIR)
	assert_eq(first.write(6510, "synthetic-generation-a"), OK)
	assert_eq(second.write(6511, "synthetic-generation-b"), OK)
	first.remove()
	assert_true(FileAccess.file_exists(second.path()), "old cleanup removed its successor")
	assert_eq(int(second.read().get("port", 0)), 6511)
	second.remove()
	assert_false(FileAccess.file_exists(second.path()))


func test_unpublished_reader_cannot_remove_an_existing_generation() -> void:
	var owner := SessionFile.new(DIR)
	assert_eq(owner.write(6510, "synthetic-owner"), OK)
	SessionFile.new(DIR).remove()
	assert_true(FileAccess.file_exists(owner.path()))
	owner.remove()
	assert_false(FileAccess.file_exists(owner.path()))


func test_successful_republication_updates_the_cleanup_generation() -> void:
	var owner := SessionFile.new(DIR)
	assert_eq(owner.write(6510, "synthetic-first"), OK)
	assert_eq(owner.write(6511, "synthetic-second"), OK)
	owner.remove()
	assert_false(FileAccess.file_exists(owner.path()))


func test_cleanup_preserves_malformed_and_oversized_replacements() -> void:
	var owner := SessionFile.new(DIR)
	for replacement in ["{", "x".repeat(SessionFile.MAX_SESSION_BYTES + 1)]:
		assert_eq(owner.write(6510, "synthetic-owner"), OK)
		var f := FileAccess.open(owner.path(), FileAccess.WRITE)
		f.store_string(replacement)
		f.close()
		f = null
		assert_eq(owner.read(), {})
		owner.remove()
		assert_true(FileAccess.file_exists(owner.path()), "uncertain replacement must not be deleted")


func test_remove_deletes_file() -> void:
	var sf := SessionFile.new(DIR)
	sf.write(6510, "abc")
	assert_true(FileAccess.file_exists(sf.path()))
	sf.remove()
	assert_false(FileAccess.file_exists(sf.path()))


func test_read_missing_returns_empty() -> void:
	var sf := SessionFile.new(DIR)
	sf.remove()
	assert_eq(sf.read(), {})


func test_session_file_is_private_to_the_user() -> void:
	if OS.get_name() == "Windows":
		return
	var sf := SessionFile.new(DIR)
	sf.write(6510, "secret")
	var perms := FileAccess.get_unix_permissions(sf.path())
	assert_eq(perms & 0x3F, 0, "group/other must have no access (perms=%o)" % perms)

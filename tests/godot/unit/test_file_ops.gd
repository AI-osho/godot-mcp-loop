extends "res://tests/godot/test_case.gd"

const Context = preload("res://addons/mcp_loop/commands/context.gd")

# Exercise native disk I/O, without asking a non-editor test process to refresh editor UI state.
class DiskOnlyOps extends Context.FileOps:
	func _refresh(_path: String, _content: String) -> void:
		pass
	func _refresh_binary(_path: String) -> void:
		pass

var _dir := ""
var _outside := ""

func after_each() -> void:
	if _dir != "":
		var dir := DirAccess.open(_dir)
		if dir != null:
			dir.include_hidden = true
			for name in dir.get_files():
				DirAccess.remove_absolute(_dir.path_join(name))
		DirAccess.remove_absolute(_dir)
	if _outside != "":
		DirAccess.remove_absolute(_outside)

func test_snapshot_preserves_empty_and_binary_originals() -> void:
	_dir = "res://qa/gml-snapshot-%d-%d" % [OS.get_process_id(), Time.get_ticks_usec()]
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(_dir))
	var path := _dir.path_join("original.txt")
	var ops := DiskOnlyOps.new()
	for data in [PackedByteArray(), PackedByteArray([0, 255, 10])]:
		var f := FileAccess.open(path, FileAccess.WRITE)
		f.store_buffer(data)
		f.close()
		f = null
		var snapshot := ops.snapshot_bytes(path)
		assert_true(snapshot.ok, "an empty file is not a failed read")
		if snapshot.ok:
			assert_eq(snapshot.result.bytes, data)
	assert_true(ops.touched_paths.is_empty(), "reading a snapshot is not a disk edit")


func test_text_replacement_does_not_modify_an_external_hardlink_name() -> void:
	if OS.get_name() == "Windows":
		return # The ln-based native fixture is qualified on POSIX, not a native Windows claim.
	var tag := "gml-file-ops-%d-%d" % [OS.get_process_id(), Time.get_ticks_usec()]
	_dir = "res://qa/" + tag
	var scratch := OS.get_environment("TMPDIR")
	assert_true(scratch.is_absolute_path(), "test requires its caller's isolated TMPDIR")
	if not scratch.is_absolute_path():
		return
	_outside = scratch.path_join(tag + ".gd")
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(_dir))
	var keep := FileAccess.open(_outside, FileAccess.WRITE)
	keep.store_string("KEEP")
	keep.close()
	var target := _dir.path_join("linked.gd")
	assert_eq(OS.execute("ln", [_outside, ProjectSettings.globalize_path(target)]), 0)
	var ops := DiskOnlyOps.new()
	ops.write_text(target, "NEW")
	assert_eq(FileAccess.get_file_as_string(_outside), "KEEP", "replacement must detach the selected name from the external inode")
	assert_eq(FileAccess.get_file_as_string(target), "NEW", "positive control: the selected project file must still be updated")

func test_binary_replacement_does_not_modify_an_external_hardlink_name() -> void:
	if OS.get_name() == "Windows":
		return
	var tag := "gml-file-ops-%d-%d" % [OS.get_process_id(), Time.get_ticks_usec()]
	_dir = "res://qa/" + tag
	var scratch := OS.get_environment("TMPDIR")
	assert_true(scratch.is_absolute_path(), "test requires its caller's isolated TMPDIR")
	if not scratch.is_absolute_path():
		return
	_outside = scratch.path_join(tag + ".png")
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(_dir))
	var before := PackedByteArray([1, 0, 255])
	var keep := FileAccess.open(_outside, FileAccess.WRITE)
	keep.store_buffer(before)
	keep.close()
	var target := _dir.path_join("linked.png")
	assert_eq(OS.execute("ln", [_outside, ProjectSettings.globalize_path(target)]), 0)
	var ops := DiskOnlyOps.new()
	var replacement := PackedByteArray([2, 0, 128])
	ops.write_bytes(target, replacement)
	assert_eq(FileAccess.get_file_as_bytes(_outside), before, "binary writes must also detach the selected name")
	assert_eq(FileAccess.get_file_as_bytes(target), replacement)
	var dir := DirAccess.open(_dir)
	dir.include_hidden = true
	assert_eq(dir.get_files(), PackedStringArray(["linked.png"]), "no replacement scratch files may survive a successful write")

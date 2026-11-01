extends RefCounted
## Writes the connection info the MCP server needs to find this editor:
## <dir>/session.json = {port, token, protocol, pid, godot_version, project_path}.
## Default dir is res://.godot/mcp_loop (ignored by VCS, local to the project).

const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")
const PathGuard = preload("res://addons/mcp_loop/util/path_guard.gd")
const DEFAULT_DIR := "res://.godot/mcp_loop"
const MAX_SESSION_BYTES := 64 * 1024

var _dir: String
var _written_digest := PackedByteArray()


func _init(dir: String = DEFAULT_DIR) -> void:
	_dir = dir


static func generate_token() -> String:
	return Crypto.new().generate_random_bytes(32).hex_encode()


func path() -> String:
	return _dir.path_join("session.json")


const OWNER_ONLY_FILE := FileAccess.UNIX_READ_OWNER | FileAccess.UNIX_WRITE_OWNER
const OWNER_ONLY_DIR := OWNER_ONLY_FILE | FileAccess.UNIX_EXECUTE_OWNER


func write(port: int, token: String) -> Error:
	if PathGuard.check_internal_path(path()) != "":
		return ERR_UNAUTHORIZED
	var abs_dir := ProjectSettings.globalize_path(_dir)
	var mk := DirAccess.make_dir_recursive_absolute(abs_dir)
	if mk != OK:
		return mk
	# Detach any old inode before chmod or writing: a hard link must not expose the token or change another file's mode.
	if FileAccess.file_exists(path()):
		var removed := DirAccess.remove_absolute(ProjectSettings.globalize_path(path()))
		if removed != OK:
			return removed
	# Create empty first and restrict it before the secret is written.
	if OS.get_name() != "Windows":
		var dir_perm := FileAccess.set_unix_permissions(abs_dir, OWNER_ONLY_DIR)
		if dir_perm != OK:
			return dir_perm
		if not FileAccess.file_exists(path()):
			var empty := FileAccess.open(path(), FileAccess.WRITE)
			if empty == null:
				return FileAccess.get_open_error()
			empty.close()
		var perm_err := FileAccess.set_unix_permissions(path(), OWNER_ONLY_FILE)
		if perm_err != OK:
			return perm_err
	var f := FileAccess.open(path(), FileAccess.WRITE)
	if f == null:
		return FileAccess.get_open_error()
	var contents := JSON.stringify({
		"port": port,
		"token": token,
		"protocol": Protocol.VERSION,
		"pid": OS.get_process_id(),
		"godot_version": Engine.get_version_info().get("string", ""),
		"project_path": ProjectSettings.globalize_path("res://"),
	}, "  ").to_utf8_buffer()
	f.store_buffer(contents)
	f.flush()
	var error := f.get_error()
	f.close()
	f = null # Editor safe-save publishes on reference release, before the read-back below.
	if error != OK:
		return error
	if _read_bytes() != contents:
		return ERR_CANT_CREATE
	_written_digest = _fingerprint(contents)
	return OK


func _read_bytes() -> PackedByteArray:
	if PathGuard.check_internal_path(path()) != "" or not FileAccess.file_exists(path()):
		return PackedByteArray()
	var f := FileAccess.open(path(), FileAccess.READ)
	if f == null:
		return PackedByteArray()
	var length := f.get_length()
	if length <= 0 or length > MAX_SESSION_BYTES:
		return PackedByteArray()
	return f.get_buffer(length)


static func _fingerprint(contents: PackedByteArray) -> PackedByteArray:
	var hashing := HashingContext.new()
	hashing.start(HashingContext.HASH_SHA256)
	hashing.update(contents)
	return hashing.finish()


func read() -> Dictionary:
	var contents := _read_bytes()
	if contents.is_empty():
		return {}
	var parser := JSON.new()
	if parser.parse(contents.get_string_from_utf8()) != OK:
		return {}
	var parsed: Variant = parser.data
	return parsed if typeof(parsed) == TYPE_DICTIONARY else {}


func remove() -> void:
	if _written_digest.is_empty() or PathGuard.check_internal_path(path()) != "":
		return
	# PID is shared by plugin generations; match the full published generation without logging its credentials.
	var contents := _read_bytes()
	if contents.is_empty() or _fingerprint(contents) != _written_digest:
		return
	if PathGuard.check_internal_path(path()) == "" and DirAccess.remove_absolute(ProjectSettings.globalize_path(path())) == OK:
		_written_digest = PackedByteArray()

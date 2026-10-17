extends RefCounted
## Writes the connection info the MCP server needs to find this editor:
## <dir>/session.json = {port, token, protocol, pid, godot_version, project_path}.
## Default dir is res://.godot/mcp_loop (ignored by VCS, local to the project).

const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")
const DEFAULT_DIR := "res://.godot/mcp_loop"

var _dir: String


func _init(dir: String = DEFAULT_DIR) -> void:
	_dir = dir


static func generate_token() -> String:
	return Crypto.new().generate_random_bytes(32).hex_encode()


func path() -> String:
	return _dir.path_join("session.json")


const OWNER_ONLY_FILE := FileAccess.UNIX_READ_OWNER | FileAccess.UNIX_WRITE_OWNER
const OWNER_ONLY_DIR := OWNER_ONLY_FILE | FileAccess.UNIX_EXECUTE_OWNER


func write(port: int, token: String) -> Error:
	var abs_dir := ProjectSettings.globalize_path(_dir)
	var mk := DirAccess.make_dir_recursive_absolute(abs_dir)
	if mk != OK:
		return mk
	# The token must never sit in a file other users can read. Create the file
	# empty, restrict it, then write: Godot's save path keeps the existing mode.
	if OS.get_name() != "Windows":
		FileAccess.set_unix_permissions(abs_dir, OWNER_ONLY_DIR)
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
	f.store_string(JSON.stringify({
		"port": port,
		"token": token,
		"protocol": Protocol.VERSION,
		"pid": OS.get_process_id(),
		"godot_version": Engine.get_version_info().get("string", ""),
		"project_path": ProjectSettings.globalize_path("res://"),
	}, "  "))
	f.close()
	return OK


func read() -> Dictionary:
	if not FileAccess.file_exists(path()):
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path()))
	return parsed if typeof(parsed) == TYPE_DICTIONARY else {}


func remove() -> void:
	if FileAccess.file_exists(path()):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(path()))

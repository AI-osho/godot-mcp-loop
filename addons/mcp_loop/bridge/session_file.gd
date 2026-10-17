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


func write(port: int, token: String) -> Error:
	var abs_dir := ProjectSettings.globalize_path(_dir)
	var mk := DirAccess.make_dir_recursive_absolute(abs_dir)
	if mk != OK:
		return mk
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

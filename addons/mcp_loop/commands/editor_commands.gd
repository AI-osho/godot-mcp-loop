@tool
extends RefCounted
## Editor/project level commands: editor.status

const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")


static func register(router: RefCounted) -> void:
	router.register("editor.status", _status)


static func _status(_p: Dictionary) -> Dictionary:
	var root := EditorInterface.get_edited_scene_root()
	return Protocol.ok({
		"project_name": ProjectSettings.get_setting("application/config/name", ""),
		"main_scene": ProjectSettings.get_setting("application/run/main_scene", ""),
		"edited_scene": root.scene_file_path if root != null else null,
		"open_scenes": Array(EditorInterface.get_open_scenes()),
		"playing": EditorInterface.is_playing_scene(),
	})

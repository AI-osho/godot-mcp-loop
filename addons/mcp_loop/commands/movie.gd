@tool
extends RefCounted
## Movie Maker recording for game.run {movie: {fps}}: the game writes every frame as
## res://.godot/mcp_loop/movie/frameNNNNNNNN.png (plus frame.wav). The folder is fixed so the agent cannot make the
## game write files anywhere else; the file tools cannot reach .godot/.

const DIR := "res://.godot/mcp_loop/movie"
const KEY_FILE := "editor/movie_writer/movie_file"
const KEY_FPS := "editor/movie_writer/fps"


static func supported() -> bool:
	return EditorInterface.has_method("set_movie_maker_enabled")


## Deletes the frames and sound of an earlier recording in dir (nothing else); returns dir's absolute path.
static func prepare(dir: String = DIR) -> String:
	DirAccess.make_dir_recursive_absolute(dir)
	var frame := RegEx.create_from_string("^frame\\d{8}\\.png$")
	var d := DirAccess.open(dir)
	if d != null:
		for f in d.get_files():
			if frame.search(f) != null or f == "frame.wav":
				d.remove(f)
	return ProjectSettings.globalize_path(dir)


## Turns Movie Maker on for the next play; returns what end() restores. The editor reads these settings when it
## builds the game's command line (--write-movie, --fixed-fps), so they are restored right after the play call.
static func begin(fps: int, file: String) -> Dictionary:
	var saved := {
		"file": ProjectSettings.get_setting(KEY_FILE, ""),
		"fps": ProjectSettings.get_setting(KEY_FPS, 60),
		"enabled": EditorInterface.call("is_movie_maker_enabled"),
	}
	ProjectSettings.set_setting(KEY_FILE, file)
	ProjectSettings.set_setting(KEY_FPS, fps)
	EditorInterface.call("set_movie_maker_enabled", true)
	return saved


static func end(saved: Dictionary) -> void:
	ProjectSettings.set_setting(KEY_FILE, saved.file)
	ProjectSettings.set_setting(KEY_FPS, saved.fps)
	EditorInterface.call("set_movie_maker_enabled", saved.enabled)

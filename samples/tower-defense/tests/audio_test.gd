extends SceneTree
func _init() -> void:
	if not ResourceLoader.exists("res://scripts/audio.gd"):
		print("FAIL: original game audio player is missing")
		quit(1)
		return
	var script = load("res://scripts/audio.gd")
	var sound = script.new()
	var keys := ["place","shot","mist","kill","base_hit","victory","defeat","click"]
	var failed := 0
	for key in keys:
		if not sound.streams.has(key) or sound.streams[key].get_length() <= 0.05:
			print("FAIL: nonempty original effect ",key)
			failed += 1
	sound.free()
	print("AUDIO_RESOURCE_TEST failures=", failed)
	quit(1 if failed else 0)

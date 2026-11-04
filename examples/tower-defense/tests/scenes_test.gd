extends SceneTree
var failures := 0
func check(ok: bool, message: String) -> void:
	if not ok:
		failures += 1
		print("FAIL: " + message)
func _init() -> void:
	for spec in [["title", "Screen/Start"], ["game", "World/Actors"], ["results", "Screen/Retry"]]:
		var path: String = "res://examples/tower-defense/scenes/%s.tscn" % spec[0]
		if not ResourceLoader.exists(path):
			check(false, "missing playable scene: " + path)
			continue
		var packed = load(path)
		var n = packed.instantiate()
		check(n.has_node(spec[1]), "tree contains " + spec[1])
		check(n.has_method("summary"), "root has pure summary: " + spec[0])
		n.free()
	print("SCENES_TEST failures=", failures)
	quit(1 if failures else 0)

extends RefCounted

static var save_namespace := "user://normal/"
static var input_receipts: Dictionary = {"title_start":0, "title_return":0, "retry":0}
static var last_result: Dictionary = {}
static var configured := false
static var sound_node: Node = null

static func audio(root: Node) -> Node:
	if not is_instance_valid(sound_node):
		var Audio = load("res://scripts/audio.gd")
		sound_node = Audio.new()
		sound_node.name = "TreeTDSound"
		root.get_tree().root.add_child.call_deferred(sound_node)
	return sound_node

static func sound_summary() -> Dictionary:
	return sound_node.summary() if is_instance_valid(sound_node) else {}

static func configure() -> void:
	if configured:
		return
	configured = true
	for arg in OS.get_cmdline_user_args():
		var pieces: PackedStringArray = arg.split("=", true, 1)
		if pieces.size() != 2:
			continue
		var label := pieces[1]
		if label.is_empty() or label.length() > 64:
			continue
		if not label.replace("_", "").replace("-", "").is_valid_identifier():
			continue
		if pieces[0] == "--tree-td-test-run":
			save_namespace = "user://test_runs/%s/" % label
		elif pieces[0] == "--tree-td-playtest":
			save_namespace = "user://playtests/%s/" % label

static func window(root: Node) -> void:
	configure()
	# The integrated repository can start with a different logical canvas, not only a different window size.
	root.get_window().content_scale_size = Vector2i(960,640)
	root.get_window().content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS
	root.get_window().title = "灯畑の番人"
	root.get_window().min_size = Vector2i(960,640)
	root.get_window().max_size = Vector2i(960,640)
	root.get_window().size = Vector2i(960,640)

static func receipt(key: String) -> void:
	input_receipts[key] = input_receipts.get(key,0) + 1

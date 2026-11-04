extends SceneTree
## Native portability test: a repository-sized Window must become this sample's logical 960x640 canvas.

func _initialize() -> void:
	_run.call_deferred()

func _run() -> void:
	root.size = Vector2i(1152, 648)
	root.content_scale_size = Vector2i(1152, 648)
	root.content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS
	var title = load("res://examples/tower-defense/scenes/title.tscn").instantiate()
	root.add_child(title)
	current_scene = title
	await process_frame
	await process_frame
	var passed := root.content_scale_size == Vector2i(960, 640) and root.size == Vector2i(960, 640)
	print("TD_WINDOW_CHECK ", JSON.stringify({"passed":passed,"logical":[root.content_scale_size.x,root.content_scale_size.y],"window":[root.size.x,root.size.y]}))
	var session = load("res://examples/tower-defense/scripts/session.gd")
	if is_instance_valid(session.sound_node):
		await session.sound_node.shutdown()
	quit(0 if passed else 2)

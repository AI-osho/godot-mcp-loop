extends Node
const Session = preload("res://examples/tower-defense/scripts/session.gd")
func _ready() -> void:
	Session.configured = true
	Session.save_namespace = "user://test_runs/creator_mouse_routes/"
	get_tree().change_scene_to_file.call_deferred("res://examples/tower-defense/scenes/title.tscn")
func summary() -> Dictionary:
	return {"state":"boot","save_namespace":Session.save_namespace,"paused":false}

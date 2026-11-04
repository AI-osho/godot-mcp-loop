extends Control
const Session = preload("res://scripts/session.gd")
const GardenSkin = preload("res://scripts/skin.gd")
var state := "title"

func _ready() -> void:
	Session.window(self)
	GardenSkin.apply(self)
	Session.audio(self)
	$Screen/Start.pressed.connect(_start)
	$Screen/Quit.pressed.connect(_quit)

func _start() -> void:
	Session.receipt("title_start")
	Session.sound_node.play("click")
	Session.last_result = {}
	get_tree().change_scene_to_file("res://scenes/game.tscn")

func _quit() -> void:
	await Session.sound_node.shutdown()
	get_tree().quit()

func summary() -> Dictionary:
	return {"state":"title", "paused":false, "input_receipts":Session.input_receipts.duplicate(true), "save_namespace":Session.save_namespace,"sound":Session.sound_summary()}

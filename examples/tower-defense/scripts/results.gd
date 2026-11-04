extends Control
const Session = preload("res://examples/tower-defense/scripts/session.gd")
const GardenSkin = preload("res://examples/tower-defense/scripts/skin.gd")
var state := "defeat"

func _ready() -> void:
	Session.window(self)
	GardenSkin.apply(self)
	state = Session.last_result.get("state","defeat")
	var sound: Node = Session.audio(self)
	sound.play(state)
	$Screen/Retry.pressed.connect(_retry)
	$Screen/ReturnTitle.pressed.connect(_title)
	if state == "victory":
		$Screen/Heading.text = "夜明けをまもった"
		$Screen/Message.text = "ひかりの実は、明日も育ちます。\n3つの波をしのぎました。"
	else:
		$Screen/Heading.text = "灯りが消えてしまった"
		$Screen/Message.text = "もう一度、庭をまもりましょう。\n灯火のそばに霧鈴を置くと効果的です。"
	var s := Session.last_result
	$Screen/Stats.text = "耐久 %d / 8     撃破 %d 体\n配置 %d 基     到達ウェーブ %d / 3\n戦闘時間 %.1f 秒" % [s.get("base_health",0),s.get("kills",0),s.get("tower_count",0),s.get("wave",0),s.get("active_ticks",0)/60.0]

func _retry() -> void:
	Session.receipt("retry")
	Session.sound_node.play("click")
	Session.last_result = {}
	get_tree().change_scene_to_file("res://examples/tower-defense/scenes/game.tscn")

func _title() -> void:
	Session.receipt("title_return")
	Session.sound_node.play("click")
	get_tree().change_scene_to_file("res://examples/tower-defense/scenes/title.tscn")

func summary() -> Dictionary:
	var s: Dictionary = Session.last_result.duplicate(true)
	s["state"] = state
	s["paused"] = false
	s["session_receipts"] = Session.input_receipts.duplicate(true)
	s["save_namespace"] = Session.save_namespace
	s["sound"] = Session.sound_summary()
	return s

extends Node2D
const Session = preload("res://scripts/session.gd")
const GardenSkin = preload("res://scripts/skin.gd")
const Rules = preload("res://scripts/rules.gd")
var rules = Rules.new()
var selected_tower := "none"
var sound: Node = null
var state := "ready"
var input_receipts: Dictionary = {"select":0,"board_click":0,"placed":0,"rejected":0,"wave":0,"pause":0,"resume":0,"cancel":0,"mouse_left":0,"mouse_right":0}
var last_mouse := Vector2.ZERO
var hovered_pad := -1
var effects: Array[Dictionary] = []
var message := "石台をクリック\n先に塔を置こう"
var message_timer := 0.0
var transition_pending := false
@onready var ui: Control = $World/HUD/UI

func _ready() -> void:
	Session.window(self)
	GardenSkin.apply(ui)
	sound = Session.audio(self)
	$World/Actors.garden = self
	ui.get_node("Amber").pressed.connect(_select.bind("amber"))
	ui.get_node("Mist").pressed.connect(_select.bind("mist"))
	ui.get_node("NextWave").pressed.connect(_next_wave)
	ui.get_node("Pause").pressed.connect(_toggle_pause)
	ui.get_node("PauseOverlay/Resume").pressed.connect(_resume)
	ui.get_node("PauseOverlay/ReturnTitle").pressed.connect(_return_title)
	_refresh_ui()

func _input(event: InputEvent) -> void:
	if event is InputEventMouse:
		last_mouse = event.position
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_LEFT:
			input_receipts.mouse_left += 1
		elif event.button_index == MOUSE_BUTTON_RIGHT:
			input_receipts.mouse_right += 1

func _unhandled_input(event: InputEvent) -> void:
	if rules.paused or transition_pending:
		return
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_RIGHT:
			selected_tower = "none"
			input_receipts.cancel += 1
			_refresh_ui()
			return
		if event.button_index != MOUSE_BUTTON_LEFT or not Rect2(16,86,720,520).has_point(event.position):
			return
		input_receipts.board_click += 1
		var pad := _pad_at(event.position)
		var outcome: String = rules.place(selected_tower,pad)
		if outcome == "placed":
			input_receipts.placed += 1
			sound.play("place")
			message = "%s に配置しました" % String.chr(65+pad)
			_add_effect({"kind":"place","pos":Rules.SPOTS[pad]})
		elif outcome == "occupied":
			input_receipts.rejected += 1
			message = "そこには塔があります"
		elif outcome == "funds":
			input_receipts.rejected += 1
			message = "資金が足りません\n撃破すると増えます"
		else:
			input_receipts.rejected += 1
			message = "塔を選んでから\n石台 A〜H をクリック"
		message_timer = 2.0
		_refresh_ui()

func _pad_at(point: Vector2) -> int:
	for i in range(Rules.SPOTS.size()):
		if point.distance_to(Rules.SPOTS[i]) <= 26.0:
			return i
	return -1

func _select(kind: String) -> void:
	if rules.paused or transition_pending:
		return
	selected_tower = kind
	sound.play("click")
	input_receipts.select += 1
	message = "石台にマウスを重ねると\n射程が見えます"
	message_timer = 2.0
	_refresh_ui()

func _next_wave() -> void:
	if rules.start_next_wave():
		input_receipts.wave += 1
		sound.play("click")
		message = "煤虫が来ます！\n道の先頭を狙います"
		message_timer = 2.0
		state = rules.state
		_refresh_ui()

func _toggle_pause() -> void:
	if transition_pending:
		return
	rules.paused = not rules.paused
	sound.play("click")
	input_receipts["pause" if rules.paused else "resume"] += 1
	ui.get_node("PauseOverlay").visible = rules.paused
	_refresh_ui()

func _resume() -> void:
	if rules.paused:
		_toggle_pause()

func _return_title() -> void:
	Session.receipt("title_return")
	get_tree().change_scene_to_file("res://scenes/title.tscn")

func _physics_process(dt: float) -> void:
	if transition_pending:
		return
	hovered_pad = _pad_at(last_mouse)
	if not rules.paused:
		var before: String = rules.state
		rules.step(dt)
		message_timer = maxf(0.0,message_timer-dt)
		for fx in effects:
			fx.ttl -= dt
		effects = effects.filter(func(fx): return fx.ttl > 0.0)
		for e in rules.events:
			if e.kind in ["shot","mist","kill","base_hit"]:
				sound.play(e.kind)
			_add_effect(e)
		if before == "playing" and rules.state == "ready":
			message = "波をしのぎました！\n準備金 +25"
			message_timer = 3.0
		state = rules.state
		if state in ["victory","defeat"]:
			transition_pending = true
			Session.last_result = summary()
			_show_results.call_deferred()
	_refresh_ui()
	$World/Actors.queue_redraw()

func _add_effect(event: Dictionary) -> void:
	if event.kind in ["shot","mist"]:
		return
	var fx := event.duplicate(true)
	fx["ttl"] = 0.45 if event.kind == "kill" else 0.28
	fx["life"] = fx.ttl
	effects.append(fx)

func _show_results() -> void:
	get_tree().change_scene_to_file("res://scenes/results.tscn")

func _refresh_ui() -> void:
	ui.get_node("Wave").text = "波 %d / 3" % rules.wave
	ui.get_node("Health").text = "耐久 %d / 8" % rules.base_health
	ui.get_node("Coins").text = "資金 %d" % rules.coins
	ui.get_node("Pause").text = "再開" if rules.paused else "一時停止"
	ui.get_node("Amber").disabled = rules.paused
	ui.get_node("Mist").disabled = rules.paused
	ui.get_node("NextWave").disabled = rules.paused or rules.state != "ready"
	ui.get_node("NextWave").text = "第%d波を呼ぶ" % (rules.wave+1) if rules.state == "ready" else "襲来中…"
	var name_text := {"none":"なし","amber":"灯火塔","mist":"霧鈴塔"}
	ui.get_node("Selected").text = "選択："+name_text[selected_tower]
	for pair in [["Amber","amber"],["Mist","mist"]]:
		var b: Button = ui.get_node(pair[0])
		if selected_tower == pair[1]:
			b.add_theme_stylebox_override("normal",GardenSkin.style(Color("366455"),Color("f6bf65") if pair[1] == "amber" else Color("b0e7df")))
		else:
			b.remove_theme_stylebox_override("normal")
	if message_timer > 0.0 or rules.wave == 0:
		ui.get_node("Status").text = message
	elif rules.state == "playing":
		ui.get_node("Status").text = "残り %d 体 / 撃破 %d\nウェーブ中も配置できます" % [rules.enemies.size()+rules.pending.size(),rules.kills]
	else:
		ui.get_node("Status").text = "撃破 %d 体\n次の波を呼びましょう" % rules.kills

func summary() -> Dictionary:
	var s: Dictionary = rules.summary()
	s["selected_tower"] = selected_tower
	s["input_receipts"] = input_receipts.duplicate(true)
	s["session_receipts"] = Session.input_receipts.duplicate(true)
	s["save_namespace"] = Session.save_namespace
	s["last_mouse"] = [last_mouse.x,last_mouse.y]
	s["effects"] = effects.size()
	s["sound"] = Session.sound_summary()
	return s

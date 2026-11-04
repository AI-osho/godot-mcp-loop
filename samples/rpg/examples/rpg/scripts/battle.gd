extends Node
# ===============================================================
# 星剣のルカ - front-view battle (fixed 60 Hz, frame-counted)
# ===============================================================

const Data = preload("res://examples/rpg/scripts/data.gd")
const NesWin = preload("res://examples/rpg/scripts/nes_window.gd")
const Tri = preload("res://examples/rpg/scripts/tri.gd")
const Visuals = preload("res://examples/rpg/scripts/visuals.gd")

const CMD_NAMES := ["たたかう", "じゅもん", "どうぐ", "にげる"]

var game: Node
var active := false
var phase := "idle"          # idle / intro / menu / resolving / victory / defeat / escaped
var monster_id := ""
var monster: Dictionary = {}
var monster_hp := 0
var monster_max_hp := 0
var menu_mode := "command"   # command / spell / item
var selected := 0
var turn := 0

var last_damage := 0
var last_heal := 0
var last_enemy_damage := 0
var last_enemy_action := ""
var last_flee_success := false
var flee_attempts := 0
var boss_special_used := 0
var rewards: Dictionary = {}

var _view: Control
var _status_win: Control
var _cmd_win: Control
var _msg_win: Control
var _msg_label: Label
var _status_name: Label
var _status_hp: Label
var _status_mp: Label
var _cmd_labels: Array[Label] = []
var _cmd_cursor: Control
var _msg_cursor: Control
var _monster_sprite: TextureRect
var _bg

var _msg_queue: Array = []
var _msg_text := ""
var _typed := 0
var _msg_active := false
var _msg_hold := 0
var _after_msg: Callable = Callable()
var _final_wait := ""
var _flash := 0
var _frame := 0

func setup(game_ref: Node, ui_root: Control) -> void:
	game = game_ref
	_build_ui(ui_root)

func _build_ui(ui_root: Control) -> void:
	_view = Control.new()
	_view.name = "BattleView"
	_view.size = Vector2(Data.SCREEN_W, Data.SCREEN_H)
	_view.visible = false
	_view.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_view.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	_view.z_index = 10
	ui_root.add_child(_view)

	_bg = Visuals.BattleBackdrop.new()
	_bg.size = Vector2(Data.SCREEN_W, Data.SCREEN_H)
	_bg.visible = true
	_view.add_child(_bg)

	_monster_sprite = TextureRect.new()
	_monster_sprite.name = "Monster"
	_monster_sprite.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_monster_sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	_monster_sprite.stretch_mode = TextureRect.STRETCH_SCALE
	_monster_sprite.visible = false
	_view.add_child(_monster_sprite)

	_status_win = NesWin.new()
	_status_win.position = Vector2(4, 150)
	_status_win.size = Vector2(150, 86)
	_view.add_child(_status_win)
	_status_name = _label(_status_win, Vector2(10, 6), "ルカ  Lv 1", 128)
	_status_hp = _label(_status_win, Vector2(10, 24), "HP 30/30", 128)
	_status_mp = _label(_status_win, Vector2(10, 42), "MP 10/10", 128)

	_cmd_win = NesWin.new()
	_cmd_win.position = Vector2(158, 150)
	_cmd_win.size = Vector2(94, 86)
	_view.add_child(_cmd_win)
	for i in 4:
		var l := _label(_cmd_win, Vector2(16, 6 + i * 18), "", 74)
		_cmd_labels.append(l)
	_cmd_cursor = Tri.new()
	_cmd_cursor.position = Vector2(7, 9)
	_cmd_win.add_child(_cmd_cursor)

	_msg_win = NesWin.new()
	_msg_win.position = Vector2(4, 150)
	_msg_win.size = Vector2(248, 86)
	_msg_win.visible = false
	_msg_win.z_index = 2
	_view.add_child(_msg_win)
	_msg_label = _label(_msg_win, Vector2(10, 6), "", 226, 72)
	_msg_cursor = Tri.new()
	_msg_cursor.points_right = false
	_msg_cursor.position = Vector2(236, 74)
	_msg_cursor.visible = false
	_msg_win.add_child(_msg_cursor)

func _label(parent: Control, pos: Vector2, text: String, w: float, h: float = 18.0) -> Label:
	var l := Label.new()
	l.position = pos
	l.size = Vector2(w, h)
	l.text = text
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	l.add_theme_font_size_override("font_size", 12)
	l.add_theme_color_override("font_color", Color.WHITE)
	l.add_theme_constant_override("line_spacing", 1)
	parent.add_child(l)
	return l

# ---------------------------------------------------------------
# start / tick
# ---------------------------------------------------------------

func begin(monster_key: String) -> void:
	monster_id = monster_key
	monster = (Data.MONSTERS[monster_key] as Dictionary).duplicate(true)
	monster_hp = int(monster["hp"])
	monster_max_hp = monster_hp
	active = true
	phase = "intro"
	menu_mode = "command"
	selected = 0
	turn = 0
	last_damage = 0
	last_heal = 0
	last_enemy_damage = 0
	last_enemy_action = ""
	last_flee_success = false
	flee_attempts = 0
	boss_special_used = 0
	rewards = {}
	_msg_queue.clear()
	_msg_active = false
	_final_wait = ""
	_flash = 0
	_view.visible = true
	_status_win.visible = true
	_cmd_win.visible = false
	_msg_win.visible = false
	_msg_cursor.visible = false
	_monster_sprite.visible = true
	var tex: Texture2D = load(monster["sprite"])
	_monster_sprite.texture = tex
	var sz: int = int(monster.get("size", 32))
	_monster_sprite.size = Vector2(sz, sz)
	_monster_sprite.position = Vector2(128 - sz * 0.5, 128 - sz)
	_update_status()
	_show_messages(["%sが あらわれた！" % monster["name"]], Callable(self, "_open_menu"))

func tick() -> void:
	_frame += 1
	if not active:
		return
	if _bg != null:
		_bg.set_frame(_frame)
	if _flash > 0:
		_flash -= 1
		_monster_sprite.visible = (_flash / 3) % 2 == 0
	else:
		_monster_sprite.visible = true
	_update_status()
	if _final_wait != "":
		_msg_cursor.visible = (_frame / 12) % 2 == 0
		if Input.is_action_just_pressed("rpg_confirm"):
			var result := _final_wait
			_final_wait = ""
			_do_finish(result)
		return
	if _msg_active:
		_tick_message()
		return
	if phase == "menu":
		_tick_menu()

func _update_status() -> void:
	if game == null:
		return
	var p: Dictionary = game.player
	_status_name.text = "%s  Lv %d" % [p["name"], p["level"]]
	_status_hp.text = "HP %d/%d" % [p["hp"], p["max_hp"]]
	_status_mp.text = "MP %d/%d" % [p["mp"], p["max_mp"]]

# ---------------------------------------------------------------
# messages
# ---------------------------------------------------------------

func _show_messages(pages: Array, after: Callable) -> void:
	_msg_queue = pages.duplicate()
	_after_msg = after
	_msg_win.visible = true
	_msg_cursor.visible = false
	_status_win.visible = false
	_cmd_win.visible = false
	_next_message()

func _next_message() -> void:
	if _msg_queue.is_empty():
		_msg_active = false
		_msg_win.visible = false
		_msg_cursor.visible = false
		_status_win.visible = true
		var cb := _after_msg
		_after_msg = Callable()
		if cb.is_valid():
			cb.call()
		return
	_msg_text = str(_msg_queue.pop_front())
	_typed = 0
	_msg_hold = 0
	_msg_active = true
	_msg_cursor.visible = false
	if game.message_instant or game.fast_mode:
		_typed = _msg_text.length()
	_msg_label.text = _msg_text.substr(0, _typed)

func _tick_message() -> void:
	if _typed < _msg_text.length():
		if game.fast_mode:
			_typed = _msg_text.length()
		else:
			_typed += 1
		_msg_label.text = _msg_text.substr(0, _typed)
		return
	_msg_hold += 1
	_msg_cursor.visible = (_frame / 12) % 2 == 0
	if Input.is_action_just_pressed("rpg_confirm"):
		_msg_hold = 999
	var wait_frames := 2 if game.fast_mode else 50
	if _msg_hold >= wait_frames:
		_msg_cursor.visible = false
		_next_message()

func _show_final(text: String, result: String) -> void:
	phase = result
	_final_wait = result
	_msg_win.visible = true
	_msg_label.text = text
	_msg_cursor.visible = true
	_status_win.visible = true
	_cmd_win.visible = false
	_after_msg = Callable()
	_msg_queue.clear()
	_msg_active = false

# ---------------------------------------------------------------
# menu / input
# ---------------------------------------------------------------

func _open_menu() -> void:
	phase = "menu"
	menu_mode = "command"
	selected = 0
	_msg_win.visible = false
	_status_win.visible = true
	_cmd_win.visible = true
	_update_menu_labels()

func _visible_count() -> int:
	match menu_mode:
		"command": return 4
		"spell": return 3
		"item": return 2
	return 4

func _update_menu_labels() -> void:
	var texts: Array[String] = ["", "", "", ""]
	match menu_mode:
		"command":
			for i in 4:
				texts[i] = CMD_NAMES[i]
		"spell":
			texts[0] = "ヒカリ  MP4"
			texts[1] = "イヤシ  MP3"
			texts[2] = "もどる"
		"item":
			texts[0] = "やくそう  x%d" % int(game.player["herbs"])
			texts[1] = "もどる"
	for i in 4:
		_cmd_labels[i].text = texts[i]
	_cmd_cursor.position = Vector2(7, 9 + selected * 18)

func _tick_menu() -> void:
	if Input.is_action_just_pressed("rpg_up"):
		selected = (selected + _visible_count() - 1) % _visible_count()
		_update_menu_labels()
	elif Input.is_action_just_pressed("rpg_down"):
		selected = (selected + 1) % _visible_count()
		_update_menu_labels()
	elif Input.is_action_just_pressed("rpg_cancel"):
		if menu_mode != "command":
			menu_mode = "command"
			selected = 0
			_update_menu_labels()
	elif Input.is_action_just_pressed("rpg_confirm"):
		_confirm_menu()

func _confirm_menu() -> void:
	if menu_mode == "command":
		match selected:
			0: _do_attack()
			1:
				menu_mode = "spell"
				selected = 0
				_update_menu_labels()
			2:
				menu_mode = "item"
				selected = 0
				_update_menu_labels()
			3: _do_flee()
	elif menu_mode == "spell":
		match selected:
			0: _do_light()
			1: _do_heal()
			2:
				menu_mode = "command"
				selected = 0
				_update_menu_labels()
	elif menu_mode == "item":
		match selected:
			0: _do_herb()
			1:
				menu_mode = "command"
				selected = 0
				_update_menu_labels()

# Hook used by tests: command("attack" / "light" / "heal" / "herb" / "flee").
func command(cmd: String) -> bool:
	if not active or phase != "menu":
		return false
	match cmd:
		"attack", "たたかう": _do_attack()
		"light", "spell_light", "ヒカリ": _do_light()
		"heal", "spell_heal", "イヤシ": _do_heal()
		"herb", "やくそう": _do_herb()
		"flee", "にげる": _do_flee()
		_: return false
	return true

# ---------------------------------------------------------------
# player actions
# ---------------------------------------------------------------

func _begin_action() -> void:
	phase = "resolving"
	_cmd_win.visible = false
	_msg_win.visible = true
	_status_win.visible = false

func _physical_damage(atk: int, def: int) -> int:
	var base := int(floor((atk * 2 - def) / 3.0))
	return maxi(1, base + game.rng.randi_range(0, 2))

func _spell_damage() -> int:
	var lv: int = int(game.player["level"])
	return 6 + lv * 3 + game.rng.randi_range(0, 3)

func _heal_amount() -> int:
	var lv: int = int(game.player["level"])
	return 12 + lv * 3 + game.rng.randi_range(0, 2)

func _do_attack() -> void:
	_begin_action()
	var dmg := _physical_damage(int(game.player["atk"]), int(monster["def"]))
	last_damage = dmg
	monster_hp -= dmg
	_flash = 12
	var pages := ["ルカの こうげき！", "%sに %dの ダメージ！" % [monster["name"], dmg]]
	if monster_hp <= 0:
		pages.append("%sを たおした！" % monster["name"])
		_show_messages(pages, Callable(self, "_victory"))
	else:
		_show_messages(pages, Callable(self, "_enemy_turn"))

func _do_light() -> void:
	_begin_action()
	if int(game.player["mp"]) < int(Data.SPELL_LIGHT["mp"]):
		_show_messages(["MPが たりない！"], Callable(self, "_open_menu"))
		return
	game.player["mp"] = int(game.player["mp"]) - int(Data.SPELL_LIGHT["mp"])
	var dmg := _spell_damage()
	last_damage = dmg
	monster_hp -= dmg
	_flash = 12
	var pages := ["ルカは ヒカリを となえた！", "%sに %dの ダメージ！" % [monster["name"], dmg]]
	if monster_hp <= 0:
		pages.append("%sを たおした！" % monster["name"])
		_show_messages(pages, Callable(self, "_victory"))
	else:
		_show_messages(pages, Callable(self, "_enemy_turn"))

func _do_heal() -> void:
	_begin_action()
	if int(game.player["mp"]) < int(Data.SPELL_HEAL["mp"]):
		_show_messages(["MPが たりない！"], Callable(self, "_open_menu"))
		return
	game.player["mp"] = int(game.player["mp"]) - int(Data.SPELL_HEAL["mp"])
	_heal_player(_heal_amount())
	_show_messages(
		["ルカは イヤシを となえた！", "HPが %d かいふくした！" % last_heal],
		Callable(self, "_enemy_turn")
	)

func _do_herb() -> void:
	_begin_action()
	if int(game.player["herbs"]) <= 0:
		_show_messages(["やくそうを もっていない！"], Callable(self, "_open_menu"))
		return
	game.player["herbs"] = int(game.player["herbs"]) - 1
	_heal_player(Data.HERB_HEAL)
	_show_messages(
		["やくそうを つかった！", "HPが %d かいふくした！" % last_heal],
		Callable(self, "_enemy_turn")
	)

func _heal_player(amount: int) -> void:
	var p: Dictionary = game.player
	var before := int(p["hp"])
	p["hp"] = mini(int(p["max_hp"]), before + amount)
	last_heal = int(p["hp"]) - before

func _do_flee() -> void:
	_begin_action()
	if bool(monster.get("boss", false)):
		_show_messages(["ゾルガから にげられない！"], Callable(self, "_open_menu"))
		return
	flee_attempts += 1
	var chance := mini(90, 50 + (int(game.player["level"]) - 1) * 5)
	var roll: int = game.rng.randi_range(1, 100)
	last_flee_success = roll <= chance
	if last_flee_success:
		_show_messages(["ルカは にげだした！"], Callable(self, "_finish_escaped"))
	else:
		_show_messages(["しかし まわりこまれた！"], Callable(self, "_enemy_turn"))

func _finish_escaped() -> void:
	_show_final("にげきった！\nボタンで フィールドへ", "escaped")

# ---------------------------------------------------------------
# enemy turn
# ---------------------------------------------------------------

func _enemy_turn() -> void:
	phase = "resolving"
	var p: Dictionary = game.player
	var dmg := 0
	if bool(monster.get("boss", false)) and turn % 3 == 2:
		boss_special_used += 1
		last_enemy_action = "やみのいかり"
		dmg = maxi(1, int(floor((int(monster["atk"]) * 2 - int(p["def"])) / 2.0)) + game.rng.randi_range(0, 4))
		last_enemy_damage = dmg
		p["hp"] = int(p["hp"]) - dmg
		turn += 1
		var pages := [
			"%sの やみのいかり！" % monster["name"],
			"ルカは %dの ダメージを うけた！" % dmg,
		]
		if int(p["hp"]) <= 0:
			pages.append("ルカは ちからつきた…")
			_show_messages(pages, Callable(self, "_defeat"))
		else:
			_show_messages(pages, Callable(self, "_open_menu"))
		return
	last_enemy_action = "こうげき"
	dmg = _physical_damage(int(monster["atk"]), int(p["def"]))
	last_enemy_damage = dmg
	p["hp"] = int(p["hp"]) - dmg
	turn += 1
	var pages := [
		"%sの こうげき！" % monster["name"],
		"ルカは %dの ダメージを うけた！" % dmg,
	]
	if int(p["hp"]) <= 0:
		pages.append("ルカは ちからつきた…")
		_show_messages(pages, Callable(self, "_defeat"))
	else:
		_show_messages(pages, Callable(self, "_open_menu"))

# ---------------------------------------------------------------
# victory / defeat
# ---------------------------------------------------------------

func _victory() -> void:
	phase = "resolving"
	rewards = game.apply_battle_rewards(monster)
	var pages: Array = [
		"けいけんち %d ゴールド %d を えた！" % [int(rewards["exp"]), int(rewards["gold"])],
	]
	if bool(rewards.get("leveled", false)):
		pages.append("ルカは レベル%dに あがった！" % int(game.player["level"]))
		pages.append("さいだいHP %d さいだいMP %d" % [int(game.player["max_hp"]), int(game.player["max_mp"])])
		pages.append("こうげき力 %d ぼうぎょ力 %d" % [int(game.player["atk"]), int(game.player["def"])])
	_show_messages(pages, Callable(self, "_finish_victory"))

func _finish_victory() -> void:
	_show_final("たたかいが おわった！\nボタンで フィールドへ", "victory")

func _defeat() -> void:
	_show_final("めのまえが まっくらに\nなった…", "defeat")

# ---------------------------------------------------------------
# finish / state for tests
# ---------------------------------------------------------------

func _finish(result: String) -> void:
	_do_finish(result)

func _do_finish(result: String) -> void:
	phase = result
	active = false
	_view.visible = false
	_msg_win.visible = false
	_status_win.visible = false
	_cmd_win.visible = false
	game.on_battle_finished(result, monster_id)

# Called from game.finish_battle() to dismiss victory/defeat/escaped prompts.
func dismiss() -> String:
	if _final_wait == "":
		return ""
	var result := _final_wait
	_final_wait = ""
	_do_finish(result)
	return result

# Used by the game's test/setup hooks to abandon a battle without consequences.
func reset() -> void:
	active = false
	phase = "idle"
	monster_id = ""
	monster = {}
	monster_hp = 0
	_final_wait = ""
	_msg_queue.clear()
	_msg_active = false
	_after_msg = Callable()
	if _view != null:
		_view.visible = false

func summary() -> Dictionary:
	return {
		"active": active,
		"phase": phase,
		"monster_id": monster_id,
		"monster": monster.get("name", ""),
		"monster_hp": monster_hp,
		"monster_max_hp": monster_max_hp,
		"menu_mode": menu_mode,
		"selected": selected,
		"turn": turn,
		"last_damage": last_damage,
		"last_heal": last_heal,
		"last_enemy_damage": last_enemy_damage,
		"last_enemy_action": last_enemy_action,
		"last_flee_success": last_flee_success,
		"flee_attempts": flee_attempts,
		"boss_special_used": boss_special_used,
		"message": _msg_text.substr(0, _typed),
	}

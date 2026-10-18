extends Node2D
# ===============================================================
# 星剣のルカ - main game controller
# Fixed 60 Hz logic: every animation, timer and battle runs on
# physics frames, never on render delta.
# ===============================================================

const Data = preload("res://examples/rpg/scripts/data.gd")
const MapRendererScript = preload("res://examples/rpg/scripts/map_renderer.gd")
const NesWin = preload("res://examples/rpg/scripts/nes_window.gd")
const Tri = preload("res://examples/rpg/scripts/tri.gd")
const Visuals = preload("res://examples/rpg/scripts/visuals.gd")
const BattleScript = preload("res://examples/rpg/scripts/battle.gd")

var font: Font
var _ui_theme: Theme

var tiles_tex: Texture2D
var hero_tex: Texture2D
var npcs_tex: Texture2D

# ---------------------------------------------------------------
# state
# ---------------------------------------------------------------
var state := "boot"
var state_frame := 0

var rng := RandomNumberGenerator.new()
var _rng_seed := 20261018
var rng_seed: int:
	get:
		return _rng_seed
	set(value):
		_rng_seed = value
		if rng != null:
			rng.seed = value

var encounters_enabled := true
var encounter_rate := 10
var fast_mode := false
var message_instant := false

var player: Dictionary = {}
var flags: Dictionary = {}
var boss_defeated := false

var map_name := "castle"
var map_rows: Array = []
var tile := Vector2i(7, 9)
var facing := "up"
var moving := false
var move_elapsed := 0
var move_from := Vector2i.ZERO
var move_to := Vector2i.ZERO
var walk_anim := 0
var steps_taken := 0
var encounter_cooldown := 0
var banner_frames := 0

var dialog_active := false
var dialog_pages: Array = []
var dialog_index := 0
var dialog_full := ""
var dialog_typed := 0
var dialog_after: Callable = Callable()
var dialog_force_instant := false

var last_battle_result := ""
var last_rewards: Dictionary = {}

var ending_phase := "epilogue"
var ending_page := 0
var credits_y := 240.0

var fade_alpha := 0.0
var fade_target := 0.0
var fade_step := 0.0
var fade_active := false
var fade_cb: Callable = Callable()

var _opening_done := false
var _opening_y := 240.0

# ---------------------------------------------------------------
# nodes
# ---------------------------------------------------------------
var map_renderer: Node2D
var actors: Node2D
var player_sprite: Sprite2D
var npc_at: Dictionary = {}

var ui_layer: CanvasLayer
var ui_root: Control

var field_msg_win: Control
var field_msg_label: Label
var field_cursor: Control
var banner_win: Control
var banner_label: Label

var title_view: Control
var title_bg
var logo_rect: TextureRect
var title_label: Label
var subtitle_label: Label
var press_label: Label
var copyright_label: Label

var opening_view: Control
var opening_bg
var opening_chapter: Label
var opening_label: Label
var opening_text_height := 0.0

var ending_view: Control
var ending_bg
var ending_header: Label
var ending_label: Label
var ending_cursor: Control
var credits_label: Label
var ending_note: Label
var ending_end_label: Label

var fade_rect: ColorRect
var battle

# ===============================================================
# setup
# ===============================================================

func _ready() -> void:
	_setup_display()
	_setup_font()
	_load_textures()
	_build_field()
	_build_ui()
	battle = BattleScript.new()
	battle.name = "Battle"
	add_child(battle)
	battle.setup(self, ui_root)
	_reset_game_state()
	_enter_title()
	print("RPG_READY state=%s display=%dx%d" % [state, Data.SCREEN_W, Data.SCREEN_H])

func _setup_display() -> void:
	var win := get_window()
	win.title = Data.TITLE
	win.content_scale_size = Vector2i(Data.SCREEN_W, Data.SCREEN_H)
	win.content_scale_mode = Window.CONTENT_SCALE_MODE_VIEWPORT
	win.content_scale_aspect = Window.CONTENT_SCALE_ASPECT_KEEP
	win.content_scale_stretch = Window.CONTENT_SCALE_STRETCH_INTEGER
	DisplayServer.window_set_size(Vector2i(Data.SCREEN_W * 3, Data.SCREEN_H * 3))
	win.move_to_center()
	get_viewport().canvas_item_default_texture_filter = Viewport.DEFAULT_CANVAS_ITEM_TEXTURE_FILTER_NEAREST

func _setup_font() -> void:
	var sf := SystemFont.new()
	sf.font_names = PackedStringArray([
		"ヒラギノ角ゴシック", "Hiragino Sans", "Hiragino Kaku Gothic ProN",
		"Arial Unicode MS", "Arial Unicode", "Noto Sans CJK JP", "sans-serif",
	])
	sf.allow_system_fallback = true
	sf.antialiasing = TextServer.FONT_ANTIALIASING_NONE
	sf.subpixel_positioning = TextServer.SUBPIXEL_POSITIONING_DISABLED
	sf.hinting = TextServer.HINTING_NONE
	font = sf
	_ui_theme = Theme.new()
	_ui_theme.default_font = font
	_ui_theme.default_font_size = 12
	ThemeDB.fallback_font = font
	ThemeDB.fallback_font_size = 12

func _load_textures() -> void:
	tiles_tex = load(Data.TILES_PATH)
	hero_tex = load(Data.HERO_PATH)
	npcs_tex = load(Data.NPCS_PATH)

func _build_field() -> void:
	map_renderer = MapRendererScript.new()
	map_renderer.name = "Map"
	add_child(map_renderer)

	actors = Node2D.new()
	actors.name = "Actors"
	actors.y_sort_enabled = true
	add_child(actors)

	player_sprite = Sprite2D.new()
	player_sprite.name = "Player"
	player_sprite.texture = hero_tex
	player_sprite.hframes = 6
	player_sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	actors.add_child(player_sprite)

func _build_ui() -> void:
	ui_layer = CanvasLayer.new()
	ui_layer.name = "UI"
	add_child(ui_layer)

	ui_root = Control.new()
	ui_root.name = "Root"
	ui_root.size = Vector2(Data.SCREEN_W, Data.SCREEN_H)
	ui_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui_root.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	ui_root.theme = _ui_theme
	ui_layer.add_child(ui_root)

	_build_field_ui()
	_build_title_ui()
	_build_opening_ui()
	_build_ending_ui()

	fade_rect = ColorRect.new()
	fade_rect.name = "Fade"
	fade_rect.position = Vector2.ZERO
	fade_rect.size = Vector2(Data.SCREEN_W, Data.SCREEN_H)
	fade_rect.color = Color(0, 0, 0, 0)
	fade_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	fade_rect.z_index = 100
	ui_root.add_child(fade_rect)

func _new_window(pos: Vector2, sz: Vector2, z: int) -> Control:
	var w: Control = NesWin.new()
	w.position = pos
	w.size = sz
	w.z_index = z
	w.visible = false
	ui_root.add_child(w)
	return w

func _mk_label(parent: Control, pos: Vector2, sz: Vector2, text: String, fs: int = 12, color: Color = Color.WHITE, align: int = 0) -> Label:
	var l := Label.new()
	l.position = pos
	l.size = sz
	l.text = text
	l.horizontal_alignment = align
	l.vertical_alignment = VERTICAL_ALIGNMENT_TOP
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	l.add_theme_font_override("font", font)
	l.add_theme_font_size_override("font_size", fs)
	l.add_theme_color_override("font_color", color)
	l.add_theme_constant_override("line_spacing", 1)
	parent.add_child(l)
	return l

func _build_field_ui() -> void:
	field_msg_win = _new_window(Vector2(4, 160), Vector2(248, 76), 5)
	field_msg_label = _mk_label(field_msg_win, Vector2(10, 6), Vector2(228, 62), "", 12)
	field_cursor = Tri.new()
	field_cursor.position = Vector2(236, 64)
	field_cursor.visible = false
	field_msg_win.add_child(field_cursor)

	banner_win = _new_window(Vector2(4, 4), Vector2(156, 24), 4)
	banner_label = _mk_label(banner_win, Vector2(10, 5), Vector2(136, 15), "", 10, Color("#f0f0f0"))

func _build_title_ui() -> void:
	title_view = Control.new()
	title_view.name = "Title"
	title_view.position = Vector2.ZERO
	title_view.size = Vector2(Data.SCREEN_W, Data.SCREEN_H)
	title_view.mouse_filter = Control.MOUSE_FILTER_IGNORE
	title_view.z_index = 20
	title_view.visible = false
	ui_root.add_child(title_view)

	title_bg = Visuals.StarBackdrop.new()
	title_bg.size = Vector2(Data.SCREEN_W, Data.SCREEN_H)
	title_bg.mode = "title"
	title_view.add_child(title_bg)

	logo_rect = TextureRect.new()
	logo_rect.texture = load(Data.LOGO_PATH)
	logo_rect.position = Vector2(80, 18)
	logo_rect.size = Vector2(96, 96)
	logo_rect.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	logo_rect.stretch_mode = TextureRect.STRETCH_SCALE
	logo_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	title_view.add_child(logo_rect)

	title_label = _mk_label(title_view, Vector2(0, 116), Vector2(256, 38), Data.TITLE, 28, Color("#ffe8a0"), HORIZONTAL_ALIGNMENT_CENTER)
	title_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	title_label.add_theme_constant_override("outline_size", 2)
	title_label.add_theme_color_override("font_outline_color", Color("#203060"))

	subtitle_label = _mk_label(title_view, Vector2(0, 154), Vector2(256, 20), Data.SUBTITLE, 12, Color("#b8c8f0"), HORIZONTAL_ALIGNMENT_CENTER)
	subtitle_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER

	press_label = _mk_label(title_view, Vector2(0, 196), Vector2(256, 22), Data.PRESS_START, 12, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER)
	press_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER

	copyright_label = _mk_label(title_view, Vector2(0, 224), Vector2(256, 14), "(C) 2026 星剣工房", 9, Color("#8090b0"), HORIZONTAL_ALIGNMENT_CENTER)

func _build_opening_ui() -> void:
	opening_view = Control.new()
	opening_view.name = "Opening"
	opening_view.position = Vector2.ZERO
	opening_view.size = Vector2(Data.SCREEN_W, Data.SCREEN_H)
	opening_view.mouse_filter = Control.MOUSE_FILTER_IGNORE
	opening_view.z_index = 20
	opening_view.visible = false
	ui_root.add_child(opening_view)

	opening_bg = Visuals.StarBackdrop.new()
	opening_bg.size = Vector2(Data.SCREEN_W, Data.SCREEN_H)
	opening_bg.mode = "opening"
	opening_view.add_child(opening_bg)

	opening_chapter = _mk_label(opening_view, Vector2(0, 8), Vector2(256, 18), "序章", 12, Color("#e8d080"), HORIZONTAL_ALIGNMENT_CENTER)

	var lines := PackedStringArray()
	for line in Data.OPENING_LINES:
		lines.append(str(line))
	opening_text_height = Data.OPENING_LINES.size() * 17.0 + 24.0
	opening_label = _mk_label(
		opening_view,
		Vector2(0, 240),
		Vector2(256, opening_text_height),
		"\n".join(lines),
		12,
		Color("#f0f0f0"),
		HORIZONTAL_ALIGNMENT_CENTER
	)
	opening_label.add_theme_constant_override("line_spacing", 2)

func _build_ending_ui() -> void:
	ending_view = Control.new()
	ending_view.name = "Ending"
	ending_view.position = Vector2.ZERO
	ending_view.size = Vector2(Data.SCREEN_W, Data.SCREEN_H)
	ending_view.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ending_view.z_index = 20
	ending_view.visible = false
	ui_root.add_child(ending_view)

	ending_bg = Visuals.StarBackdrop.new()
	ending_bg.size = Vector2(Data.SCREEN_W, Data.SCREEN_H)
	ending_bg.mode = "ending"
	ending_view.add_child(ending_bg)

	ending_header = _mk_label(ending_view, Vector2(0, 12), Vector2(256, 20), Data.TITLE, 14, Color("#e8d080"), HORIZONTAL_ALIGNMENT_CENTER)

	ending_label = _mk_label(ending_view, Vector2(8, 64), Vector2(240, 120), "", 12, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER)
	ending_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	ending_label.add_theme_constant_override("line_spacing", 4)

	ending_cursor = Tri.new()
	ending_cursor.points_right = false
	ending_cursor.position = Vector2(125, 186)
	ending_cursor.visible = false
	ending_view.add_child(ending_cursor)

	var credit_lines := PackedStringArray()
	for line in Data.CREDITS_LINES:
		credit_lines.append(str(line))
	var credits_height := Data.CREDITS_LINES.size() * 17.0 + 60.0
	credits_label = _mk_label(
		ending_view,
		Vector2(0, 240),
		Vector2(256, credits_height),
		"\n".join(credit_lines),
		12,
		Color("#e0e8ff"),
		HORIZONTAL_ALIGNMENT_CENTER
	)
	credits_label.add_theme_constant_override("line_spacing", 2)
	credits_label.visible = false

	ending_end_label = _mk_label(ending_view, Vector2(0, 100), Vector2(256, 40), "おわり", 24, Color("#ffe8a0"), HORIZONTAL_ALIGNMENT_CENTER)
	ending_end_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	ending_end_label.add_theme_constant_override("outline_size", 2)
	ending_end_label.add_theme_color_override("font_outline_color", Color("#203060"))
	ending_end_label.visible = false

	ending_note = _mk_label(ending_view, Vector2(0, 208), Vector2(256, 18), Data.CREDITS_NOTE, 10, Color("#a0b0d0"), HORIZONTAL_ALIGNMENT_CENTER)
	ending_note.visible = false

# ===============================================================
# main loop (fixed 60 Hz)
# ===============================================================

func _physics_process(_delta: float) -> void:
	state_frame += 1
	_tick_fade()
	match state:
		"title":
			_tick_title()
		"opening":
			_tick_opening()
		"field":
			_tick_field()
		"battle":
			if battle != null:
				battle.tick()
		"ending":
			_tick_ending()

# ---------------------------------------------------------------
# fades
# ---------------------------------------------------------------

func _fade_to(target: float, frames: int, cb = null) -> void:
	fade_target = target
	fade_step = 1.0 / float(maxi(1, frames))
	fade_active = true
	if cb is Callable:
		var c: Callable = cb
		fade_cb = c
	else:
		fade_cb = Callable()
	fade_rect.color = Color(0, 0, 0, fade_alpha)
	if is_equal_approx(fade_alpha, fade_target):
		fade_active = false
		var ready_cb: Callable = fade_cb
		fade_cb = Callable()
		if ready_cb.is_valid():
			ready_cb.call()

func _tick_fade() -> void:
	if not fade_active:
		return
	fade_alpha = move_toward(fade_alpha, fade_target, fade_step)
	fade_rect.color = Color(0, 0, 0, fade_alpha)
	if is_equal_approx(fade_alpha, fade_target):
		fade_active = false
		var cb: Callable = fade_cb
		fade_cb = Callable()
		if cb.is_valid():
			cb.call()

func _clear_fade() -> void:
	fade_active = false
	fade_alpha = 0.0
	fade_target = 0.0
	fade_cb = Callable()
	if fade_rect != null:
		fade_rect.color = Color(0, 0, 0, 0)

# ---------------------------------------------------------------
# game reset / views
# ---------------------------------------------------------------

func _reset_game_state() -> void:
	player = Data.PLAYER_START.duplicate(true)
	flags = {
		"king_gift": false,
		"mina_gift": false,
		"met_elder": false,
		"met_guard": false,
	}
	boss_defeated = false
	last_battle_result = ""
	last_rewards = {}
	steps_taken = 0
	encounter_cooldown = 0
	dialog_active = false
	dialog_pages = []
	dialog_index = 0
	dialog_full = ""
	dialog_typed = 0
	dialog_after = Callable()
	dialog_force_instant = false
	moving = false
	move_elapsed = 0
	walk_anim = 0
	ending_phase = "epilogue"
	ending_page = 0
	_opening_done = false
	if battle != null:
		battle.reset()
	var start_map: String = str(Data.START_POS["map"])
	var start_pos: Vector2i = Data.START_POS["pos"]
	_load_map(start_map, start_pos)
	facing = "up"
	_sync_player()
	_clear_fade()

func _hide_all_views() -> void:
	if title_view != null:
		title_view.visible = false
	if opening_view != null:
		opening_view.visible = false
	if ending_view != null:
		ending_view.visible = false
	if field_msg_win != null:
		field_msg_win.visible = false
	if banner_win != null:
		banner_win.visible = false

func _enter_title() -> void:
	state = "title"
	state_frame = 0
	_hide_all_views()
	title_view.visible = true
	title_bg.set_frame(0)
	press_label.visible = true

func _tick_title() -> void:
	title_bg.set_frame(state_frame)
	press_label.visible = ((state_frame / 30) % 2) == 0
	if Input.is_action_just_pressed("rpg_confirm"):
		enter_opening()

# ---------------------------------------------------------------
# opening
# ---------------------------------------------------------------

func enter_opening() -> void:
	_reset_game_state()
	state = "opening"
	state_frame = 0
	_hide_all_views()
	opening_view.visible = true
	opening_bg.set_frame(0)
	_opening_done = false
	_opening_y = float(Data.SCREEN_H)
	opening_label.position = Vector2(0, _opening_y)

func _tick_opening() -> void:
	opening_bg.set_frame(state_frame)
	if state_frame % 3 == 0:
		_opening_y -= 2.0
		opening_label.position = Vector2(0, _opening_y)
	if not _opening_done and _opening_y + opening_label.size.y < 0.0:
		_opening_done = true
		_fade_to(1.0, 30, Callable(self, "_on_opening_faded_out"))
	if state_frame > 30 and Input.is_action_just_pressed("rpg_confirm"):
		skip_opening()

func _on_opening_faded_out() -> void:
	_enter_field_start()
	_fade_to(0.0, 30)

func skip_opening() -> void:
	if state != "opening" and state != "title":
		return
	start_new_game()

func start_new_game() -> void:
	_reset_game_state()
	state = "field"
	state_frame = 0
	_hide_all_views()
	_sync_player()
	_show_banner()
	print("NEW_GAME map=%s tile=%s" % [map_name, str(tile)])

func _enter_field_start() -> void:
	state = "field"
	state_frame = 0
	_hide_all_views()
	_sync_player()
	_show_banner()

# ---------------------------------------------------------------
# maps / player
# ---------------------------------------------------------------

func _load_map(new_map: String, pos: Vector2i) -> void:
	if not Data.MAPS.has(new_map):
		return
	map_name = new_map
	var map_def: Dictionary = Data.MAPS[new_map]
	map_rows = map_def["rows"]
	map_renderer.set_map(map_rows, tiles_tex)

	for child in actors.get_children():
		if child == player_sprite:
			continue
		actors.remove_child(child)
		child.queue_free()

	npc_at.clear()
	var npcs: Array = Data.NPCS.get(new_map, [])
	for npc_value in npcs:
		var npc: Dictionary = npc_value
		var spr := Sprite2D.new()
		spr.name = "NPC_" + str(npc["id"])
		spr.texture = npcs_tex
		spr.hframes = 4
		spr.frame = int(npc["sprite"])
		spr.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		var npc_pos: Vector2i = npc["pos"]
		spr.position = _tile_center(npc_pos)
		actors.add_child(spr)
		npc_at[npc_pos] = npc

	tile = pos
	_sync_player()
	_show_banner()

func _tile_center(p: Vector2i) -> Vector2:
	return Vector2(p.x * Data.TILE_SIZE + Data.TILE_SIZE * 0.5, p.y * Data.TILE_SIZE + Data.TILE_SIZE * 0.5)

func _sync_player() -> void:
	if player_sprite == null:
		return
	player_sprite.position = _tile_center(tile)
	_update_player_frame()

func _update_player_frame() -> void:
	if player_sprite == null:
		return
	var base := 0
	match facing:
		"down":
			base = 0
		"up":
			base = 2
		"left", "right":
			base = 4
	player_sprite.frame = base + walk_anim
	player_sprite.flip_h = (facing == "right")

func _tile_char(p: Vector2i) -> String:
	if p.x < 0 or p.y < 0 or p.x >= Data.MAP_W or p.y >= Data.MAP_H:
		return ""
	if p.y >= map_rows.size():
		return ""
	var row: String = map_rows[p.y]
	if p.x >= row.length():
		return ""
	return row[p.x]

func _is_walkable(p: Vector2i) -> bool:
	if p.x < 0 or p.y < 0 or p.x >= Data.MAP_W or p.y >= Data.MAP_H:
		return false
	if npc_at.has(p):
		return false
	var ch := _tile_char(p)
	if ch == "":
		return false
	var def: Dictionary = Data.TILE_DEFS.get(ch, {})
	if def.is_empty():
		return false
	return bool(def.get("walk", false))

func _dir_vec(dir_name: String) -> Vector2i:
	match dir_name:
		"up":
			return Vector2i(0, -1)
		"down":
			return Vector2i(0, 1)
		"left":
			return Vector2i(-1, 0)
		"right":
			return Vector2i(1, 0)
	return Vector2i.ZERO

func _show_banner() -> void:
	if not Data.MAPS.has(map_name):
		return
	var map_def: Dictionary = Data.MAPS[map_name]
	banner_label.text = str(map_def.get("name", ""))
	banner_frames = 120
	banner_win.visible = (state == "field" and not dialog_active)

func _tick_banner() -> void:
	if state != "field" or dialog_active:
		banner_win.visible = false
		return
	if banner_frames > 0:
		banner_frames -= 1
		banner_win.visible = true
	else:
		banner_win.visible = false

# ---------------------------------------------------------------
# field
# ---------------------------------------------------------------

func _tick_field() -> void:
	_tick_banner()
	if dialog_active:
		_tick_dialog()
		return
	if fade_active:
		return
	if moving:
		_tick_move()
		return

	# Holding a direction keeps walking tile by tile, as in NES RPGs.
	var dir := ""
	if Input.is_action_pressed("rpg_up"):
		dir = "up"
	elif Input.is_action_pressed("rpg_down"):
		dir = "down"
	elif Input.is_action_pressed("rpg_left"):
		dir = "left"
	elif Input.is_action_pressed("rpg_right"):
		dir = "right"

	if dir != "":
		_try_move(dir)
	elif Input.is_action_just_pressed("rpg_confirm"):
		_try_interact()

func _try_move(dir_name: String) -> void:
	facing = dir_name
	_update_player_frame()
	var target := tile + _dir_vec(dir_name)
	if not _is_walkable(target):
		return
	moving = true
	move_elapsed = 0
	move_from = tile
	move_to = target
	walk_anim = 1 - walk_anim
	_update_player_frame()

func _tick_move() -> void:
	move_elapsed += 1
	var dir_vec := move_to - move_from
	var center := _tile_center(move_from)
	player_sprite.position = center + Vector2(dir_vec.x, dir_vec.y) * 2.0 * float(move_elapsed)
	if move_elapsed >= Data.MOVE_FRAMES:
		tile = move_to
		moving = false
		steps_taken += 1
		_sync_player()
		_on_step_complete()

func _on_step_complete() -> void:
	var ch := _tile_char(tile)
	var map_def: Dictionary = Data.MAPS[map_name]
	var warps: Dictionary = map_def.get("warps", {})
	if ch != "" and warps.has(ch):
		var w: Dictionary = warps[ch]
		var wp: Vector2i = w["pos"]
		warp(str(w["map"]), wp.x, wp.y)
		return
	if map_name == "world" and ch == "S":
		if boss_defeated:
			_show_message("ほこらは しずかだ…\n星の光が もどっている。")
		else:
			_show_message("ここは 星のほこら…\nおそろしい 気配が する。", Callable(self, "_begin_zorga"))
		return
	if encounter_cooldown > 0:
		encounter_cooldown -= 1
		return
	if map_name != "world" or not encounters_enabled or encounter_rate <= 0:
		return
	var denom := 0
	if ch == "g":
		denom = encounter_rate
	elif ch == "f":
		denom = maxi(1, encounter_rate - 3)
	if denom > 0 and rng.randi_range(1, denom) == 1:
		_roll_encounter()

func _roll_encounter() -> void:
	var dist := absi(tile.x - 6) + absi(tile.y - 10)
	var pool_name := "near"
	if dist > 4:
		pool_name = "mid"
	if dist > 7:
		pool_name = "far"
	var pool: Array = Data.ENCOUNTER_POOLS[pool_name]
	var monster_key := str(pool[rng.randi_range(0, pool.size() - 1)])
	begin_battle(monster_key)

func _try_interact() -> void:
	var target := tile + _dir_vec(facing)
	if not npc_at.has(target):
		return
	var npc: Dictionary = npc_at[target]
	var npc_id := str(npc["id"])
	var pages: Array = []
	var after: Callable = Callable()
	match npc_id:
		"king":
			if not bool(flags["king_gift"]):
				pages = Data.DIALOGUES["king"]["first"]
				after = Callable(self, "_grant_king_gift")
			else:
				pages = Data.DIALOGUES["king"]["repeat"]
		"mina":
			if not bool(flags["mina_gift"]):
				pages = Data.DIALOGUES["mina"]["first"]
				after = Callable(self, "_grant_mina_gift")
			else:
				pages = Data.DIALOGUES["mina"]["repeat"]
		"elder":
			if not bool(flags["met_elder"]):
				pages = Data.DIALOGUES["elder"]["first"]
				after = Callable(self, "_mark_elder")
			else:
				pages = Data.DIALOGUES["elder"]["repeat"]
		"guard":
			if not bool(flags["met_guard"]):
				pages = Data.DIALOGUES["guard"]["first"]
				after = Callable(self, "_mark_guard")
			else:
				pages = Data.DIALOGUES["guard"]["repeat"]
		_:
			pages = [["……"]]
	_start_dialog(pages, after)

func _grant_king_gift() -> void:
	if bool(flags["king_gift"]):
		return
	flags["king_gift"] = true
	player["gold"] = int(player["gold"]) + 50
	player["herbs"] = int(player["herbs"]) + 1

func _grant_mina_gift() -> void:
	if bool(flags["mina_gift"]):
		return
	flags["mina_gift"] = true
	player["herbs"] = int(player["herbs"]) + 1

func _mark_elder() -> void:
	flags["met_elder"] = true

func _mark_guard() -> void:
	flags["met_guard"] = true

func _begin_zorga() -> void:
	begin_battle("zorga")

# ---------------------------------------------------------------
# dialog / messages
# ---------------------------------------------------------------

func _start_dialog(pages: Array, after = null, force_instant := false) -> void:
	if pages.is_empty():
		if after is Callable:
			var empty_cb: Callable = after
			if empty_cb.is_valid():
				empty_cb.call()
		return
	dialog_active = true
	dialog_pages = pages
	dialog_index = 0
	dialog_force_instant = force_instant
	if after is Callable:
		var cb: Callable = after
		dialog_after = cb
	else:
		dialog_after = Callable()
	field_msg_win.visible = true
	banner_frames = 0
	banner_win.visible = false
	_load_dialog_page()

func _load_dialog_page() -> void:
	if dialog_index >= dialog_pages.size():
		_end_dialog()
		return
	var page_value = dialog_pages[dialog_index]
	var lines := PackedStringArray()
	if page_value is Array:
		var page: Array = page_value
		for line in page:
			lines.append(str(line))
	else:
		lines.append(str(page_value))
	dialog_full = "\n".join(lines)
	dialog_typed = 0
	if message_instant or fast_mode or dialog_force_instant:
		dialog_typed = dialog_full.length()
	field_msg_label.text = dialog_full.substr(0, dialog_typed)
	field_cursor.visible = false

func _tick_dialog() -> void:
	if dialog_typed < dialog_full.length():
		if message_instant or fast_mode or dialog_force_instant:
			dialog_typed = dialog_full.length()
		else:
			dialog_typed += 1
		field_msg_label.text = dialog_full.substr(0, dialog_typed)
		field_cursor.visible = false
		return
	field_cursor.visible = ((state_frame / 12) % 2) == 0
	if Input.is_action_just_pressed("rpg_confirm"):
		_advance_dialog()

func _advance_dialog() -> void:
	if not dialog_active:
		return
	if dialog_typed < dialog_full.length():
		dialog_typed = dialog_full.length()
		field_msg_label.text = dialog_full
		return
	dialog_index += 1
	if dialog_index >= dialog_pages.size():
		_end_dialog()
	else:
		_load_dialog_page()

func _cancel_dialog() -> void:
	dialog_active = false
	field_msg_win.visible = false
	field_cursor.visible = false
	dialog_full = ""
	dialog_typed = 0
	dialog_after = Callable()
	dialog_force_instant = false

func _end_dialog() -> void:
	var cb := dialog_after
	_cancel_dialog()
	if cb.is_valid():
		cb.call()

func advance_dialog() -> void:
	_advance_dialog()

func _show_message(text: String, after = null, force_instant := false) -> void:
	var raw_lines := text.split("\n")
	var pages: Array = []
	var current: Array = []
	for line in raw_lines:
		current.append(str(line))
		if current.size() == 3:
			pages.append(current)
			current = []
	if not current.is_empty():
		pages.append(current)
	if pages.is_empty():
		pages = [[""]]
	_start_dialog(pages, after, force_instant)

func show_message(text: String) -> void:
	_show_message(text)

func show_message_instant(text: String) -> void:
	_show_message(text, null, true)

# ---------------------------------------------------------------
# warps / test hooks for field
# ---------------------------------------------------------------

func warp(target_map: String, x: int, y: int) -> bool:
	if not Data.MAPS.has(target_map):
		return false
	if x < 0 or y < 0 or x >= Data.MAP_W or y >= Data.MAP_H:
		return false
	moving = false
	move_elapsed = 0
	_cancel_dialog()
	if state != "field":
		state = "field"
		state_frame = 0
		_hide_all_views()
		if battle != null:
			battle.reset()
	_load_map(target_map, Vector2i(x, y))
	encounter_cooldown = 2
	facing = "up"
	_sync_player()
	_show_banner()
	return true

func face(dir_name: String) -> void:
	if dir_name == "up" or dir_name == "down" or dir_name == "left" or dir_name == "right":
		facing = dir_name
		_update_player_frame()

# Test hook: begin a grid step without keyboard input (for pause/step checks).
func start_move(dir_name: String) -> void:
	if state != "field" or dialog_active or moving or fade_active:
		return
	if dir_name != "up" and dir_name != "down" and dir_name != "left" and dir_name != "right":
		return
	_try_move(dir_name)

func set_player_stats(stats: Dictionary) -> void:
	for key_value in stats.keys():
		var key := str(key_value)
		if key == "name":
			player["name"] = str(stats[key_value])
		elif player.has(key):
			player[key] = int(stats[key_value])
	player["level"] = maxi(1, int(player["level"]))
	player["max_hp"] = maxi(1, int(player["max_hp"]))
	player["max_mp"] = maxi(0, int(player["max_mp"]))
	player["atk"] = maxi(1, int(player["atk"]))
	player["def"] = maxi(0, int(player["def"]))
	player["exp"] = maxi(0, int(player["exp"]))
	player["next_exp"] = maxi(1, int(player["next_exp"]))
	player["gold"] = maxi(0, int(player["gold"]))
	player["herbs"] = maxi(0, int(player["herbs"]))
	player["hp"] = clampi(int(player["hp"]), 0, int(player["max_hp"]))
	player["mp"] = clampi(int(player["mp"]), 0, int(player["max_mp"]))

func set_fast_mode(value: bool) -> void:
	fast_mode = value

func set_message_instant(value: bool) -> void:
	message_instant = value

func set_encounters_enabled(value: bool) -> void:
	encounters_enabled = value

func set_encounter_rate(value: int) -> void:
	encounter_rate = maxi(0, value)

func set_rng_seed(value: int) -> void:
	rng_seed = value

# ---------------------------------------------------------------
# battle integration
# ---------------------------------------------------------------

func begin_battle(monster_key: String) -> bool:
	if not Data.MONSTERS.has(monster_key):
		return false
	if state == "title" or state == "opening" or state == "ending":
		start_new_game()
	if state == "battle" and battle != null:
		battle.reset()
	_cancel_dialog()
	banner_frames = 0
	banner_win.visible = false
	field_msg_win.visible = false
	state = "battle"
	state_frame = 0
	battle.begin(monster_key)
	return true

func start_battle(monster_key: String) -> bool:
	return begin_battle(monster_key)

func start_boss() -> bool:
	if state == "title" or state == "opening" or state == "ending" or state == "battle":
		start_new_game()
	_load_map("world", Vector2i(13, 4))
	state = "field"
	facing = "up"
	_sync_player()
	begin_battle("zorga")
	return true

func battle_command(cmd: String) -> bool:
	if state != "battle" or battle == null:
		return false
	var result = battle.command(cmd)
	return bool(result)

func finish_battle() -> String:
	if state != "battle" or battle == null:
		return ""
	return str(battle.dismiss())

func apply_battle_rewards(mon: Dictionary) -> Dictionary:
	var exp_gain := int(mon.get("exp", 0))
	var gold_gain := int(mon.get("gold", 0))
	player["exp"] = int(player["exp"]) + exp_gain
	player["gold"] = int(player["gold"]) + gold_gain
	var leveled := false
	var levels := 0
	while int(player["exp"]) >= int(player["next_exp"]):
		player["level"] = int(player["level"]) + 1
		player["max_hp"] = int(player["max_hp"]) + 5
		player["max_mp"] = int(player["max_mp"]) + 2
		player["atk"] = int(player["atk"]) + 2
		player["def"] = int(player["def"]) + 1
		player["hp"] = int(player["max_hp"])
		player["mp"] = int(player["max_mp"])
		player["next_exp"] = int(player["next_exp"]) + 30 + (int(player["level"]) - 1) * 10
		leveled = true
		levels += 1
	var result := {
		"exp": exp_gain,
		"gold": gold_gain,
		"leveled": leveled,
		"levels": levels,
	}
	last_rewards = result.duplicate(true)
	return result

func on_battle_finished(result: String, monster_key: String) -> void:
	last_battle_result = result
	if battle != null:
		last_rewards = battle.rewards.duplicate(true)
	state = "field"
	state_frame = 0
	_cancel_dialog()
	field_msg_win.visible = false
	if result == "victory":
		encounter_cooldown = 3
		if monster_key == "zorga":
			boss_defeated = true
			flags["boss_defeated"] = true
			_start_ending()
			return
	elif result == "defeat":
		_apply_defeat()
	elif result == "escaped":
		encounter_cooldown = 3
	_sync_player()

func _apply_defeat() -> void:
	player["gold"] = int(floor(int(player["gold"]) / 2.0))
	player["hp"] = int(player["max_hp"])
	player["mp"] = int(player["max_mp"])
	var start_map: String = str(Data.START_POS["map"])
	var start_pos: Vector2i = Data.START_POS["pos"]
	_load_map(start_map, start_pos)
	facing = "up"
	encounter_cooldown = 3
	_sync_player()
	_show_message("ルカは 王さまの もとへ\nはこばれた…\nゴールドが はんぶんに なった。")

# ---------------------------------------------------------------
# ending
# ---------------------------------------------------------------

func _page_text(page: Array) -> String:
	var lines := PackedStringArray()
	for line in page:
		lines.append(str(line))
	return "\n".join(lines)

func start_ending() -> void:
	_start_ending()

func _start_ending() -> void:
	state = "ending"
	state_frame = 0
	_hide_all_views()
	_cancel_dialog()
	ending_view.visible = true
	ending_bg.set_frame(0)
	ending_phase = "epilogue"
	ending_page = 0
	ending_header.visible = true
	ending_label.visible = true
	ending_label.text = _page_text(Data.EPILOGUE_PAGES[0])
	ending_cursor.visible = true
	credits_label.visible = false
	ending_note.visible = false
	ending_end_label.visible = false
	_clear_fade()

func _tick_ending() -> void:
	ending_bg.set_frame(state_frame)
	match ending_phase:
		"epilogue":
			ending_cursor.visible = ((state_frame / 12) % 2) == 0
			if Input.is_action_just_pressed("rpg_confirm"):
				advance_ending()
		"credits":
			credits_y -= 1.0
			credits_label.position = Vector2(0, credits_y)
			if credits_y + credits_label.size.y < 0.0:
				_finish_credits()
		"finish":
			ending_note.visible = ((state_frame / 30) % 2) == 0
			if Input.is_action_just_pressed("rpg_confirm"):
				_return_to_title()

func advance_ending() -> void:
	match ending_phase:
		"epilogue":
			ending_page += 1
			if ending_page >= Data.EPILOGUE_PAGES.size():
				show_ending_credits()
			else:
				ending_label.text = _page_text(Data.EPILOGUE_PAGES[ending_page])
		"credits":
			skip_credits()
		"finish":
			_return_to_title()

func show_ending_credits() -> void:
	ending_header.visible = false  # the roll scrolls through the header's area
	ending_phase = "credits"
	ending_page = 99
	ending_label.visible = false
	ending_cursor.visible = false
	ending_end_label.visible = false
	ending_note.visible = false
	credits_label.visible = true
	credits_y = float(Data.SCREEN_H)
	credits_label.position = Vector2(0, credits_y)

func skip_credits() -> void:
	_finish_credits()

func _finish_credits() -> void:
	ending_phase = "finish"
	state_frame = 0
	credits_label.visible = false
	ending_header.visible = true
	ending_end_label.visible = true
	ending_note.visible = true

func _return_to_title() -> void:
	_reset_game_state()
	_enter_title()

func return_to_title() -> void:
	_return_to_title()

# ---------------------------------------------------------------
# generic hook: advance whatever is waiting
# ---------------------------------------------------------------

func advance() -> void:
	match state:
		"field":
			if dialog_active:
				_advance_dialog()
		"battle":
			finish_battle()
		"ending":
			advance_ending()
		"opening":
			skip_opening()
		"title":
			enter_opening()

# ---------------------------------------------------------------
# summary / debug hooks
# ---------------------------------------------------------------

func summary() -> Dictionary:
	var battle_summary: Dictionary = {}
	if battle != null:
		battle_summary = battle.summary()
	return {
		"state": state,
		"state_frame": state_frame,
		"map": map_name,
		"tile": tile,
		"facing": facing,
		"moving": moving,
		"move_elapsed": move_elapsed,
		"steps": steps_taken,
		"dialog_active": dialog_active,
		"dialog_page": dialog_index,
		"dialog_full": dialog_full,
		"message": field_msg_label.text,
		"player": player.duplicate(true),
		"boss_defeated": boss_defeated,
		"ending_phase": ending_phase,
		"ending_page": ending_page,
		"last_battle_result": last_battle_result,
		"last_rewards": last_rewards.duplicate(true),
		"battle": battle_summary,
		"rng_seed": _rng_seed,
	}

func debug_flee_seeds() -> Dictionary:
	var success_seed := 0
	var failure_seed := 0
	for s in range(1, 1000):
		var r := RandomNumberGenerator.new()
		r.seed = s
		var roll := r.randi_range(1, 100)
		if success_seed == 0 and roll <= 50:
			success_seed = s
		if failure_seed == 0 and roll > 50:
			failure_seed = s
		if success_seed != 0 and failure_seed != 0:
			break
	return {"success_seed": success_seed, "failure_seed": failure_seed}

func debug_roll(seed_value: int) -> int:
	var r := RandomNumberGenerator.new()
	r.seed = seed_value
	return r.randi_range(1, 100)

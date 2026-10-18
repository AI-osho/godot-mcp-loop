extends Node2D
## NES-style side-scrolling action game "PIXEL DASH".
## Internal 256x240, integer-scaled, nearest filtering. All logic runs in _physics_process (60 Hz).
## Controls: Left/A and Right/D move, Z/Space jump (hold = higher), Enter restarts after game over/clear.
## Test hooks (game_set / game_call):
##   invincible, enemies_frozen, timer_frozen, start_position, time_limit
##   start_game(), restart(), start_at(x, y), set_player_position(x, y),
##   spawn_enemy(kind, x, y), clear_enemies(), freeze_enemies(on), stop_timer(on),
##   hurt_player(cause), summary()
## Live state: state, score, coins, lives, time_left, player_vx/vy, on_ground, facing,
##   last_jump_height, max_speed_reached, kills, stomps, hits_taken, falls,
##   camera_x, bg_far_offset, bg_near_offset, cloud_offset, clears, game_overs, restarts.

const SCREEN_W := 256
const SCREEN_H := 240
const STAGE_W := 2048.0
const GROUND_Y := 200.0
const COIN_SCORE := 200
const CLEAR_SCORE := 1000
const COYOTE_FRAMES := 6
const INVULN_FRAMES := 90

# Player physics (units: pixels per physics frame, 60 Hz).
const RUN_ACCEL := 0.22
const RUN_FRICTION := 0.30
const AIR_ACCEL := 0.15
const AIR_FRICTION := 0.05
const MAX_RUN := 2.0
const GRAVITY := 0.30
const HOLD_GRAVITY := 0.12
const HOLD_FRAMES := 12
const JUMP_VELOCITY := -4.6
const JUMP_CUT := -1.8
const STOMP_BOUNCE := -3.6
const MAX_FALL := 6.5
const PH := Vector2(6, 11)

# Enemy tuning.
const WALKER_SPEED := 0.5
const HOP_SPEED := 0.65
const HOP_VELOCITY := -3.4
const HOP_INTERVAL := 70
const ENEMY_GRAVITY := 0.20
const EW := 6.0
const EH := 7.0

const C_BLACK := Color("#000000")
const C_WHITE := Color("#fcfcfc")
const C_SKY := Color("#5c94fc")
const C_SUN := Color("#fcfc54")
const C_RED := Color("#d82800")
const C_YELLOW := Color("#f8b800")
const C_GRAY := Color("#bcbcbc")
const C_DARK := Color("#7c7c7c")

## 5x7 bitmap font: 7 rows per glyph, 5 bits per row (MSB = left pixel).
const FONT := {"0": [14, 17, 19, 21, 25, 17, 14], "1": [4, 12, 4, 4, 4, 4, 14], "2": [14, 17, 1, 6, 8, 16, 31], "3": [31, 2, 4, 2, 1, 17, 14], "4": [2, 6, 10, 18, 31, 2, 2], "5": [31, 16, 30, 1, 1, 17, 14], "6": [6, 8, 16, 30, 17, 17, 14], "7": [31, 1, 2, 4, 8, 8, 8], "8": [14, 17, 17, 14, 17, 17, 14], "9": [14, 17, 17, 15, 1, 2, 12], "A": [14, 17, 17, 31, 17, 17, 17], "B": [30, 17, 17, 30, 17, 17, 30], "C": [14, 17, 16, 16, 16, 17, 14], "D": [28, 18, 17, 17, 17, 18, 28], "E": [31, 16, 16, 30, 16, 16, 31], "F": [31, 16, 16, 30, 16, 16, 16], "G": [14, 17, 16, 23, 17, 17, 15], "H": [17, 17, 17, 31, 17, 17, 17], "I": [14, 4, 4, 4, 4, 4, 14], "J": [7, 2, 2, 2, 2, 18, 12], "K": [17, 18, 20, 24, 20, 18, 17], "L": [16, 16, 16, 16, 16, 16, 31], "M": [17, 27, 21, 21, 17, 17, 17], "N": [17, 17, 25, 21, 19, 17, 17], "O": [14, 17, 17, 17, 17, 17, 14], "P": [30, 17, 17, 30, 16, 16, 16], "Q": [14, 17, 17, 17, 21, 18, 13], "R": [30, 17, 17, 30, 20, 18, 17], "S": [15, 16, 16, 14, 1, 1, 30], "T": [31, 4, 4, 4, 4, 4, 4], "U": [17, 17, 17, 17, 17, 17, 14], "V": [17, 17, 17, 17, 17, 10, 4], "W": [17, 17, 17, 21, 21, 21, 10], "X": [17, 17, 10, 4, 10, 17, 17], "Y": [17, 17, 17, 10, 4, 4, 4], "Z": [31, 1, 2, 4, 8, 16, 31], "-": [0, 0, 0, 31, 0, 0, 0], "!": [4, 4, 4, 4, 4, 0, 4], "+": [0, 4, 4, 31, 4, 4, 0], ":": [0, 12, 12, 0, 12, 12, 0], ".": [0, 0, 0, 0, 0, 12, 12], "x": [0, 0, 17, 10, 4, 10, 17], "(": [2, 4, 8, 8, 8, 4, 2], ")": [8, 4, 2, 2, 2, 4, 8]}

const TEX_PLAYER := preload("res://examples/action/sprites/player.png")
const TEX_WALKER := preload("res://examples/action/sprites/walker.png")
const TEX_HOPPER := preload("res://examples/action/sprites/hopper.png")
const TEX_COIN := preload("res://examples/action/sprites/coin.png")
const TEX_GROUND := preload("res://examples/action/sprites/ground_top.png")
const TEX_DIRT := preload("res://examples/action/sprites/dirt_fill.png")
const TEX_BRICK := preload("res://examples/action/sprites/brick.png")
const TEX_PLATFORM := preload("res://examples/action/sprites/platform.png")
const TEX_GOAL := preload("res://examples/action/sprites/goal.png")
const TEX_CLOUD := preload("res://examples/action/sprites/cloud.png")
const TEX_MOUNTAIN := preload("res://examples/action/sprites/mountain_far.png")
const TEX_HILL := preload("res://examples/action/sprites/hill_near.png")


class Enemy extends Sprite2D:
	var kind := "walker"
	var dir := -1.0
	var vx := 0.0
	var vy := 0.0
	var on_ground := false
	var min_x := 0.0
	var max_x := 0.0
	var t := 0
	var hop_timer := HOP_INTERVAL
	var score_value := 100
	var dead := false


class Coin extends Sprite2D:
	var taken := false
	var phase := 0


@export var window_scale := 3
## Test hook: the player ignores damage (pits still respawn the player without losing a life).
@export var invincible := false
## Test hook: enemies keep their position and do not hop/walk (collisions still work).
@export var enemies_frozen := false
## Test hook: the stage timer does not count down.
@export var timer_frozen := false
## Test hook / respawn point. The player is placed here by start_game() and after a miss.
@export var start_position := Vector2(24.0, 189.0)
## Stage time in seconds.
@export var time_limit := 300

# --- Live state (game_query / game_wait_for) ---
var state := "play"  # play | gameover | clear
var state_timer := 0
var frame := 0
var score := 0
var coins := 0
var coins_total := 0
var coins_remaining := 0
var lives := 3
var time_left := 300
var time_ticks := 0
var player_vx := 0.0
var player_vy := 0.0
var on_ground := false
var facing := 1
var coyote := 0
var jump_hold := 0
var jump_active := false
var jump_start_y := 0.0
var jump_peak_y := 0.0
var last_jump_height := 0.0
var max_speed_reached := 0.0
var invuln := 0
var kills := 0
var stomps := 0
var hits_taken := 0
var falls := 0
var last_cause := ""
var time_bonus := 0
var games_started := 0
var game_overs := 0
var restarts := 0
var clears := 0
var camera_x := 128.0
var bg_far_offset := 0.0
var bg_near_offset := 0.0
var cloud_offset := 0.0
var enemy_count := 0
var player_x := 0.0
var player_y := 0.0
var display_scale := 1
var goal_x := 2000.0
var goal_trigger_x := 1984.0
var score_text := "000000"

var platforms: Array = []
var moving_platforms: Array = []
var effects: Array = []
var clouds: Array = []

var world: Node2D
var background: Node2D
var hud: Node2D
var player: Sprite2D
var camera: Camera2D
var enemies: Node2D
var items: Node2D
var fx_layer: Node2D
var goal_sprite: Sprite2D

var _walker_seq := 0
var _hopper_seq := 0
var _coin_seq := 0
var _spawn_seq := 0

var walker_specs := [
	[180.0, 193.0, 120.0, 260.0],
	[600.0, 193.0, 540.0, 660.0],
	[900.0, 193.0, 820.0, 1000.0],
	[1250.0, 193.0, 1160.0, 1360.0],
	[1590.0, 193.0, 1500.0, 1720.0],
	[1920.0, 193.0, 1860.0, 1960.0],
]
var hopper_specs := [
	[332.0, 135.0, 306.0, 358.0],
	[820.0, 193.0, 780.0, 1020.0],
	[1200.0, 193.0, 1140.0, 1380.0],
	[1552.0, 139.0, 1526.0, 1578.0],
]
var coin_specs := [
	Vector2(64, 176), Vector2(84, 176), Vector2(104, 176),
	Vector2(316, 124), Vector2(332, 124), Vector2(348, 124),
	Vector2(436, 168), Vector2(452, 156), Vector2(468, 168),
	Vector2(572, 126), Vector2(588, 126), Vector2(604, 126),
	Vector2(636, 84), Vector2(652, 84),
	Vector2(716, 166), Vector2(732, 154), Vector2(748, 166),
	Vector2(872, 122), Vector2(896, 122), Vector2(920, 122),
	Vector2(972, 80), Vector2(988, 80),
	Vector2(1082, 152),
	Vector2(1196, 126), Vector2(1212, 126), Vector2(1228, 126),
	Vector2(1324, 84), Vector2(1340, 84), Vector2(1356, 84),
	Vector2(1412, 168), Vector2(1428, 156), Vector2(1444, 168),
	Vector2(1536, 126), Vector2(1552, 126), Vector2(1568, 126),
	Vector2(1634, 84), Vector2(1650, 84),
	Vector2(1850, 176), Vector2(1870, 176), Vector2(1890, 176),
	Vector2(1924, 120), Vector2(1940, 120),
]


func _ready() -> void:
	_setup_window()
	texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	_build_layers()
	_build_level_data()
	_build_clouds()
	coins_total = coin_specs.size()
	start_game()
	world.queue_redraw()


func _setup_window() -> void:
	var win := get_window()
	win.content_scale_size = Vector2i(SCREEN_W, SCREEN_H)
	win.content_scale_mode = Window.CONTENT_SCALE_MODE_VIEWPORT
	win.content_scale_aspect = Window.CONTENT_SCALE_ASPECT_KEEP
	win.content_scale_stretch = Window.CONTENT_SCALE_STRETCH_INTEGER
	get_viewport().canvas_item_default_texture_filter = Viewport.DEFAULT_CANVAS_ITEM_TEXTURE_FILTER_NEAREST
	get_viewport().snap_2d_transforms_to_pixel = true
	if not Engine.is_embedded_in_editor() and win.mode == Window.MODE_WINDOWED:
		win.size = Vector2i(SCREEN_W, SCREEN_H) * window_scale
		win.move_to_center()
	display_scale = maxi(1, mini(win.size.x / SCREEN_W, win.size.y / SCREEN_H))


func _build_layers() -> void:
	var bg_layer := CanvasLayer.new()
	bg_layer.name = "BackgroundLayer"
	bg_layer.layer = -10
	add_child(bg_layer)
	background = Node2D.new()
	background.name = "Background"
	background.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	bg_layer.add_child(background)
	background.draw.connect(_draw_background)

	world = Node2D.new()
	world.name = "World"
	world.z_index = 0
	world.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	world.texture_repeat = CanvasItem.TEXTURE_REPEAT_ENABLED
	add_child(world)
	world.draw.connect(_draw_world)

	goal_sprite = Sprite2D.new()
	goal_sprite.name = "Goal"
	goal_sprite.texture = TEX_GOAL
	goal_sprite.position = Vector2(goal_x, GROUND_Y - 24.0)
	goal_sprite.z_index = 0
	add_child(goal_sprite)

	enemies = Node2D.new()
	enemies.name = "Enemies"
	enemies.z_index = 1
	add_child(enemies)

	items = Node2D.new()
	items.name = "Items"
	items.z_index = 1
	add_child(items)

	player = Sprite2D.new()
	player.name = "Player"
	player.texture = TEX_PLAYER
	player.hframes = 7
	player.z_index = 2
	add_child(player)

	fx_layer = Node2D.new()
	fx_layer.name = "Effects"
	fx_layer.z_index = 3
	fx_layer.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	add_child(fx_layer)
	fx_layer.draw.connect(_draw_fx)

	camera = Camera2D.new()
	camera.name = "Camera"
	camera.position = Vector2(SCREEN_W / 2.0, SCREEN_H / 2.0)
	camera.limit_left = 0
	camera.limit_top = 0
	camera.limit_right = int(STAGE_W)
	camera.limit_bottom = SCREEN_H
	camera.position_smoothing_enabled = false
	add_child(camera)
	camera.make_current()

	var hud_layer := CanvasLayer.new()
	hud_layer.name = "HUDLayer"
	hud_layer.layer = 10
	add_child(hud_layer)
	hud = Node2D.new()
	hud.name = "HUD"
	hud.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	hud_layer.add_child(hud)
	hud.draw.connect(_draw_hud)


func _build_level_data() -> void:
	platforms.clear()
	var segs := [
		[0.0, 420.0], [484.0, 700.0], [764.0, 1050.0],
		[1126.0, 1400.0], [1464.0, 1750.0], [1814.0, 2048.0],
	]
	for s in segs:
		platforms.append({"rect": Rect2(s[0], GROUND_Y, s[1] - s[0], SCREEN_H - GROUND_Y), "kind": "ground"})
	var bricks := [
		[300.0, 142.0, 64.0], [560.0, 146.0, 64.0], [620.0, 104.0, 48.0],
		[860.0, 142.0, 80.0], [960.0, 100.0, 48.0], [1180.0, 146.0, 64.0],
		[1300.0, 104.0, 80.0], [1520.0, 146.0, 64.0], [1610.0, 104.0, 64.0],
		[1900.0, 140.0, 64.0],
	]
	for b in bricks:
		platforms.append({"rect": Rect2(b[0], b[1], b[2], 16.0), "kind": "brick"})


func _build_moving_platforms() -> void:
	moving_platforms = [
		{"x": 1064.0, "y": 170.0, "w": 48.0, "h": 8.0, "base_x": 1064.0, "range": 14.0, "speed": 0.030, "phase": 0.0, "dx": 0.0},
		{"x": 1758.0, "y": 164.0, "w": 48.0, "h": 8.0, "base_x": 1758.0, "range": 8.0, "speed": 0.038, "phase": 1.7, "dx": 0.0},
	]


func _build_clouds() -> void:
	clouds = [
		Vector2(20, 26), Vector2(120, 46), Vector2(208, 76), Vector2(72, 100),
	]


# ---------------------------------------------------------------- main loop

func _physics_process(_delta: float) -> void:
	frame += 1
	if state == "play":
		_update_play()
	else:
		state_timer += 1
		_animate_items()
		if state_timer > 30 and Input.is_action_just_pressed("action_start"):
			restart()
	background.queue_redraw()
	hud.queue_redraw()
	fx_layer.queue_redraw()


func _update_play() -> void:
	if not timer_frozen:
		time_ticks += 1
		if time_ticks >= 60:
			time_ticks = 0
			time_left -= 1
			if time_left <= 0:
				time_left = 0
				_game_over("time")
				_update_stats()
				return
	_update_moving_platforms()
	_carry_on_moving_platform()
	_update_player()
	_update_enemies()
	_animate_items()
	_update_effects()
	if state == "play":
		_check_enemy_collisions()
		_check_pickups()
		_check_goal()
		_check_pit()
	_update_camera()
	_update_parallax()
	_update_stats()


func _animate_items() -> void:
	for n in items.get_children():
		var c := n as Coin
		if c != null and not c.taken:
			c.frame = (frame / 6 + c.phase) % 4


func _update_stats() -> void:
	enemy_count = enemies.get_child_count()
	coins_remaining = 0
	for n in items.get_children():
		var c := n as Coin
		if c != null and not c.taken:
			coins_remaining += 1
	max_speed_reached = maxf(max_speed_reached, absf(player_vx))
	player_x = player.position.x
	player_y = player.position.y
	score_text = "%06d" % score


# ---------------------------------------------------------------- hooks / flow

## Reset the whole stage and start playing. Hooks (invincible, frozen flags) are kept.
func start_game() -> String:
	state = "play"
	state_timer = 0
	score = 0
	coins = 0
	lives = 3
	time_left = time_limit
	time_ticks = 0
	player_vx = 0.0
	player_vy = 0.0
	on_ground = false
	facing = 1
	coyote = 0
	jump_hold = 0
	jump_active = false
	last_jump_height = 0.0
	max_speed_reached = 0.0
	invuln = 0
	kills = 0
	stomps = 0
	hits_taken = 0
	falls = 0
	last_cause = ""
	time_bonus = 0
	effects.clear()
	_build_moving_platforms()
	_spawn_entities()
	player.position = start_position
	player.visible = true
	player.frame = 0
	player.flip_h = false
	_update_camera()
	_update_parallax()
	_update_stats()
	games_started += 1
	return "play"


func restart() -> String:
	restarts += 1
	return start_game()


## Teleport the player without resetting the level (test hook).
func set_player_position(x: float, y: float) -> String:
	player.position = Vector2(x, y)
	player_vx = 0.0
	player_vy = 0.0
	on_ground = false
	jump_active = false
	_update_camera()
	_update_parallax()
	return "ok"


## Set the spawn point and restart from it (test hook).
func start_at(x: float, y: float) -> String:
	start_position = Vector2(x, y)
	return start_game()


func freeze_enemies(on: bool) -> String:
	enemies_frozen = on
	return "enemies_frozen=%s" % str(on)


func stop_timer(on: bool) -> String:
	timer_frozen = on
	return "timer_frozen=%s" % str(on)


func hurt_player(cause: String = "test") -> bool:
	return _hurt(cause)


## Spawn an extra enemy. y < -1000 means "on the ground at that x".
func spawn_enemy(kind: String, x: float, y: float = -9999.0) -> String:
	if kind != "walker" and kind != "hopper":
		push_error("spawn_enemy: unknown kind '%s' (walker, hopper)" % kind)
		return ""
	if y < -1000.0:
		y = GROUND_Y - EH
	var e := _add_enemy(kind, x, y, x - 40.0, x + 40.0)
	return String(e.name)


func clear_enemies() -> void:
	for n in enemies.get_children():
		n.free()
	_walker_seq = 0
	_hopper_seq = 0
	_spawn_seq = 0


func summary() -> Dictionary:
	return {
		"state": state, "score": score, "coins": coins, "coins_remaining": coins_remaining,
		"lives": lives, "time_left": time_left, "player": player.position,
		"vx": player_vx, "vy": player_vy, "on_ground": on_ground,
		"camera_x": camera_x, "kills": kills, "stomps": stomps, "hits_taken": hits_taken,
		"falls": falls, "clears": clears, "game_overs": game_overs, "restarts": restarts,
		"far": bg_far_offset, "near": bg_near_offset, "cloud": cloud_offset,
	}


func _spawn_entities() -> void:
	for n in enemies.get_children():
		n.free()
	for n in items.get_children():
		n.free()
	_walker_seq = 0
	_hopper_seq = 0
	_coin_seq = 0
	_spawn_seq = 0
	for s in walker_specs:
		_add_enemy("walker", s[0], s[1], s[2], s[3])
	for s in hopper_specs:
		_add_enemy("hopper", s[0], s[1], s[2], s[3])
	for i in coin_specs.size():
		_add_coin(coin_specs[i], i % 4)
	coins_remaining = items.get_child_count()


func _add_enemy(kind: String, x: float, y: float, min_x: float, max_x: float) -> Enemy:
	var e := Enemy.new()
	e.kind = kind
	e.texture = TEX_WALKER if kind == "walker" else TEX_HOPPER
	e.hframes = 2
	e.position = Vector2(x, y)
	e.min_x = min_x
	e.max_x = max_x
	e.dir = -1.0 if kind == "walker" else 1.0
	e.t = _spawn_seq * 11
	e.hop_timer = HOP_INTERVAL - (_spawn_seq % 4) * 15
	e.score_value = 100 if kind == "walker" else 150
	e.flip_h = e.dir < 0
	e.z_index = 1
	if kind == "walker":
		_walker_seq += 1
		e.name = "Walker_%d" % _walker_seq
	else:
		_hopper_seq += 1
		e.name = "Hopper_%d" % _hopper_seq
	_spawn_seq += 1
	enemies.add_child(e)
	return e


func _add_coin(pos: Vector2, phase: int) -> void:
	var c := Coin.new()
	c.texture = TEX_COIN
	c.hframes = 4
	c.position = pos
	c.phase = phase
	c.z_index = 1
	_coin_seq += 1
	c.name = "Coin_%d" % _coin_seq
	items.add_child(c)


# ---------------------------------------------------------------- moving platforms

func _mp_rect(mp: Dictionary) -> Rect2:
	return Rect2(mp["x"], mp["y"], mp["w"], mp["h"])


func _update_moving_platforms() -> void:
	for mp in moving_platforms:
		mp["phase"] += mp["speed"]
		var nx: float = mp["base_x"] + sin(mp["phase"]) * mp["range"]
		mp["dx"] = nx - mp["x"]
		mp["x"] = nx


func _carry_on_moving_platform() -> void:
	if player_vy < -0.01:
		return
	for mp in moving_platforms:
		var r := _mp_rect(mp)
		var feet := player.position.y + PH.y
		if absf(feet - r.position.y) <= 2.0 \
				and player.position.x + PH.x > r.position.x + 1.0 \
				and player.position.x - PH.x < r.end.x - 1.0:
			player.position.x += mp["dx"]
			return


# ---------------------------------------------------------------- player

func _update_player() -> void:
	var dir := Input.get_axis("action_left", "action_right")
	var accel := RUN_ACCEL if on_ground else AIR_ACCEL
	if absf(dir) > 0.1:
		player_vx = move_toward(player_vx, dir * MAX_RUN, accel)
		facing = 1 if dir > 0.0 else -1
	else:
		var fric := RUN_FRICTION if on_ground else AIR_FRICTION
		player_vx = move_toward(player_vx, 0.0, fric)

	if on_ground:
		coyote = COYOTE_FRAMES
	else:
		coyote = maxi(coyote - 1, 0)

	if Input.is_action_just_pressed("action_jump") and coyote > 0:
		player_vy = JUMP_VELOCITY
		on_ground = false
		coyote = 0
		jump_hold = 0
		jump_active = true
		jump_start_y = player.position.y
		jump_peak_y = player.position.y

	var holding := Input.is_action_pressed("action_jump")
	var g := GRAVITY
	if player_vy < 0.0 and jump_active:
		if holding and jump_hold < HOLD_FRAMES:
			g = HOLD_GRAVITY
			jump_hold += 1
		elif not holding and player_vy < JUMP_CUT:
			player_vy = JUMP_CUT
	player_vy = minf(player_vy + g, MAX_FALL)

	# Horizontal move + wall resolution.
	var nx := player.position.x + player_vx
	var pr := _player_rect_at(nx, player.position.y)
	for r in _solid_rects():
		if pr.intersects(r):
			if player_vx > 0.0:
				nx = r.position.x - PH.x
			elif player_vx < 0.0:
				nx = r.position.x + r.size.x + PH.x
			player_vx = 0.0
			pr = _player_rect_at(nx, player.position.y)
	player.position.x = nx

	# Vertical move + floor/ceiling resolution.
	on_ground = false
	var ny := player.position.y + player_vy
	pr = _player_rect_at(player.position.x, ny)
	var landed := false
	for r in _solid_rects():
		if pr.intersects(r):
			if player_vy > 0.0:
				ny = r.position.y - PH.y
				player_vy = 0.0
				landed = true
			elif player_vy < 0.0:
				ny = r.end.y + PH.y
				player_vy = 0.0
			pr = _player_rect_at(player.position.x, ny)
	player.position.y = ny
	on_ground = landed
	if landed:
		coyote = COYOTE_FRAMES
		if jump_active:
			last_jump_height = jump_start_y - jump_peak_y
			jump_active = false
	elif jump_active:
		jump_peak_y = minf(jump_peak_y, player.position.y)

	if invuln > 0:
		invuln -= 1
	player.visible = invuln == 0 or (invuln / 3) % 2 == 0

	var anim := 0
	if not on_ground:
		anim = 5 if player_vy < 0.0 else 6
	elif absf(player_vx) > 0.15:
		anim = 1 + (frame / 6) % 4
	player.frame = anim
	player.flip_h = facing < 0


func _player_rect_at(x: float, y: float) -> Rect2:
	return Rect2(Vector2(x, y) - PH, PH * 2.0)


func _player_rect() -> Rect2:
	return _player_rect_at(player.position.x, player.position.y)


func _solid_rects() -> Array:
	var out: Array = []
	for p in platforms:
		out.append(p["rect"])
	for mp in moving_platforms:
		out.append(_mp_rect(mp))
	return out


# ---------------------------------------------------------------- enemies

func _update_enemies() -> void:
	for n in enemies.get_children():
		var e := n as Enemy
		if e == null or e.dead:
			continue
		e.t += 1
		if not enemies_frozen:
			if e.kind == "walker":
				e.position.x += e.dir * WALKER_SPEED
			else:
				e.hop_timer -= 1
				if e.on_ground and e.hop_timer <= 0:
					e.vy = HOP_VELOCITY
					e.on_ground = false
					e.hop_timer = HOP_INTERVAL
				e.position.x += e.dir * HOP_SPEED
			if e.position.x <= e.min_x:
				e.position.x = e.min_x
				e.dir = 1.0
			elif e.position.x >= e.max_x:
				e.position.x = e.max_x
				e.dir = -1.0
			e.vy = minf(e.vy + ENEMY_GRAVITY, 6.0)
			e.position.y += e.vy
			e.on_ground = false
			var er := _enemy_rect(e.position)
			for r in _solid_rects():
				if er.intersects(r) and e.vy > 0.0:
					e.position.y = r.position.y - EH
					e.vy = 0.0
					e.on_ground = true
					er = _enemy_rect(e.position)
		if e.kind == "walker":
			e.frame = (e.t / 8) % 2
			e.flip_h = e.dir < 0
		else:
			e.frame = 0 if e.on_ground else 1


func _enemy_rect(pos: Vector2) -> Rect2:
	return Rect2(pos - Vector2(EW, EH), Vector2(EW * 2.0, EH * 2.0))


func _check_enemy_collisions() -> void:
	var pr := _player_rect()
	for n in enemies.get_children():
		var e := n as Enemy
		if e == null or e.dead:
			continue
		var er := _enemy_rect(e.position)
		if pr.intersects(er):
			if player_vy > 0.0 and player.position.y < e.position.y:
				_stomp_enemy(e)
			else:
				_hurt("enemy")


func _stomp_enemy(e: Enemy) -> void:
	e.dead = true
	kills += 1
	stomps += 1
	score += e.score_value
	player_vy = STOMP_BOUNCE
	player.position.y -= 1.0
	on_ground = false
	jump_active = false
	_spawn_puff(e.position)
	_spawn_text("+%d" % e.score_value, e.position + Vector2(-7, -12))
	e.free()


# ---------------------------------------------------------------- pickups / goal / pit

func _check_pickups() -> void:
	var pr := _player_rect()
	for n in items.get_children():
		var c := n as Coin
		if c == null or c.taken:
			continue
		var cr := Rect2(c.position - Vector2(4, 4), Vector2(8, 8))
		if pr.intersects(cr):
			c.taken = true
			c.visible = false
			coins += 1
			score += COIN_SCORE
			_spawn_text("+%d" % COIN_SCORE, c.position + Vector2(-7, -10))


func _check_goal() -> void:
	if player.position.x >= goal_trigger_x:
		_clear_stage()


func _check_pit() -> void:
	if player.position.y - PH.y > SCREEN_H + 32.0:
		falls += 1
		var lost := _hurt("pit")
		if not lost and state == "play":
			_respawn_player()


func _clear_stage() -> void:
	if state != "play":
		return
	state = "clear"
	state_timer = 0
	clears += 1
	time_bonus = time_left * 10
	score += CLEAR_SCORE + time_bonus
	player_vx = 0.0
	player_vy = 0.0
	last_cause = "goal"


# ---------------------------------------------------------------- damage / game over

func _hurt(cause: String) -> bool:
	if state != "play" or invincible or invuln > 0:
		return false
	hits_taken += 1
	lives -= 1
	last_cause = cause
	if lives <= 0:
		lives = 0
		_game_over(cause)
		return true
	invuln = INVULN_FRAMES
	_respawn_player()
	return true


func _respawn_player() -> void:
	player.position = start_position
	player_vx = 0.0
	player_vy = 0.0
	on_ground = false
	jump_active = false
	coyote = 0
	_update_camera()
	_update_parallax()


func _game_over(cause: String) -> void:
	if state != "play":
		return
	state = "gameover"
	state_timer = 0
	last_cause = cause
	game_overs += 1
	player_vx = 0.0
	player_vy = 0.0


# ---------------------------------------------------------------- camera / parallax

func _update_camera() -> void:
	camera_x = clampf(player.position.x, SCREEN_W / 2.0, STAGE_W - SCREEN_W / 2.0)
	camera.position = Vector2(camera_x, SCREEN_H / 2.0)


func _update_parallax() -> void:
	var d := camera_x - SCREEN_W / 2.0
	bg_far_offset = d * 0.25
	bg_near_offset = d * 0.50
	cloud_offset = d * 0.35


# ---------------------------------------------------------------- effects

func _spawn_text(text: String, pos: Vector2) -> void:
	effects.append({"kind": "text", "pos": pos, "t": 0, "text": text})


func _spawn_puff(pos: Vector2) -> void:
	effects.append({"kind": "puff", "pos": pos, "t": 0, "text": ""})


func _update_effects() -> void:
	var i := effects.size() - 1
	while i >= 0:
		var fx: Dictionary = effects[i]
		fx["t"] += 1
		if fx["kind"] == "text":
			fx["pos"] += Vector2(0, -0.35)
		if fx["t"] > 40:
			effects.remove_at(i)
		i -= 1


func _draw_fx() -> void:
	for fx in effects:
		var t: int = fx["t"]
		var pos: Vector2 = fx["pos"]
		if fx["kind"] == "text":
			_text(fx_layer, fx["text"], pos, C_YELLOW)
		else:
			var r := 3.0 + float(t)
			fx_layer.draw_rect(Rect2(pos.x - r, pos.y - 1, r * 2.0, 2.0), C_WHITE)
			fx_layer.draw_rect(Rect2(pos.x - 1, pos.y - r, 2.0, r * 2.0), C_WHITE)


# ---------------------------------------------------------------- drawing

func _draw_background() -> void:
	var bg := background
	bg.draw_rect(Rect2(0, 0, SCREEN_W, SCREEN_H), C_SKY)
	# Pixel sun.
	bg.draw_rect(Rect2(210, 20, 12, 4), C_SUN)
	bg.draw_rect(Rect2(206, 24, 20, 12), C_SUN)
	bg.draw_rect(Rect2(210, 36, 12, 4), C_SUN)
	# Far mountains (2x nearest-scaled tiles) scroll slowly.
	var foff := fposmod(bg_far_offset, 64.0)
	for i in 6:
		bg.draw_texture_rect(TEX_MOUNTAIN, Rect2(-foff + i * 64.0, 152.0, 64.0, 48.0), false)
	# Near hills.
	var noff := fposmod(bg_near_offset, 64.0)
	for i in 6:
		bg.draw_texture_rect(TEX_HILL, Rect2(-noff + i * 64.0, 168.0, 64.0, 32.0), false)
	# Clouds.
	for c: Vector2 in clouds:
		var x := fposmod(c.x - cloud_offset, 320.0) - 32.0
		bg.draw_texture(TEX_CLOUD, Vector2(x, c.y))


func _draw_world() -> void:
	for p in platforms:
		var r: Rect2 = p["rect"]
		if p["kind"] == "ground":
			world.draw_texture_rect(TEX_GROUND, Rect2(r.position.x, r.position.y, r.size.x, 16.0), true)
			world.draw_texture_rect(TEX_DIRT, Rect2(r.position.x, r.position.y + 16.0, r.size.x, r.size.y - 16.0), true)
		else:
			world.draw_texture_rect(TEX_BRICK, r, true)
	for mp in moving_platforms:
		world.draw_texture_rect(TEX_PLATFORM, _mp_rect(mp), true)


func _draw_hud() -> void:
	hud.draw_rect(Rect2(0, 0, SCREEN_W, 13), C_BLACK)
	_text(hud, "SCORE %06d" % score, Vector2(4, 3), C_WHITE)
	hud.draw_texture_rect_region(TEX_COIN, Rect2(84, 3, 8, 8), Rect2(0, 0, 8, 8))
	_text(hud, "x%02d" % coins, Vector2(94, 3), C_YELLOW)
	_text(hud, "LIVES %d" % lives, Vector2(126, 3), C_WHITE)
	var tc := C_YELLOW if time_left <= 30 else C_WHITE
	_text(hud, "TIME %03d" % time_left, Vector2(190, 3), tc)

	match state:
		"gameover":
			hud.draw_rect(Rect2(0, 14, SCREEN_W, SCREEN_H - 14), Color(0, 0, 0, 0.62))
			_text_center(hud, "GAME OVER", 84, C_RED, 2)
			_text_center(hud, "SCORE %06d" % score, 116, C_WHITE)
			_text_center(hud, "CAUSE %s" % last_cause.to_upper(), 132, C_GRAY)
			if state_timer > 30 and (state_timer / 30) % 2 == 0:
				_text_center(hud, "PUSH ENTER", 156, C_WHITE)
		"clear":
			hud.draw_rect(Rect2(0, 14, SCREEN_W, SCREEN_H - 14), Color(0, 0, 0, 0.45))
			_text_center(hud, "COURSE CLEAR!", 78, C_YELLOW, 2)
			_text_center(hud, "+%d" % CLEAR_SCORE, 110, C_WHITE)
			_text_center(hud, "TIME BONUS %d" % time_bonus, 126, C_WHITE)
			_text_center(hud, "SCORE %06d" % score, 142, C_YELLOW)
			if state_timer > 30 and (state_timer / 30) % 2 == 0:
				_text_center(hud, "PUSH ENTER", 166, C_WHITE)


func _text_center(ci: CanvasItem, s: String, y: float, c: Color, sc: int = 1) -> void:
	_text(ci, s, Vector2(floorf((SCREEN_W - (s.length() * 6 - 1) * sc) / 2.0), y), c, sc)


func _text(ci: CanvasItem, s: String, pos: Vector2, c: Color, sc: int = 1) -> void:
	var x := pos.x
	for ch in s:
		if FONT.has(ch):
			var rows: Array = FONT[ch]
			for r in 7:
				var bits: int = rows[r]
				for col in 5:
					if bits & (16 >> col):
						ci.draw_rect(Rect2(x + col * sc, pos.y + r * sc, sc, sc), c)
		x += 6 * sc

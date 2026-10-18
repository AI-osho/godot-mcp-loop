extends Node2D
## NES-style vertical shooter "STAR RAIDER": internal 256x240, integer-scaled, nearest filtering.
## Keys: arrows/WASD move (8 directions), Z/Space/J fire (hold = auto-fire), Enter start.
## Flow: title -> play (5 waves + boss) -> gameover / clear -> Enter -> title.
## Test hooks (game_set / game_call): rng_seed, invincible, start_wave, waves_enabled, autopilot,
## fire_interval, max_shots, invuln_frames; start_game(wave), start_boss(), spawn_enemy(kind, x, y),
## spawn_enemy_bullet(x, y, vx, vy), damage_boss(n), clear_enemies(), summary().

const SCREEN_W := 256
const SCREEN_H := 240
const WAVE_COUNT := 6
const BOSS_WAVE := 5
const PLAYER_MIN := Vector2(8, 24)
const PLAYER_MAX := Vector2(248, 230)
const PLAYER_START := Vector2(128, 200)
const PLAYER_RADIUS := 3.0
const SHOT_SPEED := 6.0
const SCORES := {"a": 100, "b": 150, "c": 200, "d": 300, "boss": 5000}
const HP := {"a": 1, "b": 1, "c": 1, "d": 3, "boss": 80}
const RADIUS := {"a": 7.0, "b": 7.0, "c": 6.0, "d": 7.0, "boss": 0.0}
const C_BLACK := Color("#000000")
const C_WHITE := Color("#fcfcfc")
const C_RED := Color("#d82800")
const C_YELLOW := Color("#f8b800")
const C_CYAN := Color("#3cbcfc")
const C_GRAY := Color("#7c7c7c")
const C_DARK := Color("#545454")
## 5x7 bitmap font: 7 rows per glyph, 5 bits per row (MSB = left pixel).
const FONT := {"0": [14, 17, 19, 21, 25, 17, 14], "1": [4, 12, 4, 4, 4, 4, 14], "2": [14, 17, 1, 6, 8, 16, 31], "3": [31, 2, 4, 2, 1, 17, 14], "4": [2, 6, 10, 18, 31, 2, 2], "5": [31, 16, 30, 1, 1, 17, 14], "6": [6, 8, 16, 30, 17, 17, 14], "7": [31, 1, 2, 4, 8, 8, 8], "8": [14, 17, 17, 14, 17, 17, 14], "9": [14, 17, 17, 15, 1, 2, 12], "A": [14, 17, 17, 31, 17, 17, 17], "B": [30, 17, 17, 30, 17, 17, 30], "C": [14, 17, 16, 16, 16, 17, 14], "D": [28, 18, 17, 17, 17, 18, 28], "E": [31, 16, 16, 30, 16, 16, 31], "F": [31, 16, 16, 30, 16, 16, 16], "G": [14, 17, 16, 23, 17, 17, 15], "H": [17, 17, 17, 31, 17, 17, 17], "I": [14, 4, 4, 4, 4, 4, 14], "J": [7, 2, 2, 2, 2, 18, 12], "K": [17, 18, 20, 24, 20, 18, 17], "L": [16, 16, 16, 16, 16, 16, 31], "M": [17, 27, 21, 21, 17, 17, 17], "N": [17, 17, 25, 21, 19, 17, 17], "O": [14, 17, 17, 17, 17, 17, 14], "P": [30, 17, 17, 30, 16, 16, 16], "Q": [14, 17, 17, 17, 21, 18, 13], "R": [30, 17, 17, 30, 20, 18, 17], "S": [15, 16, 16, 14, 1, 1, 30], "T": [31, 4, 4, 4, 4, 4, 4], "U": [17, 17, 17, 17, 17, 17, 14], "V": [17, 17, 17, 17, 17, 10, 4], "W": [17, 17, 17, 21, 21, 21, 10], "X": [17, 17, 10, 4, 10, 17, 17], "Y": [17, 17, 17, 10, 4, 4, 4], "Z": [31, 1, 2, 4, 8, 16, 31], "-": [0, 0, 0, 31, 0, 0, 0], "!": [4, 4, 4, 4, 4, 0, 4], ":": [0, 12, 12, 0, 12, 12, 0], ".": [0, 0, 0, 0, 0, 12, 12], "x": [0, 0, 17, 10, 4, 10, 17], "(": [2, 4, 8, 8, 8, 4, 2], ")": [8, 4, 2, 2, 2, 4, 8]}

const TEX_PLAYER := preload("res://examples/shooter/sprites/player.png")
const TEX_LIFE := preload("res://examples/shooter/sprites/life.png")
const TEX_SHOT := preload("res://examples/shooter/sprites/shot.png")
const TEX_EBULLET := preload("res://examples/shooter/sprites/ebullet.png")
const TEX_EXPLOSION := preload("res://examples/shooter/sprites/explosion.png")
const TEX_CLOUD := preload("res://examples/shooter/sprites/cloud.png")
const TEX_ENEMY := {
	"a": preload("res://examples/shooter/sprites/enemy_a.png"),
	"b": preload("res://examples/shooter/sprites/enemy_b.png"),
	"c": preload("res://examples/shooter/sprites/enemy_c.png"),
	"d": preload("res://examples/shooter/sprites/enemy_d.png"),
	"boss": preload("res://examples/shooter/sprites/boss.png"),
}


class Enemy extends Sprite2D:
	var kind := "a"
	var hp := 1
	var t := 0
	var phase := 0
	var vel := Vector2.ZERO
	var base_x := 0.0
	var target_y := 60.0
	var fire_cd := 60
	var burst := 0
	var score_value := 100
	var radius := 7.0
	var flash := 0


class Bullet extends Sprite2D:
	var vel := Vector2.ZERO


class Effect extends Sprite2D:
	var t := 0


## Window scale factor applied when the game runs in its own window (not embedded in the editor).
@export var window_scale: int = 3
## Seed for enemy behaviour (fire timings, positions). 0 = random each game.
@export var rng_seed: int = 0
## Test hook: the player ignores every hit.
@export var invincible: bool = false
## Wave index used by Enter on the title screen (0..5, 5 = boss).
@export var start_wave: int = 0
## Test hook: false = regular waves neither spawn nor advance (the boss still spawns with start_boss()).
@export var waves_enabled: bool = true
## Test hook: the ship steers itself under the boss (or the lowest enemy); fire is still the player's input.
@export var autopilot: bool = false
## Frames between shots while fire is held.
@export var fire_interval: int = 7
## Max player shots on screen.
@export var max_shots: int = 5
## Invulnerability after a hit, in frames (blinking).
@export var invuln_frames: int = 120
@export var player_speed: float = 1.5

# --- Live state (game_query / game_wait_for) ---
var state := "title"  # title | play | gameover | clear
var score := 0
var hi_score := 0
var lives := 3
var wave := 0
var frame := 0
var state_timer := 0
var shots_fired := 0
var kills := 0
var hits_taken := 0
var explosions_spawned := 0
var enemies_spawned := 0
var enemy_bullets_fired := 0
var kinds_seen: Array = []
var invuln := 0
var player_alive := true
var bg_scroll := 0.0
var boss_active := false
var boss_defeated := false
var boss_hp := 0
var boss_max_hp := 0
var boss_pattern := -1
var boss_patterns_used: Array = []
var games_started := 0
var display_scale := 1
var enemy_count := 0
var shot_count := 0
## Most player shots on screen at once since start_game (for checking the max_shots cap).
var max_shot_count := 0
var enemy_bullet_count := 0
var explosion_count := 0
var score_text := "000000"
var banner := ""

var rng := RandomNumberGenerator.new()
var background: Node2D
var enemies: Node2D
var shots: Node2D
var enemy_bullets: Node2D
var effects: Node2D
var player: Sprite2D
var hud: Node2D
var _clouds: Array = []
var _stars: Array = []
var _fire_cd := 0
var _pending: Array = []
var _wave_frame := 0
var _wave_gap := -1
var _banner_t := 0
var _death_t := 0
var _boss: Enemy = null
var _boss_death_t := -1


func _ready() -> void:
	_setup_window()
	texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	background = _layer("Background", -10)
	background.draw.connect(_draw_background)
	var star_rng := RandomNumberGenerator.new()
	star_rng.seed = 12345
	for i in 70:
		var layer := star_rng.randi_range(0, 2)
		_stars.append({"x": star_rng.randi_range(0, SCREEN_W - 1), "y": star_rng.randf_range(0, SCREEN_H),
				"layer": layer, "phase": star_rng.randi_range(0, 63)})
	for i in 3:
		var cl := Sprite2D.new()
		cl.name = "Cloud%d" % i
		cl.texture = TEX_CLOUD
		cl.z_index = -9
		cl.position = Vector2(star_rng.randi_range(24, 232), -30 + i * 95)
		add_child(cl)
		_clouds.append(cl)
	enemies = _layer("Enemies", 0)
	shots = _layer("Shots", 1)
	player = Sprite2D.new()
	player.name = "Player"
	player.texture = TEX_PLAYER
	player.hframes = 2
	player.z_index = 2
	player.position = PLAYER_START
	player.visible = false
	add_child(player)
	enemy_bullets = _layer("EnemyBullets", 3)
	effects = _layer("Effects", 4)
	hud = _layer("HUD", 10)
	hud.draw.connect(_draw_hud)


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


func _layer(layer_name: String, z: int) -> Node2D:
	var n := Node2D.new()
	n.name = layer_name
	n.z_index = z
	add_child(n)
	return n


# ---------------------------------------------------------------- main loop

func _physics_process(_delta: float) -> void:
	bg_scroll += 1.0
	_update_clouds()
	match state:
		"title":
			if Input.is_action_just_pressed("shooter_start"):
				start_game()
		"play":
			_update_play()
		"gameover", "clear":
			state_timer += 1
			_update_enemies()
			_update_bullets()
			_update_effects()
			if state_timer > 30 and Input.is_action_just_pressed("shooter_start"):
				_to_title()
	_update_counts()
	background.queue_redraw()
	hud.queue_redraw()


func _update_play() -> void:
	frame += 1
	if _banner_t > 0:
		_banner_t -= 1
	_update_player()
	_update_waves()
	_update_enemies()
	_update_bullets()
	_update_effects()
	_check_collisions()
	_update_boss_death()
	if score > hi_score:
		hi_score = score
	if not player_alive:
		_death_t += 1
		if _death_t >= 90:
			state = "gameover"
			state_timer = 0


func _update_counts() -> void:
	enemy_count = enemies.get_child_count()
	shot_count = shots.get_child_count()
	max_shot_count = maxi(max_shot_count, shot_count)
	enemy_bullet_count = enemy_bullets.get_child_count()
	explosion_count = effects.get_child_count()
	score_text = "%06d" % score


# ---------------------------------------------------------------- hooks / flow

## Reset and start playing from the given wave (-1 = start_wave).
func start_game(from_wave: int = -1) -> String:
	_clear_world()
	if rng_seed != 0:
		rng.seed = rng_seed
	else:
		rng.randomize()
	score = 0
	lives = 3
	frame = 0
	shots_fired = 0
	max_shot_count = 0
	kills = 0
	hits_taken = 0
	explosions_spawned = 0
	enemies_spawned = 0
	enemy_bullets_fired = 0
	kinds_seen = []
	invuln = 0
	player_alive = true
	_death_t = 0
	_fire_cd = 0
	_reset_boss()
	player.position = PLAYER_START
	player.visible = true
	state = "play"
	state_timer = 0
	games_started += 1
	_begin_wave(start_wave if from_wave < 0 else clampi(from_wave, 0, BOSS_WAVE))
	return "play from wave %d" % wave


## Start straight at the boss fight.
func start_boss() -> String:
	return start_game(BOSS_WAVE)


func spawn_enemy(kind: String, x: float, y: float = -12.0) -> String:
	if not HP.has(kind):
		push_error("spawn_enemy: unknown kind '%s' (a, b, c, d, boss)" % kind)
		return ""
	var e := Enemy.new()
	e.kind = kind
	e.hp = HP[kind]
	e.score_value = SCORES[kind]
	e.radius = RADIUS[kind]
	e.texture = TEX_ENEMY[kind]
	e.hframes = 2
	e.position = Vector2(x, y)
	e.base_x = x
	e.target_y = rng.randf_range(36, 72)
	e.fire_cd = rng.randi_range(30, 70)
	enemies_spawned += 1
	e.name = "%s_%d" % [kind, enemies_spawned]
	if not kinds_seen.has(kind):
		kinds_seen.append(kind)
	if kind == "boss":
		e.position = Vector2(SCREEN_W / 2.0, -20)
		e.fire_cd = 60
		_boss = e
		boss_active = true
		boss_defeated = false
		boss_hp = e.hp
		boss_max_hp = e.hp
		boss_pattern = -1
		boss_patterns_used = []
		_boss_death_t = -1
	enemies.add_child(e)
	return String(e.name)


func spawn_enemy_bullet(x: float, y: float, vx: float, vy: float) -> String:
	var b := Bullet.new()
	b.texture = TEX_EBULLET
	b.hframes = 2
	b.position = Vector2(x, y)
	b.vel = Vector2(vx, vy)
	enemy_bullets_fired += 1
	b.name = "eb_%d" % enemy_bullets_fired
	enemy_bullets.add_child(b)
	return String(b.name)


func damage_boss(amount: int) -> int:
	if _boss != null and is_instance_valid(_boss) and not boss_defeated:
		_damage_enemy(_boss, amount)
	return boss_hp


func clear_enemies() -> void:
	for c in enemies.get_children() + enemy_bullets.get_children():
		c.free()
	_reset_boss()
	_pending = []


func summary() -> Dictionary:
	return {"state": state, "score": score, "hi_score": hi_score, "lives": lives, "wave": wave,
		"enemies": enemy_count, "shots": shot_count, "enemy_bullets": enemy_bullet_count,
		"boss_hp": boss_hp, "kinds_seen": kinds_seen, "display_scale": display_scale}


func _to_title() -> void:
	_clear_world()
	_reset_boss()
	state = "title"
	state_timer = 0
	player.visible = false


func _clear_world() -> void:
	for layer: Node2D in [enemies, shots, enemy_bullets, effects]:
		for c in layer.get_children():
			c.free()
	_pending = []


func _reset_boss() -> void:
	_boss = null
	boss_active = false
	boss_defeated = false
	boss_hp = 0
	boss_pattern = -1
	_boss_death_t = -1


# ---------------------------------------------------------------- waves

func _wave_events(w: int) -> Array:
	var ev: Array = []
	match w:
		0:
			for i in 6:
				ev.append([10 + i * 20, "a", 40 + i * 35])
		1:
			for i in 6:
				ev.append([10 + i * 18, "b", 72 if i % 2 == 0 else 184])
			ev.append([60, "a", 128])
		2:
			for i in 4:
				ev.append([10 + i * 30, "c", 48 + i * 53])
			ev.append([20, "a", 100])
			ev.append([50, "a", 156])
		3:
			ev.append([10, "d", 64])
			ev.append([10, "d", 192])
			ev.append([50, "d", 128])
			for i in 4:
				ev.append([70 + i * 20, "b", 96 + (i % 2) * 64])
		4:
			for i in 4:
				ev.append([10 + i * 24, "c", rng.randi_range(32, 224)])
			ev.append([30, "d", 80])
			ev.append([30, "d", 176])
			for i in 4:
				ev.append([100 + i * 15, "a", 40 + i * 58])
		BOSS_WAVE:
			ev.append([90, "boss", 128])
	ev.sort_custom(func(p: Array, q: Array) -> bool: return p[0] < q[0])
	return ev


func _begin_wave(w: int) -> void:
	wave = w
	_wave_frame = 0
	_wave_gap = -1
	_pending = _wave_events(w) if (waves_enabled or w == BOSS_WAVE) else []
	banner = "WARNING!" if w == BOSS_WAVE else "WAVE %d" % (w + 1)
	_banner_t = 0 if _pending.is_empty() else 90


func _update_waves() -> void:
	_wave_frame += 1
	while not _pending.is_empty():
		var ev: Array = _pending[0]
		if ev[0] > _wave_frame:
			break
		_pending.pop_front()
		spawn_enemy(ev[1], ev[2])
	if waves_enabled and wave < BOSS_WAVE and _pending.is_empty() and enemies.get_child_count() == 0:
		if _wave_gap < 0:
			_wave_gap = 60
		else:
			_wave_gap -= 1
			if _wave_gap <= 0:
				_begin_wave(wave + 1)


# ---------------------------------------------------------------- player

func _update_player() -> void:
	if not player_alive:
		return
	var dir := Input.get_vector("shooter_left", "shooter_right", "shooter_up", "shooter_down")
	if autopilot:
		var tx := _autopilot_target_x()
		dir = Vector2(clampf((tx - player.position.x) / 4.0, -1.0, 1.0), clampf((PLAYER_START.y - player.position.y) / 4.0, -1.0, 1.0))
	player.position = (player.position + dir * player_speed).clamp(PLAYER_MIN, PLAYER_MAX)
	if _fire_cd > 0:
		_fire_cd -= 1
	if Input.is_action_pressed("shooter_fire") and _fire_cd == 0 and shots.get_child_count() < max_shots:
		_fire()
	if invuln > 0:
		invuln -= 1
	player.visible = invuln == 0 or (invuln / 4) % 2 == 0
	player.frame = (frame / 4) % 2


func _autopilot_target_x() -> float:
	if _boss != null and is_instance_valid(_boss):
		return _boss.position.x
	var best: Enemy = null
	for n in enemies.get_children():
		var e := n as Enemy
		if best == null or e.position.y > best.position.y:
			best = e
	return best.position.x if best != null else PLAYER_START.x


func _fire() -> void:
	var s := Bullet.new()
	s.texture = TEX_SHOT
	s.position = player.position + Vector2(0, -10)
	s.vel = Vector2(0, -SHOT_SPEED)
	shots_fired += 1
	s.name = "shot_%d" % shots_fired
	shots.add_child(s)
	_fire_cd = fire_interval


func _hit_player() -> bool:
	if invincible or invuln > 0 or not player_alive or boss_defeated:
		return false
	hits_taken += 1
	lives -= 1
	spawn_explosion(player.position)
	if lives <= 0:
		player_alive = false
		player.visible = false
		_death_t = 0
	else:
		invuln = invuln_frames
	return true


# ---------------------------------------------------------------- enemies

func _update_enemies() -> void:
	for n in enemies.get_children():
		var e := n as Enemy
		e.t += 1
		match e.kind:
			"a":
				e.position.y += 1.2
			"b":
				e.position.y += 0.8
				e.position.x = e.base_x + sin(e.t * 0.05) * 36.0
			"c":
				_update_diver(e)
			"d":
				_update_gunner(e)
			"boss":
				_update_boss(e)
		e.frame = (e.t / 8) % 2
		if e.flash > 0:
			e.flash -= 1
		e.modulate = Color(4, 4, 4) if e.flash > 0 else Color.WHITE
		if e.kind != "boss" and (e.position.y > SCREEN_H + 24 or e.position.y < -60 \
				or e.position.x < -32 or e.position.x > SCREEN_W + 32):
			e.free()


## Diver: drops in, pauses, then charges at the ship (one aimed shot as it turns).
func _update_diver(e: Enemy) -> void:
	match e.phase:
		0:
			e.position.y += 1.6
			if e.position.y >= 56:
				e.phase = 1
				e.t = 0
		1:
			e.position.x += 1.0 if (e.t / 2) % 2 == 0 else -1.0
			if e.t >= 16:
				e.vel = _aim(e.position, 3.0)
				e.phase = 2
				_fire_aimed(e.position, 1.8)
		2:
			e.position += e.vel


## Gunner: descends to a hover height, fires aimed shots for a while, then leaves.
func _update_gunner(e: Enemy) -> void:
	match e.phase:
		0:
			e.position.y += 1.0
			if e.position.y >= e.target_y:
				e.phase = 1
				e.t = 0
		1:
			e.fire_cd -= 1
			if e.fire_cd <= 0:
				_fire_aimed(e.position + Vector2(0, 6), 1.5)
				e.fire_cd = 60
			if e.t >= 240:
				e.phase = 2
		2:
			e.position.y += 1.2


func _update_boss(e: Enemy) -> void:
	if boss_defeated:
		return
	if e.phase == 0:
		e.position.y += 0.5
		if e.position.y >= 52:
			e.phase = 1
			e.t = 0
		return
	var angry := boss_hp * 2 <= boss_max_hp
	var spd := 1.5 if angry else 1.0
	e.position.x = SCREEN_W / 2.0 + sin(e.t * 0.012 * spd) * 72.0
	var p := (e.t / 200) % 3
	if p != boss_pattern:
		boss_pattern = p
		e.burst = 0
		e.fire_cd = 20
		if not boss_patterns_used.has(p):
			boss_patterns_used.append(p)
	e.fire_cd -= 1
	if e.fire_cd > 0:
		return
	match boss_pattern:
		0:  # 5-way spread
			for i in 5:
				var a := PI / 2 + (i - 2) * 0.28
				spawn_enemy_bullet(e.position.x, e.position.y + 14, cos(a) * 1.6, sin(a) * 1.6)
			e.fire_cd = 28 if angry else 40
		1:  # aimed bursts from both cannons
			for off in [-16.0, 16.0]:
				_fire_aimed(e.position + Vector2(off, 14), 2.2)
			e.burst += 1
			if e.burst >= 3:
				e.burst = 0
				e.fire_cd = 30 if angry else 45
			else:
				e.fire_cd = 8
		2:  # rotating ring
			var base := e.t * 0.07
			for i in 12:
				var a := base + i * TAU / 12
				spawn_enemy_bullet(e.position.x, e.position.y + 4, cos(a) * 1.2, sin(a) * 1.2)
			e.fire_cd = 32 if angry else 45


func _damage_enemy(e: Enemy, amount: int) -> void:
	e.hp -= amount
	e.flash = 3
	if e.kind == "boss":
		boss_hp = maxi(e.hp, 0)
		if e.hp <= 0:
			_defeat_boss()
		return
	if e.hp <= 0:
		score += e.score_value
		kills += 1
		spawn_explosion(e.position)
		e.free()


func _defeat_boss() -> void:
	boss_defeated = true
	score += SCORES["boss"]
	kills += 1
	_boss_death_t = 0
	for c in enemy_bullets.get_children():
		c.free()
	for n in enemies.get_children():
		if n != _boss:
			spawn_explosion(n.position)
			n.free()


func _update_boss_death() -> void:
	if _boss_death_t < 0:
		return
	_boss_death_t += 1
	if _boss != null and is_instance_valid(_boss):
		if _boss_death_t % 6 == 0:
			spawn_explosion(_boss.position + Vector2(rng.randf_range(-20, 20), rng.randf_range(-10, 12)))
		if _boss_death_t >= 72:
			for i in 5:
				spawn_explosion(_boss.position + Vector2(-16 + i * 8, (i % 2) * 8 - 4))
			_boss.free()
			_boss = null
			boss_active = false
	if _boss_death_t >= 180 and state == "play":
		state = "clear"
		state_timer = 0
		banner = "STAGE CLEAR!"


# ---------------------------------------------------------------- bullets, effects, collisions

func _aim(from: Vector2, speed: float) -> Vector2:
	if not player_alive:
		return Vector2(0, speed)
	var d := player.position - from
	return Vector2(0, speed) if d.length() < 1.0 else d.normalized() * speed


func _fire_aimed(from: Vector2, speed: float) -> void:
	var v := _aim(from, speed)
	spawn_enemy_bullet(from.x, from.y, v.x, v.y)


func _update_bullets() -> void:
	for n in shots.get_children():
		var s := n as Bullet
		s.position += s.vel
		if s.position.y < -8:
			s.free()
	for n in enemy_bullets.get_children():
		var b := n as Bullet
		b.position += b.vel
		b.frame = (int(bg_scroll) / 4) % 2
		if b.position.y < -8 or b.position.y > SCREEN_H + 8 or b.position.x < -8 or b.position.x > SCREEN_W + 8:
			b.free()


func spawn_explosion(at: Vector2) -> void:
	var fx := Effect.new()
	fx.texture = TEX_EXPLOSION
	fx.hframes = 5
	fx.position = at
	explosions_spawned += 1
	fx.name = "fx_%d" % explosions_spawned
	effects.add_child(fx)


func _update_effects() -> void:
	for n in effects.get_children():
		var fx := n as Effect
		fx.t += 1
		if fx.t >= 20:
			fx.free()
		else:
			fx.frame = fx.t / 4


func _check_collisions() -> void:
	for sn in shots.get_children():
		var s := sn as Bullet
		for en in enemies.get_children():
			var e := en as Enemy
			var hit := false
			if e.kind == "boss":
				var d := s.position - e.position
				hit = e.phase == 1 and not boss_defeated and absf(d.x) < 22 and d.y > -14 and d.y < 12
			else:
				hit = s.position.distance_to(e.position) < e.radius + 2.0
			if hit:
				s.free()
				_damage_enemy(e, 1)
				break
	if not player_alive:
		return
	for bn in enemy_bullets.get_children():
		var b := bn as Bullet
		if b.position.distance_to(player.position) < PLAYER_RADIUS + 2.0 and _hit_player():
			b.free()
	for en in enemies.get_children():
		var e := en as Enemy
		if e.kind != "boss" and e.position.distance_to(player.position) < e.radius + PLAYER_RADIUS and _hit_player():
			spawn_explosion(e.position)
			e.free()


# ---------------------------------------------------------------- drawing

func _update_clouds() -> void:
	for cl: Sprite2D in _clouds:
		cl.position.y += 0.35
		if cl.position.y > SCREEN_H + 16:
			cl.position = Vector2(randi_range(24, 232), -16)


func _draw_background() -> void:
	background.draw_rect(Rect2(0, 0, SCREEN_W, SCREEN_H), C_BLACK)
	var speeds := [0.25, 0.5, 1.0]
	var colors := [C_DARK, C_GRAY, C_WHITE]
	for st: Dictionary in _stars:
		var layer: int = st["layer"]
		var y := fposmod(float(st["y"]) + bg_scroll * speeds[layer], SCREEN_H)
		var c: Color = colors[layer]
		if layer == 2 and (int(bg_scroll) + int(st["phase"])) % 64 < 6:
			c = C_CYAN
		background.draw_rect(Rect2(int(st["x"]), int(y), 1, 1 + int(layer == 2)), c)


func _draw_hud() -> void:
	if state == "title":
		_text_center("STAR RAIDER", 64, C_YELLOW, 2)
		_text_center("- NES STYLE SHOOTER -", 88, C_CYAN)
		_text_center("HI-SCORE %06d" % hi_score, 118, C_WHITE)
		if (int(bg_scroll) / 30) % 2 == 0:
			_text_center("PUSH ENTER", 150, C_WHITE)
		_text_center("ARROWS:MOVE  Z:FIRE", 186, C_GRAY)
		_text_center("(C) 2026 GODOT LOOP", 212, C_GRAY)
		return
	hud.draw_rect(Rect2(0, 0, SCREEN_W, 11), C_BLACK)
	_text("1P", Vector2(4, 2), C_RED)
	_text(score_text, Vector2(18, 2), C_WHITE)
	_text("HI", Vector2(92, 2), C_RED)
	_text("%06d" % hi_score, Vector2(106, 2), C_WHITE)
	_text("BOSS" if wave == BOSS_WAVE else "WAVE %d" % (wave + 1), Vector2(216, 2), C_CYAN)
	for i in maxi(lives, 0):
		hud.draw_texture(TEX_LIFE, Vector2(4 + i * 10, SCREEN_H - 11))
	if boss_active and not boss_defeated and _boss != null and is_instance_valid(_boss):
		_text("BOSS", Vector2(56, 14), C_RED)
		hud.draw_rect(Rect2(82, 14, 104, 7), C_WHITE, false, 1.0)
		hud.draw_rect(Rect2(84, 16, 100.0 * boss_hp / maxf(boss_max_hp, 1), 3), C_RED)
	match state:
		"play":
			if _banner_t > 0 and (_banner_t / 8) % 2 == 0:
				_text_center(banner, 100, C_YELLOW if wave == BOSS_WAVE else C_WHITE)
		"gameover":
			_text_center("GAME OVER", 96, C_RED, 2)
			if state_timer > 30 and (state_timer / 30) % 2 == 0:
				_text_center("PUSH ENTER", 130, C_WHITE)
		"clear":
			_text_center("STAGE CLEAR!", 90, C_YELLOW, 2)
			_text_center("SCORE %06d" % score, 116, C_WHITE)
			if state_timer > 30 and (state_timer / 30) % 2 == 0:
				_text_center("PUSH ENTER", 140, C_WHITE)


func _text_center(s: String, y: float, c: Color, sc: int = 1) -> void:
	_text(s, Vector2(floorf((SCREEN_W - (s.length() * 6 - 1) * sc) / 2.0), y), c, sc)


func _text(s: String, pos: Vector2, c: Color, sc: int = 1) -> void:
	var x := pos.x
	for ch in s:
		if FONT.has(ch):
			var rows: Array = FONT[ch]
			for r in 7:
				var bits: int = rows[r]
				for col in 5:
					if bits & (16 >> col):
						hud.draw_rect(Rect2(x + col * sc, pos.y + r * sc, sc, sc), c)
		x += 6 * sc

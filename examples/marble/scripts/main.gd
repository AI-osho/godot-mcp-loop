class_name MarbleMain
extends Node3D
## MARBLE RUN - game flow, camera-relative marble control and test hooks.

const TOTAL_COINS_EXPECTED := 10
const START_LIVES := 3
const FALL_Y := -10.0
const MOVE_FORCE := 18.0
const BRAKE_FORCE := 6.0
const MAX_SPEED := 9.0
const JUMP_STRENGTH := 6.0
const TIME_SCALE := 60.0
const STATE_LOCK_FRAMES := 30

const CHECKPOINT_SPAWNS: Array[Vector3] = [
	Vector3(0.0, 0.55, 4.0),
	Vector3(0.0, 2.1, -10.0),
	Vector3(0.0, 1.1, -34.0),
]

const CAMERA_OFFSET := Vector3(0.0, 3.6, 6.4)
const CAMERA_LOOK_OFFSET := Vector3(0.0, 0.6, 0.0)

@onready var ball: MarbleBall = $Ball
@onready var camera: Camera3D = $Camera3D
@onready var course: Node3D = $Course
@onready var goal: MarbleGoal = $Course/Goal
@onready var hud: MarbleHUD = $HUD

var state := "title"
var coins := 0
var coins_total := 0
var lives := START_LIVES
var time_frames := 0
var final_time_frames := 0
var checkpoint := 0
var input_lock_frames := 0
var fall_count := 0


func _ready() -> void:
	_setup_environment()
	_setup_course_signals()
	_enter_title()
	print("MAIN ready coins_total=%d" % coins_total)


func _physics_process(_delta: float) -> void:
	if input_lock_frames > 0:
		input_lock_frames -= 1
	match state:
		"title":
			if Input.is_action_just_pressed("marble_start"):
				start_game()
		"playing":
			_tick_playing()
		"clear", "game_over":
			if input_lock_frames <= 0 and Input.is_action_just_pressed("marble_start"):
				_enter_title()
	_update_camera(_delta)


# --- public test hooks -------------------------------------------------------

func start_game() -> void:
	state = "playing"
	coins = 0
	lives = START_LIVES
	time_frames = 0
	final_time_frames = 0
	checkpoint = 0
	input_lock_frames = 0
	fall_count = 0
	_reset_coins()
	goal.reset()
	ball.respawn(CHECKPOINT_SPAWNS[0])
	ball.freeze = false
	_snap_camera()
	hud.show_playing()
	hud.set_hud(coins, coins_total, lives, 0.0)
	print("STATE playing")


func teleport_ball(x: float, y: float, z: float) -> void:
	var was_frozen := ball.freeze
	ball.respawn(Vector3(x, y, z))
	ball.freeze = was_frozen
	_snap_camera()
	print("TELEPORT %.2f %.2f %.2f" % [x, y, z])


func set_checkpoint(index: int) -> void:
	checkpoint = clampi(index, 0, CHECKPOINT_SPAWNS.size() - 1)
	print("CHECKPOINT %d" % checkpoint)


func summary() -> Dictionary:
	var pos := ball.global_position
	return {
		"state": state,
		"coins": coins,
		"lives": lives,
		"time_frames": time_frames,
		"ball_pos": [pos.x, pos.y, pos.z],
		"ball_speed": ball.linear_velocity.length(),
		"on_floor": ball.is_grounded(),
		"checkpoint": checkpoint,
	}


func ball_on_screen() -> bool:
	var pos := ball.global_position
	if camera.is_position_behind(pos):
		return false
	var screen_pos := camera.unproject_position(pos)
	var viewport_size := get_viewport().get_visible_rect().size
	return (
		screen_pos.x >= 0.0
		and screen_pos.y >= 0.0
		and screen_pos.x <= viewport_size.x
		and screen_pos.y <= viewport_size.y
	)


# --- setup ------------------------------------------------------------------

func _setup_environment() -> void:
	var world_environment := $WorldEnvironment as WorldEnvironment
	var environment := Environment.new()
	environment.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sky_material := ProceduralSkyMaterial.new()
	sky_material.sky_top_color = Color(0.06, 0.17, 0.44)
	sky_material.sky_horizon_color = Color(0.7, 0.82, 0.96)
	sky_material.ground_bottom_color = Color(0.08, 0.12, 0.24)
	sky_material.ground_horizon_color = Color(0.3, 0.42, 0.62)
	sky.sky_material = sky_material
	environment.sky = sky
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	environment.ambient_light_energy = 0.8
	environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	world_environment.environment = environment


func _setup_course_signals() -> void:
	var coin_nodes := get_tree().get_nodes_in_group("coins")
	coins_total = coin_nodes.size()
	for node in coin_nodes:
		var coin := node as MarbleCoin
		if coin:
			coin.collected.connect(_on_coin_collected)
	var checkpoint_nodes := get_tree().get_nodes_in_group("checkpoints")
	for node in checkpoint_nodes:
		var marker := node as MarbleCheckpoint
		if marker:
			marker.checkpoint_entered.connect(_on_checkpoint_entered)
	goal.reached.connect(_on_goal_reached)
	if coins_total != TOTAL_COINS_EXPECTED:
		push_warning("Expected %d coins, found %d" % [TOTAL_COINS_EXPECTED, coins_total])


# --- game loop --------------------------------------------------------------

func _tick_playing() -> void:
	time_frames += 1
	_apply_movement()
	if Input.is_action_just_pressed("marble_jump"):
		if ball.jump(JUMP_STRENGTH):
			print("JUMP frame=%d" % time_frames)
	if ball.global_position.y < FALL_Y:
		_on_fall()
		return
	hud.set_hud(coins, coins_total, lives, float(time_frames) / TIME_SCALE)


func _apply_movement() -> void:
	var input_x := 0.0
	var input_y := 0.0
	if Input.is_action_pressed("marble_left"):
		input_x -= 1.0
	if Input.is_action_pressed("marble_right"):
		input_x += 1.0
	if Input.is_action_pressed("marble_forward"):
		input_y += 1.0
	if Input.is_action_pressed("marble_back"):
		input_y -= 1.0
	if input_x == 0.0 and input_y == 0.0:
		if ball.is_grounded():
			var horizontal := Vector3(ball.linear_velocity.x, 0.0, ball.linear_velocity.z)
			if horizontal.length() > 0.25:
				ball.apply_central_force(-horizontal.normalized() * BRAKE_FORCE)
		return
	var camera_basis := camera.global_transform.basis
	var forward := -camera_basis.z
	forward.y = 0.0
	forward = forward.normalized()
	var right := camera_basis.x
	right.y = 0.0
	right = right.normalized()
	var direction := (right * input_x + forward * input_y).normalized()
	if ball.linear_velocity.length() < MAX_SPEED:
		ball.apply_central_force(direction * MOVE_FORCE)


func _on_coin_collected(_coin: MarbleCoin) -> void:
	if state != "playing":
		return
	coins += 1
	print("COINS %d/%d" % [coins, coins_total])
	hud.set_hud(coins, coins_total, lives, float(time_frames) / TIME_SCALE)


func _on_checkpoint_entered(index: int) -> void:
	if state != "playing":
		return
	if index > checkpoint:
		set_checkpoint(index)


func _on_goal_reached() -> void:
	if state != "playing":
		return
	state = "clear"
	final_time_frames = time_frames
	input_lock_frames = STATE_LOCK_FRAMES
	ball.freeze = true
	hud.show_clear(float(final_time_frames) / TIME_SCALE, coins, coins_total)
	hud.set_hud(coins, coins_total, lives, float(final_time_frames) / TIME_SCALE)
	print("STATE clear time_frames=%d coins=%d" % [final_time_frames, coins])


func _on_fall() -> void:
	fall_count += 1
	lives -= 1
	print("FALL #%d lives=%d checkpoint=%d" % [fall_count, lives, checkpoint])
	if lives <= 0:
		lives = 0
		state = "game_over"
		input_lock_frames = STATE_LOCK_FRAMES
		ball.respawn(CHECKPOINT_SPAWNS[checkpoint])
		ball.freeze = true
		_snap_camera()
		hud.show_game_over(coins, coins_total)
		hud.set_hud(coins, coins_total, lives, float(time_frames) / TIME_SCALE)
		print("STATE game_over")
		return
	ball.respawn(CHECKPOINT_SPAWNS[checkpoint])
	ball.freeze = false
	_snap_camera()
	hud.set_hud(coins, coins_total, lives, float(time_frames) / TIME_SCALE)


func _enter_title() -> void:
	state = "title"
	coins = 0
	lives = START_LIVES
	time_frames = 0
	final_time_frames = 0
	checkpoint = 0
	input_lock_frames = 0
	fall_count = 0
	_reset_coins()
	goal.reset()
	ball.respawn(CHECKPOINT_SPAWNS[0])
	ball.freeze = true
	_snap_camera()
	hud.show_title()
	hud.set_hud(coins, coins_total, lives, 0.0)
	print("STATE title")


func _reset_coins() -> void:
	for node in get_tree().get_nodes_in_group("coins"):
		var coin := node as MarbleCoin
		if coin:
			coin.reset()


# --- camera -----------------------------------------------------------------

func _update_camera(delta: float) -> void:
	var center := ball.global_position
	var desired := center + CAMERA_OFFSET
	desired = _avoid_wall(center + Vector3(0.0, 0.8, 0.0), desired)
	var smoothing := 1.0 - exp(-8.0 * delta)
	camera.global_position = camera.global_position.lerp(desired, smoothing)
	if camera.global_position.distance_to(center) > 0.1:
		camera.look_at(center + CAMERA_LOOK_OFFSET, Vector3.UP)


func _snap_camera() -> void:
	var center := ball.global_position
	camera.global_position = center + CAMERA_OFFSET
	camera.look_at(center + CAMERA_LOOK_OFFSET, Vector3.UP)


func _avoid_wall(from: Vector3, to: Vector3) -> Vector3:
	var space := get_world_3d().direct_space_state
	var query := PhysicsRayQueryParameters3D.create(from, to, 1, [ball.get_rid()])
	var hit := space.intersect_ray(query)
	if hit:
		var hit_position: Vector3 = hit["position"]
		var hit_normal: Vector3 = hit["normal"]
		return hit_position + hit_normal * 0.3
	return to

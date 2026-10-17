extends CharacterBody2D
## Minimal platformer player used by the godot-mcp-loop examples and e2e tests.

@export var speed := 220.0
@export var jump_velocity := -420.0

var gravity: float = ProjectSettings.get_setting("physics/2d/default_gravity", 980.0)
var jumps := 0


func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y += gravity * delta
	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = jump_velocity
		jumps += 1
		print("jump #%d" % jumps)
	velocity.x = Input.get_axis("move_left", "move_right") * speed
	move_and_slide()

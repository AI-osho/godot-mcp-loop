class_name MarbleBall
extends RigidBody3D
## The player marble. The main script applies camera-relative rolling forces;
## this script reports grounding and handles jumping / respawning.
##
## Grounding is a downward ray rather than a contact check: the marble is a sphere on flat platforms, and a ray
## is cheap and stable. 0.75 m is a little more than the radius (0.5) plus the small gap that a resting rigid
## body keeps in Godot, so a grounded marble always reports true. The ball excludes its own RID, or the ray would
## hit the marble itself.

const GROUND_RAY_LENGTH := 0.75

var grounded := false


func _ready() -> void:
	can_sleep = false
	var marble_material := StandardMaterial3D.new()
	marble_material.albedo_color = Color(0.16, 0.48, 0.95)
	marble_material.metallic = 0.15
	marble_material.roughness = 0.28
	var mesh := get_node_or_null("Mesh") as MeshInstance3D
	if mesh:
		mesh.material_override = marble_material
	var stripe := get_node_or_null("Stripe") as MeshInstance3D
	if stripe:
		var stripe_material := StandardMaterial3D.new()
		stripe_material.albedo_color = Color(0.95, 0.96, 1.0)
		stripe_material.roughness = 0.4
		stripe.material_override = stripe_material


func _physics_process(_delta: float) -> void:
	var space := get_world_3d().direct_space_state
	var query := PhysicsRayQueryParameters3D.create(
		global_position,
		global_position + Vector3.DOWN * GROUND_RAY_LENGTH,
		1,
		[get_rid()]
	)
	grounded = not space.intersect_ray(query).is_empty()


func is_grounded() -> bool:
	return grounded


## An impulse in m/s, not a velocity assignment: the marble keeps whatever horizontal speed it had, which is what
## makes a running jump cross a gap.
func jump(strength: float) -> bool:
	if not grounded:
		return false
	apply_central_impulse(Vector3.UP * strength)
	grounded = false
	return true


## Freeze while moving, then unfreeze, so the physics engine does not carry the old velocity into the new spot.
func respawn(pos: Vector3) -> void:
	freeze = true
	global_position = pos
	rotation = Vector3.ZERO
	linear_velocity = Vector3.ZERO
	angular_velocity = Vector3.ZERO
	freeze = false
	sleeping = false

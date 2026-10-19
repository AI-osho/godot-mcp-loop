class_name MarbleBall
extends RigidBody3D
## The player marble. The main script applies camera-relative rolling forces;
## this script reports grounding and handles jumping / respawning.

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


func jump(strength: float) -> bool:
	if not grounded:
		return false
	apply_central_impulse(Vector3.UP * strength)
	grounded = false
	return true


func respawn(pos: Vector3) -> void:
	freeze = true
	global_position = pos
	rotation = Vector3.ZERO
	linear_velocity = Vector3.ZERO
	angular_velocity = Vector3.ZERO
	freeze = false
	sleeping = false

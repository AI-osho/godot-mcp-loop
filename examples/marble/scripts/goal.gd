class_name MarbleGoal
extends Area3D
## The finish gate. Emits `reached` once when the marble rolls through it.

signal reached

var triggered := false


func _ready() -> void:
	var goal_material := StandardMaterial3D.new()
	goal_material.albedo_color = Color(0.15, 0.95, 0.45)
	goal_material.metallic = 0.3
	goal_material.roughness = 0.3
	goal_material.emission_enabled = true
	goal_material.emission = Color(0.1, 0.9, 0.35)
	goal_material.emission_energy_multiplier = 1.2
	for child in get_children():
		var mesh_instance := child as MeshInstance3D
		if mesh_instance:
			mesh_instance.material_override = goal_material
	body_entered.connect(_on_body_entered)


func _on_body_entered(body: Node3D) -> void:
	if triggered:
		return
	if body is RigidBody3D:
		triggered = true
		reached.emit()
		print("GOAL reached")


func reset() -> void:
	triggered = false

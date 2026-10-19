class_name MarbleCheckpoint
extends Area3D
## A checkpoint pad. The main script remembers the highest index the marble touched.

signal checkpoint_entered(index: int)

@export var index: int = 1


func _ready() -> void:
	add_to_group("checkpoints")
	var ring_material := StandardMaterial3D.new()
	ring_material.albedo_color = Color(0.2, 0.9, 0.55)
	ring_material.metallic = 0.2
	ring_material.roughness = 0.4
	ring_material.emission_enabled = true
	ring_material.emission = Color(0.1, 0.8, 0.4)
	ring_material.emission_energy_multiplier = 0.6
	var ring := get_node_or_null("Ring") as MeshInstance3D
	if ring:
		ring.material_override = ring_material
	body_entered.connect(_on_body_entered)


func _on_body_entered(body: Node3D) -> void:
	if body is RigidBody3D:
		checkpoint_entered.emit(index)

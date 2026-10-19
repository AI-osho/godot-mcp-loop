class_name MarbleCoin
extends Area3D
## A spinning collectible coin. Touching it hides it and emits `collected`.

signal collected(coin: MarbleCoin)

const SPIN_SPEED := 2.6

var picked_up := false


func _ready() -> void:
	add_to_group("coins")
	var coin_material := StandardMaterial3D.new()
	coin_material.albedo_color = Color(1.0, 0.78, 0.12)
	coin_material.metallic = 0.85
	coin_material.roughness = 0.22
	coin_material.emission_enabled = true
	coin_material.emission = Color(1.0, 0.62, 0.05)
	coin_material.emission_energy_multiplier = 0.35
	var mesh := get_node_or_null("Mesh") as MeshInstance3D
	if mesh:
		mesh.material_override = coin_material
	body_entered.connect(_on_body_entered)


func _physics_process(delta: float) -> void:
	if picked_up:
		return
	rotate_y(SPIN_SPEED * delta)


func _on_body_entered(body: Node3D) -> void:
	if picked_up:
		return
	if body is RigidBody3D:
		picked_up = true
		visible = false
		set_deferred("monitoring", false)
		collected.emit(self)
		print("COIN collected %s" % name)


func reset() -> void:
	picked_up = false
	visible = true
	rotation = Vector3.ZERO
	set_deferred("monitoring", true)

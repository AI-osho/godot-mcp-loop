class_name MarblePlatform
extends StaticBody3D
## A resizable floating platform. Size and color are applied in _ready so every
## instance owns its mesh and shape (the .tscn subresources are shared otherwise).
##
## Instanced scenes share the Mesh and Shape resources declared in platform.tscn, so writing `size` on one
## instance would resize every platform. Duplicating before touching them keeps one scene reusable for the whole
## course, which is how the seven platforms differ only by platform_size and color.

@export var platform_size: Vector3 = Vector3(4.0, 0.5, 4.0)
@export var color: Color = Color(0.42, 0.52, 0.68)


func _ready() -> void:
	_apply_size()
	_apply_color()


func _apply_size() -> void:
	var mesh_instance := get_node_or_null("MeshInstance3D") as MeshInstance3D
	if mesh_instance and mesh_instance.mesh:
		mesh_instance.mesh = mesh_instance.mesh.duplicate()
		var box := mesh_instance.mesh as BoxMesh
		if box:
			box.size = platform_size
	var collision := get_node_or_null("CollisionShape3D") as CollisionShape3D
	if collision and collision.shape:
		collision.shape = collision.shape.duplicate()
		var shape := collision.shape as BoxShape3D
		if shape:
			shape.size = platform_size


func _apply_color() -> void:
	var mesh_instance := get_node_or_null("MeshInstance3D") as MeshInstance3D
	if mesh_instance == null:
		return
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.72
	material.metallic = 0.05
	mesh_instance.material_override = material

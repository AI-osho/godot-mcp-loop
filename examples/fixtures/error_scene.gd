extends Node2D
## Fixture: raises a script error shortly after start, then keeps running.
## Used to verify that a debugger break is auto-continued and reported.

var ticks := 0


func _ready() -> void:
	get_tree().create_timer(0.3).timeout.connect(_explode)


func _process(_delta: float) -> void:
	ticks += 1


func _explode() -> void:
	var missing: Node = null
	missing.queue_free()

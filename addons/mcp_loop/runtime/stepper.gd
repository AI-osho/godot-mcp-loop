extends Node
## Lets the game run exactly N physics frames, then pauses it again.
## It processes last in each physics frame (highest priority value), so every
## pausable game node gets the same N frames.

signal finished

var _left: int


func _init(frames: int) -> void:
	_left = frames
	process_mode = Node.PROCESS_MODE_PAUSABLE
	process_physics_priority = 1 << 30


func _physics_process(_delta: float) -> void:
	_left -= 1
	if _left <= 0:
		get_tree().paused = true
		set_physics_process(false)
		finished.emit()

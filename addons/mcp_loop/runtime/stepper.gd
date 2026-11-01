extends Node
## Lets the game run exactly N physics frames, then pauses it again.
## It processes last in each physics frame (highest priority value), so every
## pausable game node gets the same N frames.
##
## Input for the step (press / release / tap) is sent by apply_input() before
## the first stepped frame, outside physics processing, like real input. Godot
## counts an action pressed during a physics frame as "just pressed" only from
## the next frame on, so input sent from inside the frame would arrive a frame
## late (and never, in a one-frame step). Taps are released at the end of the
## first frame, after every game node has seen the press.

signal finished

var _left: int
var _frame := 0
var _tap: Array
var _pause_at_end: bool


func _init(frames: int, tap: Array = [], pause_at_end: bool = true) -> void:
	_left = frames
	_tap = tap
	_pause_at_end = pause_at_end
	process_mode = Node.PROCESS_MODE_PAUSABLE
	process_physics_priority = 1 << 30


## Sends the step's input as action events and dispatches them right away, so
## both Input.is_action_*() polling and _input/_unhandled_input see them.
## Call it outside a physics frame, after unpausing.
static func apply_input(press: Array, release: Array, tap: Array) -> void:
	for action in release:
		_send(action, false)
	for action in press + tap:
		_send(action, true)
	Input.flush_buffered_events()


func _physics_process(_delta: float) -> void:
	_frame += 1
	if _frame == 1 and not _tap.is_empty():
		for action in _tap:
			_send(action, false)
		Input.flush_buffered_events()
	_left -= 1
	if _left <= 0:
		if _pause_at_end:
			get_tree().paused = true
		set_physics_process(false)
		finished.emit()


static func _send(action: String, pressed: bool, strength: float = 1.0) -> void:
	# Native focus loss clears event/device state, not API-owned actions. A tool hold lasts until its explicit release.
	# Keep the event too: game _input/_unhandled_input callbacks must still receive the press and release.
	if pressed:
		Input.action_press(action, strength)
	else:
		Input.action_release(action)
	var event := InputEventAction.new()
	event.action = StringName(action)
	event.pressed = pressed
	event.strength = strength if pressed else 0.0
	# Dispatch callbacks without registering a device-held event, which native focus loss would release again.
	var tree := Engine.get_main_loop() as SceneTree
	if tree != null:
		tree.root.push_input(event)

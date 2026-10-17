extends RefCounted
## Keeps the editor responsive while an MCP client is working.
##
## In low-processor mode the editor sleeps between main-loop iterations
## (interface/editor/timers/unfocused_low_processor_mode_sleep_usec = 100 ms by
## default while its window is in the background). The bridge is polled once per
## iteration and replies from the game are also picked up per iteration, so each
## hop cost ~100 ms and a game query ~300 ms. While requests are active, use a
## short sleep; restore the editor's own value when it goes quiet. Rendering is
## unaffected: low-processor mode still only redraws when something changes.

const FAST_SLEEP_USEC := 5000

var _restore: Callable
var _saved := -1


## `restore` returns the value to go back to (the editor's setting for the
## current focus state). Without it, the value seen before boosting is restored.
func _init(restore: Callable = Callable()) -> void:
	_restore = restore


func is_boosted() -> bool:
	return _saved >= 0


func update(active: bool) -> void:
	if active:
		if _saved < 0:
			_saved = OS.low_processor_usage_mode_sleep_usec
		# The editor rewrites the value on focus changes; re-apply while active.
		if OS.low_processor_usage_mode_sleep_usec != FAST_SLEEP_USEC:
			OS.low_processor_usage_mode_sleep_usec = FAST_SLEEP_USEC
	elif _saved >= 0:
		OS.low_processor_usage_mode_sleep_usec = int(_restore.call()) if _restore.is_valid() else _saved
		_saved = -1

@tool
extends Logger
## Thread-safe ring buffer of engine log output (print, push_error, script
## errors, warnings). Used for logs_read and to report compile errors.
## Logger callbacks may arrive from any thread, so all state is mutex-guarded.

const LEVELS := {"info": 0, "warning": 1, "error": 2, "script_error": 2, "shader_error": 2}
const OWN_PREFIX := "[mcp_loop]"

var _mutex := Mutex.new()
var _entries: Array = []
var _capacity: int
var _next_seq := 1
var _dropped := false


func _init(capacity: int = 2000) -> void:
	_capacity = capacity


func cursor() -> int:
	_mutex.lock()
	var c := _next_seq
	_mutex.unlock()
	return c


func _push(entry: Dictionary) -> void:
	_mutex.lock()
	entry["seq"] = _next_seq
	entry["time_ms"] = Time.get_ticks_msec()
	_next_seq += 1
	_entries.append(entry)
	if _entries.size() > _capacity:
		_entries.pop_front()
		_dropped = true
	_mutex.unlock()


func _log_message(message: String, error: bool) -> void:
	var text := message.strip_edges(false, true)
	if text.begins_with(OWN_PREFIX):
		return
	_push({"level": "error" if error else "info", "message": text})


func _log_error(function: String, file: String, line: int, code: String, rationale: String,
		_editor_notify: bool, error_type: int, script_backtraces: Array[ScriptBacktrace]) -> void:
	var level := "error"
	match error_type:
		Logger.ERROR_TYPE_WARNING:
			level = "warning"
		Logger.ERROR_TYPE_SCRIPT:
			level = "script_error"
		Logger.ERROR_TYPE_SHADER:
			level = "shader_error"
	var entry := {
		"level": level,
		"message": rationale if rationale != "" else code,
		"file": file,
		"line": line,
		"function": function,
	}
	if not script_backtraces.is_empty():
		var frames: Array = []
		for bt in script_backtraces:
			for i in bt.get_frame_count():
				frames.append("%s:%d in %s()" % [bt.get_frame_file(i), bt.get_frame_line(i), bt.get_frame_function(i)])
		entry["stack"] = frames
	_push(entry)


## Returns {entries, next, dropped}. `next` is the cursor to pass next time.
func read(since: int, min_level: String = "info", limit: int = 500) -> Dictionary:
	var min_rank: int = LEVELS.get(min_level, 0)
	_mutex.lock()
	var out: Array = []
	var next := _next_seq
	for e in _entries:
		if e.seq < since or LEVELS.get(e.level, 0) < min_rank:
			continue
		out.append(e.duplicate())
		if out.size() >= limit:
			next = e.seq + 1
			break
	var dropped := _dropped
	_mutex.unlock()
	return {"entries": out, "next": next, "dropped": dropped}

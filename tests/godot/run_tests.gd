extends SceneTree
## Dependency-free unit test runner.
## Usage: godot --headless --path . --script res://tests/godot/run_tests.gd [-- --filter=<substring>]
## Exit code: 0 when every test passes, 1 otherwise.
## Tests may be coroutines (use `await`). Script runtime errors raised during a
## test are captured via a Logger and fail that test.

const UNIT_DIR := "res://tests/godot/unit"


class ErrorCapture extends Logger:
	var _mutex := Mutex.new()
	var _errors: Array[String] = []

	func _log_error(function: String, file: String, line: int, code: String,
			rationale: String, _editor_notify: bool, error_type: int,
			_script_backtraces: Array[ScriptBacktrace]) -> void:
		# Warnings are not test failures.
		if error_type == Logger.ERROR_TYPE_WARNING:
			return
		_mutex.lock()
		_errors.append("%s:%d %s() %s %s" % [file, line, function, code, rationale])
		_mutex.unlock()

	func _log_message(_message: String, _error: bool) -> void:
		pass

	func take() -> Array[String]:
		_mutex.lock()
		var out := _errors.duplicate()
		_errors.clear()
		_mutex.unlock()
		return out


func _initialize() -> void:
	_run_all()


func _run_all() -> void:
	var filter := ""
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--filter="):
			filter = arg.substr("--filter=".length())

	var capture := ErrorCapture.new()
	OS.add_logger(capture)

	var passed := 0
	var failed := 0
	var files := _test_files()
	if files.is_empty():
		printerr("No test files found in %s" % UNIT_DIR)
		quit(1)
		return

	for path in files:
		var script: GDScript = load(path)
		if script == null or not script.can_instantiate():
			print("FAIL  %s (could not load script)" % path)
			failed += 1
			continue
		for method in script.get_script_method_list():
			var name: String = method["name"]
			if not name.begins_with("test_"):
				continue
			var full_name := "%s::%s" % [path.get_file(), name]
			if filter != "" and not full_name.contains(filter):
				continue
			var instance: Object = script.new()
			if instance.has_method("set_tree"):
				instance.call("set_tree", self)
			capture.take()
			if instance.has_method("before_each"):
				await instance.call("before_each")
			await instance.call(name)
			var problems: Array[String] = []
			problems.append_array(instance.get_failures())
			for err in capture.take():
				problems.append("runtime error: " + err)
			if instance.has_method("after_each"):
				await instance.call("after_each")
			if problems.is_empty():
				passed += 1
				print("PASS  ", full_name)
			else:
				failed += 1
				print("FAIL  ", full_name)
				for p in problems:
					print("      - ", p)

	OS.remove_logger(capture)
	print("\n%d passed, %d failed" % [passed, failed])
	quit(1 if failed > 0 else 0)


func _test_files() -> Array[String]:
	var out: Array[String] = []
	var dir := DirAccess.open(UNIT_DIR)
	if dir == null:
		return out
	for f in dir.get_files():
		if f.begins_with("test_") and f.ends_with(".gd"):
			out.append(UNIT_DIR.path_join(f))
	out.sort()
	return out

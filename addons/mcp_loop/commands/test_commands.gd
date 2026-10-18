@tool
extends RefCounted
## tests.run: runs the project's GUT or GdUnit4 unit tests in a separate headless Godot process and returns
## structured results from the JUnit report.
##
## The process is the editor's own executable (no Godot path needed), started with an argument list (no shell). Only
## the two frameworks' own runner scripts at their fixed paths are started; test paths go through PathGuard. Like
## game.run, this runs the project's code (its tests). One run at a time; stopped at the timeout. The report and log
## are written to res://.godot/mcp_loop/tests/ (not reachable by the file tools).

const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")
const PathGuard = preload("res://addons/mcp_loop/util/path_guard.gd")
const JUnit = preload("res://addons/mcp_loop/util/junit.gd")

const GUT_RUNNER := "res://addons/gut/gut_cmdln.gd"
const GUT_CONFIG := "res://.gutconfig.json"
const GDUNIT_RUNNER := "res://addons/gdUnit4/bin/GdUnitCmdTool.gd"
const WORK_DIR := "res://.godot/mcp_loop/tests"
const DEFAULT_DIRS := ["res://test", "res://tests"]
const MAX_FAILURES := 50
const MAX_LISTED_TESTS := 200

static var _ident_re := RegEx.create_from_string("^[A-Za-z_][A-Za-z0-9_]{0,199}$")

var tree: SceneTree
var _running := false


func _init(scene_tree: SceneTree) -> void:
	tree = scene_tree


func register(router: RefCounted) -> void:
	router.register("tests.run", _run)


## Frameworks whose runner script exists, in a fixed order.
static func detect(file_exists: Callable) -> Array:
	var found: Array = []
	if file_exists.call(GUT_RUNNER):
		found.append("gut")
	if file_exists.call(GDUNIT_RUNNER):
		found.append("gdunit4")
	return found


## Validates the request and builds the argument list. Returns {ok: true, framework, path, args} or an error envelope.
static func plan(p: Dictionary, file_exists: Callable, dir_exists: Callable, work_abs: String) -> Dictionary:
	var fw := String(p.get("framework", "auto"))
	if not fw in ["auto", "gut", "gdunit4"]:
		return Protocol.err(Protocol.INVALID_PARAMS, "framework must be 'gut', 'gdunit4' or 'auto' (got '%s')." % fw)
	var installed := detect(file_exists)
	if fw == "auto":
		if installed.is_empty():
			return Protocol.err(Protocol.TEST_FRAMEWORK_NOT_FOUND,
				"No test framework found: neither GUT (%s) nor GdUnit4 (%s) is installed." % [GUT_RUNNER, GDUNIT_RUNNER],
				"Install one from the Asset Library or its GitHub release (this tool does not install add-ons).")
		if installed.size() > 1:
			return Protocol.err(Protocol.INVALID_PARAMS, "Both GUT and GdUnit4 are installed; pass framework: 'gut' or 'gdunit4'.")
		fw = installed[0]
	elif not fw in installed:
		return Protocol.err(Protocol.TEST_FRAMEWORK_NOT_FOUND, "%s is not installed (%s is missing)." % [
			"GUT" if fw == "gut" else "GdUnit4", GUT_RUNNER if fw == "gut" else GDUNIT_RUNNER])

	var test := String(p.get("test", ""))
	if test != "":
		if _ident_re.search(test) == null:
			return Protocol.err(Protocol.INVALID_PARAMS, "test is a test function name: letters, digits and '_' (got '%s')." % test.c_escape())
		if fw == "gdunit4":
			return Protocol.err(Protocol.INVALID_PARAMS, "GdUnit4 can't select a single test by name; pass the test suite file as path.")

	var path := String(p.get("path", ""))
	var is_file := false
	if path != "":
		var reason := PathGuard.check_read(path)
		if reason != "":
			return Protocol.err(Protocol.PATH_FORBIDDEN, reason)
		path = PathGuard.normalize(path)
		if path.ends_with(".gd"):
			if not file_exists.call(path):
				return Protocol.err(Protocol.FILE_NOT_FOUND, "Test script not found: %s" % path)
			is_file = true
		elif not dir_exists.call(path):
			return Protocol.err(Protocol.FILE_NOT_FOUND, "Test folder not found: %s" % path)
	elif not (fw == "gut" and file_exists.call(GUT_CONFIG)):
		for d in DEFAULT_DIRS:
			if dir_exists.call(d):
				path = d
				break
		if path == "":
			return Protocol.err(Protocol.FILE_NOT_FOUND, "No test folder found (%s); pass path." % ", ".join(DEFAULT_DIRS))

	var args := PackedStringArray(["--headless", "--path", ProjectSettings.globalize_path("res://"),
		"--log-file", work_abs.path_join("run.log")])
	if fw == "gut":
		args.append_array(["-s", GUT_RUNNER, "-gexit", "-gdisable_colors", "-gjunit_xml_file=" + work_abs.path_join("gut.xml")])
		if is_file:
			args.append("-gtest=" + path)
		elif path != "":
			args.append_array(["-gdir=" + path, "-ginclude_subdirs"])
		if test != "":
			args.append("-gunit_test_name=" + test)
	else:
		args.append_array(["-s", GDUNIT_RUNNER, "--ignoreHeadlessMode", "-c", "-a", path,
			"-rd", WORK_DIR + "/gdunit", "-rc", "1"])
	return {"ok": true, "framework": fw, "path": path if path != "" else GUT_CONFIG, "args": args}


## Error lines from a Godot log ("SCRIPT ERROR:", "ERROR:", "USER ERROR:"), with the "at:" line that follows.
static func log_errors(text: String, limit: int = 10) -> Array:
	var out: Array = []
	var lines := text.split("\n")
	for i in lines.size():
		var line := lines[i].strip_edges()
		if line.begins_with("SCRIPT ERROR:") or line.begins_with("ERROR:") or line.begins_with("USER ERROR:"):
			if i + 1 < lines.size() and lines[i + 1].strip_edges().begins_with("at:"):
				line += " (" + lines[i + 1].strip_edges() + ")"
			out.append(line.substr(0, 300))
			if out.size() >= limit:
				break
	return out


static func log_tail(text: String, count: int) -> Array:
	var lines := Array(text.split("\n"))
	while not lines.is_empty() and String(lines.back()).strip_edges() == "":
		lines.pop_back()
	return lines.slice(maxi(0, lines.size() - count))


## The result payload from a finished run.
static func build_result(pl: Dictionary, parsed: Dictionary, exit_code: int, duration_ms: int, log_text: String) -> Dictionary:
	var r := {"framework": pl.framework, "path": pl.path, "exit_code": exit_code, "duration_ms": duration_ms}
	if parsed.ok:
		r.totals = parsed.totals
		r.failures = parsed.tests.filter(func(t: Dictionary) -> bool: return t.status in ["failed", "error"]).slice(0, MAX_FAILURES)
		if parsed.tests.size() <= MAX_LISTED_TESTS:
			r.tests = parsed.tests.map(func(t: Dictionary) -> Dictionary: return {"suite": t.suite, "name": t.name, "status": t.status})
		r.passed = parsed.totals.tests > 0 and parsed.totals.failed == 0 and parsed.totals.errors == 0
		if parsed.totals.tests == 0:
			r.report_error = "No tests were found."
	else:
		r.totals = parsed.totals
		r.failures = []
		r.passed = false
		r.report_error = "No test report was written: %s" % parsed.get("error", "")
	var errs := log_errors(log_text)
	if not errs.is_empty():
		r.log_errors = errs
	if not r.passed:
		r.log_tail = log_tail(log_text, 25)
	return r


func _run(p: Dictionary) -> Dictionary:
	if _running:
		return Protocol.err(Protocol.BUSY, "A test run is already in progress.")
	var work_abs := ProjectSettings.globalize_path(WORK_DIR)
	var pl := plan(p,
		func(f: String) -> bool: return FileAccess.file_exists(f),
		func(d: String) -> bool: return DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(d)),
		work_abs)
	if not pl.get("ok", false):
		return pl
	var timeout_ms := clampi(int(p.get("timeout_ms", 120000)), 5000, 600000)
	_prepare(work_abs)
	_running = true
	var started := Time.get_ticks_msec()
	var pid := OS.create_process(OS.get_executable_path(), pl.args)
	if pid <= 0:
		_running = false
		return Protocol.err(Protocol.INTERNAL, "Could not start Godot for the tests (%s)." % OS.get_executable_path())
	var deadline := started + timeout_ms
	while OS.is_process_running(pid):
		if Time.get_ticks_msec() > deadline:
			OS.kill(pid)
			_running = false
			return Protocol.err(Protocol.TIMEOUT, "The tests did not finish within %d ms; the test process was stopped." % timeout_ms,
				"Last log lines:\n" + "\n".join(log_tail(_read(work_abs.path_join("run.log")), 15)))
		await tree.process_frame
	_running = false
	var exit_code := OS.get_process_exit_code(pid)
	var report := work_abs.path_join("gut.xml") if pl.framework == "gut" else _gdunit_report(work_abs.path_join("gdunit"))
	var parsed := JUnit.parse(_read(report)) if report != "" else {"ok": false, "error": "no report file", "totals": JUnit.totals([])}
	return Protocol.ok(build_result(pl, parsed, exit_code, Time.get_ticks_msec() - started, _read(work_abs.path_join("run.log"))))


## Removes the previous run's report and log.
func _prepare(work_abs: String) -> void:
	DirAccess.make_dir_recursive_absolute(work_abs)
	for f in ["gut.xml", "run.log"]:
		if FileAccess.file_exists(work_abs.path_join(f)):
			DirAccess.remove_absolute(work_abs.path_join(f))
	_remove_tree(work_abs.path_join("gdunit"))


func _remove_tree(dir: String) -> void:
	var d := DirAccess.open(dir)
	if d == null:
		return
	d.include_hidden = true
	for f in d.get_files():
		d.remove(f)
	for sub in d.get_directories():
		if d.is_link(sub):
			d.remove(sub)
		else:
			_remove_tree(dir.path_join(sub))
	DirAccess.remove_absolute(dir)


## GdUnit4 writes report_<n>/results.xml; the newest one.
func _gdunit_report(dir: String) -> String:
	var d := DirAccess.open(dir)
	if d == null:
		return ""
	var best := ""
	var best_n := -1
	for sub in d.get_directories():
		var n := sub.trim_prefix("report_")
		if n.is_valid_int() and int(n) > best_n and FileAccess.file_exists(dir.path_join(sub).path_join("results.xml")):
			best_n = int(n)
			best = dir.path_join(sub).path_join("results.xml")
	return best


func _read(path: String) -> String:
	if path == "" or not FileAccess.file_exists(path):
		return ""
	return FileAccess.get_file_as_string(path)

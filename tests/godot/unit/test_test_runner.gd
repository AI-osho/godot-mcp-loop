extends "res://tests/godot/test_case.gd"
## tests.run (#15): JUnit parsing for GUT and GdUnit4, framework detection, argument building and validation.

const JUnit = preload("res://addons/mcp_loop/util/junit.gd")
const TestCommands = preload("res://addons/mcp_loop/commands/test_commands.gd")

# Model delayed OS confirmation at the process seam, not by pretending the test runner itself succeeded.
class DelayedTestExit extends TestCommands:
	var checks := 0
	var kills := 0

	func _process_alive(_pid: int) -> bool:
		checks += 1
		return checks < 4

	func _kill_process(_pid: int) -> Error:
		kills += 1
		return OK


class RetainedTestExit extends TestCommands:
	var alive := true

	func _process_alive(_pid: int) -> bool:
		return alive

	func _kill_process(_pid: int) -> Error:
		return ERR_CANT_CREATE


# Real output of GUT 9.7.1 on Godot 4.7.
const GUT_XML := """<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="GutTests" failures="1" tests="3" >
  <testsuite name="test/gut/test_calc.gd" tests="3" failures="1" skipped="1" time="0.000414" >
      <testcase name="test_add" assertions="1" status="pass" classname="test/gut/test_calc.gd" time="0.000107" >
      </testcase>
      <testcase name="test_add_wrong" assertions="1" status="fail" classname="test/gut/test_calc.gd" time="0.000234" >
      <failure message="failed"><![CDATA[[4] expected to equal [5]:  two plus two
            at line 9]]></failure></testcase>
      <testcase name="test_pending" assertions="0" status="pending" classname="test/gut/test_calc.gd" time="0.000073" >
      <skipped message="pending"><![CDATA[not yet]]></skipped></testcase>
  </testsuite>
</testsuites>
"""

# Real output of GdUnit4 6.2.2 on Godot 4.7.
const GDUNIT_XML := """<?xml version="1.0" encoding="UTF-8" ?>
<testsuites id="2026-10-18" name="report_1" tests="2" failures="1" skipped="0" flaky="0" time="0.000">
	<testsuite id="0" name="calc_test" package="test/gdunit" timestamp="2026-10-18T13:07:27" hostname="localhost" tests="2" failures="1" errors="0" skipped="0" flaky="0" time="0.008">
		<testcase name="test_add" classname="calc_test" time="0.002">
		</testcase>
		<testcase name="test_add_wrong" classname="calc_test" time="0.002">
			<failure message="FAILED: res://test/gdunit/calc_test.gd:9" type="FAILURE">
<![CDATA[
Expecting:
 5
 but was
 4
	at 'test_add_wrong' in res://test/gdunit/calc_test.gd:9
]]>
			</failure>
		</testcase>
	</testsuite>
</testsuites>
"""


func _exists(paths: Array) -> Callable:
	return func(p: String) -> bool: return p in paths


func test_logged_native_error_never_passes_with_exit_zero_and_successful_junit() -> void:
	var parsed := JUnit.parse('<testsuite name="fixture"><testcase name="reported_success"/></testsuite>')
	var result := TestCommands.build_result({"framework": "gut", "path": "res://test"}, parsed, 0, 10, "ERROR: Controlled native error outside the reported test.\n")
	assert_false(result.passed, "A detected Godot error must not become a PASSED report.")
	assert_eq(result.exit_code, 0)
	assert_eq(result.totals.passed, 1, "Keep the actual JUnit totals distinct from the run verdict.")
	assert_eq(result.log_errors.size(), 1)


func test_nonzero_exit_never_passes_even_with_successful_junit() -> void:
	var parsed := JUnit.parse('<testsuites><testsuite name="fixture"><testcase name="reported_success"/></testsuite></testsuites>')
	assert_true(parsed.ok)
	for exit_code in [0, 1, 2]:
		var result := TestCommands.build_result({"framework": "gut", "path": "res://test"}, parsed, exit_code, 10, "")
		assert_eq(result.passed, exit_code == 0, "a valid report does not override a failed process exit")
		assert_eq(result.exit_code, exit_code)

func test_rejects_truncated_success_report() -> void:
	var parsed := JUnit.parse('<testsuites><testsuite name="fixture"><testcase name="reported_success"/>')
	assert_false(parsed.ok, "a successful prefix is not a complete report")
	var result := TestCommands.build_result({"framework": "gut", "path": "res://test"}, parsed, 0, 10, "")
	assert_false(result.passed, "even exit zero cannot bless an incomplete report")
	assert_true(result.has("report_error"))


func test_rejects_malformed_xml_after_successful_cases() -> void:
	var valid := '<testsuite name="fixture"><testcase name="reported_success"/></testsuite>'
	for xml in [
		'<testsuite name="fixture"><testcase name="reported_success"/></wrong>',
		valid + '<testsuite name="extra"/>',
		valid + 'not XML',
	]:
		var parsed := JUnit.parse(xml)
		assert_false(parsed.ok, "malformed documents cannot keep partial passing cases: " + xml)
		assert_eq(parsed.totals.passed, 0)
	assert_true(JUnit.parse(valid).ok, "a single testsuite root remains supported")


func test_parses_gut_junit() -> void:
	var r := JUnit.parse(GUT_XML)
	assert_true(r.ok, "parsed")
	assert_eq(r.totals, {"tests": 3, "passed": 1, "failed": 1, "errors": 0, "skipped": 1})
	assert_eq(r.tests.size(), 3)
	var failed: Dictionary = r.tests[1]
	assert_eq(failed.suite, "test/gut/test_calc.gd")
	assert_eq(failed.name, "test_add_wrong")
	assert_eq(failed.status, "failed")
	assert_string_contains(failed.message, "expected to equal [5]")
	assert_string_contains(failed.message, "at line 9")
	assert_eq(r.tests[2].status, "skipped")
	assert_eq(r.tests[2].message, "not yet")


func test_parses_gdunit4_junit() -> void:
	var r := JUnit.parse(GDUNIT_XML)
	assert_true(r.ok, "parsed")
	assert_eq(r.totals, {"tests": 2, "passed": 1, "failed": 1, "errors": 0, "skipped": 0})
	var failed: Dictionary = r.tests[1]
	assert_eq(failed.suite, "test/gdunit/calc_test")
	assert_string_contains(failed.message, "FAILED: res://test/gdunit/calc_test.gd:9")
	assert_string_contains(failed.message, "but was")


func test_counts_error_elements_and_rejects_non_junit() -> void:
	var r := JUnit.parse("<testsuites><testsuite name=\"s\"><testcase name=\"t\"><error message=\"boom\">trace</error></testcase></testsuite></testsuites>")
	assert_eq(r.totals.errors, 1)
	assert_eq(r.tests[0].status, "error")
	assert_string_contains(r.tests[0].message, "boom")
	assert_false(JUnit.parse("").ok, "empty")
	assert_false(JUnit.parse("not xml at all").ok, "garbage")


func test_detects_installed_frameworks() -> void:
	assert_eq(TestCommands.detect(_exists([TestCommands.GUT_RUNNER])), ["gut"])
	assert_eq(TestCommands.detect(_exists([TestCommands.GDUNIT_RUNNER])), ["gdunit4"])
	assert_eq(TestCommands.detect(_exists([TestCommands.GUT_RUNNER, TestCommands.GDUNIT_RUNNER])), ["gut", "gdunit4"])
	assert_eq(TestCommands.detect(_exists([])), [])


func test_test_runner_refuses_arguments_godot_would_decode() -> void:
	var path := "res://test/literal%20path.gd"
	var fs := _exists([TestCommands.GUT_RUNNER, path, "res://test"])
	assert_error_code(TestCommands.plan({"path": path}, fs, fs, "/abs/work"), "INVALID_PARAMS")
	assert_error_code(TestCommands.plan({}, fs, fs, "/abs/work%20dir"), "INVALID_PARAMS")

func test_plans_a_gut_run() -> void:
	var fs := _exists([TestCommands.GUT_RUNNER, "res://test"])
	var plan := TestCommands.plan({}, fs, fs, "/abs/work")
	assert_true(plan.ok, str(plan))
	assert_eq(plan.framework, "gut")
	assert_eq(plan.path, "res://test")
	var a: PackedStringArray = plan.args
	for expected in ["--headless", "-s", TestCommands.GUT_RUNNER, "-gexit", "-gdisable_colors", "-gdir=res://test",
			"-ginclude_subdirs", "-gjunit_xml_file=/abs/work/gut.xml", "--log-file", "/abs/work/run.log"]:
		assert_true(expected in a, "%s in %s" % [expected, a])
	# One script and one test name.
	fs = _exists([TestCommands.GUT_RUNNER, "res://test/unit/test_player.gd"])
	plan = TestCommands.plan({"path": "res://test/unit/test_player.gd", "test": "test_jump"}, fs, fs, "/w")
	assert_true("-gtest=res://test/unit/test_player.gd" in plan.args, str(plan.args))
	assert_true("-gunit_test_name=test_jump" in plan.args, str(plan.args))
	assert_false("-ginclude_subdirs" in plan.args, "no dir options for one file")
	# A .gutconfig.json decides the folders when no path is given.
	fs = _exists([TestCommands.GUT_RUNNER, "res://.gutconfig.json"])
	plan = TestCommands.plan({}, fs, fs, "/w")
	assert_true(plan.ok, str(plan))
	for arg in plan.args:
		assert_false(String(arg).begins_with("-gdir"), "config decides: %s" % arg)


func test_plans_a_gdunit4_run() -> void:
	var fs := _exists([TestCommands.GDUNIT_RUNNER, "res://tests"])
	var plan := TestCommands.plan({}, fs, fs, "/w")
	assert_true(plan.ok, str(plan))
	assert_eq(plan.framework, "gdunit4")
	var a: PackedStringArray = plan.args
	for expected in ["--headless", "-s", TestCommands.GDUNIT_RUNNER, "--ignoreHeadlessMode", "-c", "-a", "res://tests",
			"-rd", TestCommands.WORK_DIR + "/gdunit", "-rc", "1"]:
		assert_true(expected in a, "%s in %s" % [expected, a])
	assert_error_code(TestCommands.plan({"test": "test_x"}, fs, fs, "/w"), "INVALID_PARAMS", "GdUnit4 has no test-name filter")


func test_rejects_bad_requests() -> void:
	var both := _exists([TestCommands.GUT_RUNNER, TestCommands.GDUNIT_RUNNER, "res://test"])
	assert_error_code(TestCommands.plan({}, both, both, "/w"), "INVALID_PARAMS", "two frameworks need framework:")
	assert_true(TestCommands.plan({"framework": "gdunit4"}, both, both, "/w").ok, "explicit framework")
	var none := _exists(["res://test"])
	assert_error_code(TestCommands.plan({}, none, none, "/w"), "TEST_FRAMEWORK_NOT_FOUND", "no framework installed")
	assert_error_code(TestCommands.plan({"framework": "gut"}, none, none, "/w"), "TEST_FRAMEWORK_NOT_FOUND", "GUT not installed")
	var gut := _exists([TestCommands.GUT_RUNNER, "res://test"])
	assert_error_code(TestCommands.plan({"path": "res://../outside"}, gut, gut, "/w"), "PATH_FORBIDDEN", "parent segments")
	assert_error_code(TestCommands.plan({"path": "res://.godot/x"}, gut, gut, "/w"), "PATH_FORBIDDEN", ".godot")
	assert_error_code(TestCommands.plan({"path": "/etc"}, gut, gut, "/w"), "PATH_FORBIDDEN", "absolute")
	assert_error_code(TestCommands.plan({"path": "res://missing"}, gut, gut, "/w"), "FILE_NOT_FOUND", "missing folder")
	assert_error_code(TestCommands.plan({"test": "a b; rm -rf /"}, gut, gut, "/w"), "INVALID_PARAMS", "test names are identifiers")
	assert_error_code(TestCommands.plan({"framework": "pytest"}, gut, gut, "/w"), "INVALID_PARAMS", "unknown framework")
	var no_dir := _exists([TestCommands.GUT_RUNNER])
	assert_error_code(TestCommands.plan({}, no_dir, no_dir, "/w"), "FILE_NOT_FOUND", "no default test folder")


func test_summarises_the_log_for_failures() -> void:
	var log := "Godot Engine v4.7\nSCRIPT ERROR: Parse Error: Identifier \"x\" not declared.\n   at: res://test/test_a.gd:3\nline\nERROR: Failed to load script \"res://test/test_a.gd\".\n"
	var errs: Array = TestCommands.log_errors(log)
	assert_eq(errs.size(), 2)
	assert_string_contains(errs[0], "Parse Error")
	var tail: Array = TestCommands.log_tail("a\nb\nc\nd\n", 2)
	assert_eq(tail, ["c", "d"])


func test_timeout_waits_for_the_test_process_to_exit() -> void:
	var cmd := DelayedTestExit.new(tree)
	assert_true(cmd.has_method("_stop_test_process"), "timeout cleanup has no exit-confirmation boundary")
	if not cmd.has_method("_stop_test_process"):
		return
	var stopped: bool = await cmd.call("_stop_test_process", 123, 1000)
	assert_true(stopped, "delayed exit was not confirmed")
	assert_eq(cmd.kills, 1)
	assert_true(cmd.checks >= 4, "a kill request was mistaken for exit confirmation")
	assert_false(cmd._running, "a confirmed exit did not release the test runner")


func test_unconfirmed_exit_keeps_busy_until_the_child_is_observed_dead() -> void:
	var cmd := RetainedTestExit.new(tree)
	assert_false(await cmd._stop_test_process(123, 0), "a failed kill was reported as a stopped process")
	assert_true(cmd._running)
	assert_error_code(await cmd._run({}), "BUSY", "a survivor must retain exclusive use of the output folder")
	cmd.alive = false
	assert_error_code(await cmd._run({"framework": "not-a-framework"}), "INVALID_PARAMS", "observing exit must unblock validation of the next request")
	assert_false(cmd._running)


func test_active_result_collection_keeps_the_output_folder_exclusive() -> void:
	var cmd := RetainedTestExit.new(tree)
	cmd.alive = false
	cmd._running = true
	cmd._running_pid = 123
	assert_error_code(await cmd._run({"framework": "not-a-framework"}), "BUSY", "process exit must not let another request delete results still owned by the current handler")


func test_refuses_an_oversized_junit_report_before_reading_it() -> void:
	var base := "user://test_report_limit_%d_%d" % [OS.get_process_id(), Time.get_ticks_usec()]
	DirAccess.make_dir_recursive_absolute(base)
	var path := base.path_join("gut.xml")
	var f := FileAccess.open(path, FileAccess.WRITE)
	f.store_string("r".repeat(9 * 1024 * 1024))
	f.close()
	var text: String = TestCommands.new(tree)._read(path)
	assert_true(text.is_empty(), "oversized reports must not be materialized or parsed")
	DirAccess.remove_absolute(path)
	DirAccess.remove_absolute(base)


func test_reads_only_a_bounded_tail_of_a_large_log() -> void:
	var base := "user://test_log_limit_%d_%d" % [OS.get_process_id(), Time.get_ticks_usec()]
	DirAccess.make_dir_recursive_absolute(base)
	var path := base.path_join("run.log")
	var f := FileAccess.open(path, FileAccess.WRITE)
	f.store_string("x".repeat(1024 * 1024) + "\nLOG_TAIL_MARKER\n")
	f.close()
	var text: String = TestCommands.new(tree)._read(path)
	assert_true(text.ends_with("\nLOG_TAIL_MARKER\n"), "the useful end of the log was lost")
	assert_true(text.to_utf8_buffer().size() <= 64 * 1024 + 128, "the log was read in full")
	DirAccess.remove_absolute(path)
	DirAccess.remove_absolute(base)


func test_cleanup_never_follows_a_link_at_the_tree_root() -> void:
	var base := "user://cleanup_security_%d_%d" % [OS.get_process_id(), Time.get_ticks_usec()]
	var outside := base.path_join("outside")
	var link := base.path_join("gdunit")
	DirAccess.make_dir_recursive_absolute(outside)
	var sentinel := outside.path_join("keep.txt")
	var f := FileAccess.open(sentinel, FileAccess.WRITE)
	f.store_string("DO NOT DELETE")
	f.close()
	var dir := DirAccess.open(base)
	assert_eq(dir.create_link(ProjectSettings.globalize_path(outside), "gdunit"), OK)
	var cmd := TestCommands.new(tree)
	cmd._remove_tree(link)
	assert_true(FileAccess.file_exists(sentinel), "cleanup followed its root symlink and deleted an external file")
	if FileAccess.file_exists(sentinel):
		DirAccess.remove_absolute(sentinel)
	if dir.is_link("gdunit"):
		dir.remove("gdunit")
	DirAccess.remove_absolute(outside)
	DirAccess.remove_absolute(base)

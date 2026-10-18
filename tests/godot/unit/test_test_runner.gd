extends "res://tests/godot/test_case.gd"
## tests.run (#15): JUnit parsing for GUT and GdUnit4, framework detection, argument building and validation.

const JUnit = preload("res://addons/mcp_loop/util/junit.gd")
const TestCommands = preload("res://addons/mcp_loop/commands/test_commands.gd")

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

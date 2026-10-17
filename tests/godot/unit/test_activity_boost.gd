extends "res://tests/godot/test_case.gd"

const ActivityBoost = preload("res://addons/mcp_loop/util/activity_boost.gd")

var _original: int


func before_each() -> void:
	_original = OS.low_processor_usage_mode_sleep_usec


func after_each() -> void:
	OS.low_processor_usage_mode_sleep_usec = _original


func test_active_uses_a_short_loop_sleep() -> void:
	OS.low_processor_usage_mode_sleep_usec = 100000
	var boost := ActivityBoost.new()
	boost.update(true)
	assert_eq(OS.low_processor_usage_mode_sleep_usec, ActivityBoost.FAST_SLEEP_USEC)
	assert_true(boost.is_boosted())


func test_inactive_restores_the_previous_value() -> void:
	OS.low_processor_usage_mode_sleep_usec = 100000
	var boost := ActivityBoost.new()
	boost.update(true)
	boost.update(false)
	assert_eq(OS.low_processor_usage_mode_sleep_usec, 100000)
	assert_false(boost.is_boosted())


func test_restore_uses_the_provider_when_given() -> void:
	# The editor's value depends on window focus, which may change while boosted.
	OS.low_processor_usage_mode_sleep_usec = 100000
	var boost := ActivityBoost.new(func() -> int: return 6900)
	boost.update(true)
	boost.update(false)
	assert_eq(OS.low_processor_usage_mode_sleep_usec, 6900)


func test_reapplies_if_something_else_changed_the_value_while_active() -> void:
	var boost := ActivityBoost.new()
	boost.update(true)
	OS.low_processor_usage_mode_sleep_usec = 100000  # e.g. the editor reacting to a focus change
	boost.update(true)
	assert_eq(OS.low_processor_usage_mode_sleep_usec, ActivityBoost.FAST_SLEEP_USEC)


func test_inactive_without_boost_changes_nothing() -> void:
	OS.low_processor_usage_mode_sleep_usec = 12345
	var boost := ActivityBoost.new(func() -> int: return 6900)
	boost.update(false)
	assert_eq(OS.low_processor_usage_mode_sleep_usec, 12345)

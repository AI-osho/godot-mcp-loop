extends "res://tests/godot/test_case.gd"
## Self-test of the runner (deliberate-failure variants were verified RED during setup).

func test_assert_eq_passes() -> void:
	assert_eq(1 + 1, 2)


func test_async_test_is_awaited() -> void:
	var before := Engine.get_process_frames()
	await tree.process_frame
	await tree.process_frame
	assert_true(Engine.get_process_frames() > before)

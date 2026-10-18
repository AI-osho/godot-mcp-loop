extends "res://tests/godot/test_case.gd"

const PixelArt = preload("res://addons/mcp_loop/util/pixel_art.gd")

const PALETTE := {"r": "#ff0000", "b": [0, 0, 1, 1], "w": "white"}


func _ok(spec: Dictionary) -> Dictionary:
	var r: Dictionary = PixelArt.build(spec)
	assert_true(r.ok, str(r.get("error", "")))
	return r


func _fails(spec: Dictionary, part: String) -> void:
	var r: Dictionary = PixelArt.build(spec)
	assert_false(r.ok, "should fail: " + part)
	assert_string_contains(r.get("error", ""), part)


func test_rows_become_pixels_with_transparency() -> void:
	var r := _ok({"palette": PALETTE, "rows": ["r.", " b"]})
	var img: Image = r.image
	assert_eq(img.get_size(), Vector2i(2, 2))
	assert_eq(img.get_pixel(0, 0), Color(1, 0, 0, 1))
	assert_eq(img.get_pixel(1, 0).a, 0.0)
	assert_eq(img.get_pixel(0, 1).a, 0.0)
	assert_eq(img.get_pixel(1, 1), Color(0, 0, 1, 1))


func test_scale_uses_nearest_neighbour() -> void:
	var r := _ok({"palette": PALETTE, "rows": ["rb"], "scale": 3})
	var img: Image = r.image
	assert_eq(img.get_size(), Vector2i(6, 3))
	assert_eq(img.get_pixel(2, 2), Color(1, 0, 0, 1))
	assert_eq(img.get_pixel(3, 0), Color(0, 0, 1, 1))


func test_frames_form_a_horizontal_strip() -> void:
	var r := _ok({"palette": PALETTE, "frames": [["rr", "rr"], ["bb", "bw"]]})
	assert_eq(r.image.get_size(), Vector2i(4, 2))
	assert_eq(r.frames, 2)
	assert_eq(r.frame_width, 2)
	assert_eq(r.image.get_pixel(3, 1), Color(1, 1, 1, 1))


func test_palette_can_override_transparent_chars() -> void:
	var r := _ok({"palette": {".": "#00ff00"}, "rows": ["."]})
	assert_eq(r.image.get_pixel(0, 0), Color(0, 1, 0, 1))


func test_validation_errors() -> void:
	_fails({"palette": PALETTE, "rows": ["rr", "r"]}, "same length")
	_fails({"palette": PALETTE, "rows": ["rx"]}, "'x'")
	_fails({"palette": PALETTE, "rows": []}, "rows")
	_fails({"palette": {"r": "not a color"}, "rows": ["r"]}, "r")
	_fails({"palette": {"rr": "red"}, "rows": ["r"]}, "single character")
	_fails({"palette": PALETTE, "rows": ["r"], "scale": 40}, "scale")
	_fails({"palette": PALETTE, "frames": [["rr"], ["r"]]}, "same size")
	_fails({"palette": PALETTE, "rows": ["r"], "frames": [["r"]]}, "either")
	var wide := "r".repeat(300)
	_fails({"palette": PALETTE, "rows": [wide]}, "256")


# ---- mirror: draw half, get a symmetric sprite ----

func _row(img: Image, y: int, palette: Dictionary) -> String:
	var out := ""
	for x in img.get_width():
		var c := img.get_pixel(x, y)
		var ch := "."
		for k in palette:
			if c.a > 0 and Color(palette[k]).is_equal_approx(c):
				ch = k
		out += ch
	return out


func test_mirror_x_doubles_width() -> void:
	var r := _ok({"palette": {"a": "#ff0000", "b": "#0000ff"}, "rows": ["ab."], "mirror": "x"})
	assert_eq(r.image.get_size(), Vector2i(6, 1))
	assert_eq(_row(r.image, 0, {"a": "#ff0000", "b": "#0000ff"}), "ab..ba")


func test_mirror_x_with_overlap_shares_the_middle_column() -> void:
	var r := _ok({"palette": {"a": "#ff0000", "b": "#0000ff"}, "rows": ["abb"], "mirror": "x", "mirror_overlap": true})
	assert_eq(_row(r.image, 0, {"a": "#ff0000", "b": "#0000ff"}), "abbba")


func test_mirror_y_and_xy() -> void:
	var pal := {"a": "#ff0000", "b": "#0000ff"}
	var y := _ok({"palette": pal, "rows": ["a", "b"], "mirror": "y"})
	assert_eq(y.image.get_size(), Vector2i(1, 4))
	assert_eq(_row(y.image, 2, pal), "b")
	assert_eq(_row(y.image, 3, pal), "a")
	var xy := _ok({"palette": pal, "frames": [["ab"], ["ba"]], "mirror": "xy"})
	assert_eq(xy.frame_width, 4)
	assert_eq(xy.frame_height, 2)
	assert_eq(_row(xy.image, 1, pal), "abbabaab")


func test_mirror_rejects_unknown_axis() -> void:
	_fails({"palette": PALETTE, "rows": ["r"], "mirror": "z"}, "mirror")

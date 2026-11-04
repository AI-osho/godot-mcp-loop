extends Control
# Small pixel cursor triangle (no font glyph needed).

@export var points_right := true
@export var cursor_color := Color.WHITE

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func _draw() -> void:
	var pts: PackedVector2Array
	if points_right:
		pts = PackedVector2Array([Vector2(0, 0), Vector2(0, 6), Vector2(5, 3)])
	else:
		pts = PackedVector2Array([Vector2(0, 0), Vector2(6, 0), Vector2(3, 4)])
	draw_colored_polygon(pts, cursor_color)

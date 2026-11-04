extends Control
# NES RPG style window: black fill with a double white border.

@export var fill_color := Color.BLACK
@export var border_color := Color("#f0f0f0")

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func _draw() -> void:
	var w := size.x
	var h := size.y
	if w < 8.0 or h < 8.0:
		return
	draw_rect(Rect2(0, 0, w, h), fill_color)
	# outer frame
	draw_rect(Rect2(0, 0, w, 1), border_color)
	draw_rect(Rect2(0, h - 1, w, 1), border_color)
	draw_rect(Rect2(0, 0, 1, h), border_color)
	draw_rect(Rect2(w - 1, 0, 1, h), border_color)
	# inner frame
	draw_rect(Rect2(3, 3, w - 6, 1), border_color)
	draw_rect(Rect2(3, h - 4, w - 6, 1), border_color)
	draw_rect(Rect2(3, 3, 1, h - 6), border_color)
	draw_rect(Rect2(w - 4, 3, 1, h - 6), border_color)

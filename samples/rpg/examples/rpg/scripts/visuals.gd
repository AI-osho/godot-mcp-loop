extends RefCounted
# Background art drawn with primitives (framed as NES-era star fields).

const NIGHT := Color("#070b18")
const NIGHT2 := Color("#0d1430")
const STAR_BLUE := Color("#7c90e8")
const STAR_WHITE := Color("#f0f0f0")


class StarBackdrop:
	extends Control
	var frame := 0
	var mode := "title"   # title / opening / ending

	func _ready() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func set_frame(f: int) -> void:
		frame = f
		queue_redraw()

	func _draw() -> void:
		var w := size.x
		var h := size.y
		draw_rect(Rect2(0, 0, w, h), NIGHT)
		# faint vertical bands, like an NES palette gradient
		draw_rect(Rect2(0, h - 76, w, 76), Color("#0a1026"))
		draw_rect(Rect2(0, h - 50, w, 50), Color("#0c1630"))
		draw_rect(Rect2(0, h - 26, w, 26), Color("#101c3c"))
		# stars (deterministic; twinkle from the fixed frame counter)
		for i in 64:
			var sx := (i * 73 + 19) % int(w)
			var sy := (i * 47 + 11) % int(h - 60)
			var tw := (frame / 18 + i * 5) % 7
			var col := STAR_WHITE if tw < 3 else STAR_BLUE
			if i % 11 == 0:
				draw_rect(Rect2(sx, sy, 2, 1), col)
			else:
				draw_rect(Rect2(sx, sy, 1, 1), col)
		# moon with a crescent shadow
		draw_circle(Vector2(w - 46, 34), 12.0, Color("#f0e8b8"))
		draw_circle(Vector2(w - 41, 30), 10.5, Color("#0a1026"))
		# a shooting star every few seconds
		var shoot := frame % 420
		if shoot < 18:
			var sx2 := 40 + shoot * 9
			var sy2 := 36 + shoot * 2
			draw_rect(Rect2(sx2, sy2, 5, 1), Color("#fff3b0"))
			draw_rect(Rect2(sx2 - 4, sy2 - 1, 4, 1), Color("#a0b0ff"))


class BattleBackdrop:
	extends Control
	var frame := 0

	func _ready() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func set_frame(f: int) -> void:
		frame = f
		queue_redraw()

	func _draw() -> void:
		var w := size.x
		draw_rect(Rect2(0, 0, w, 148), Color("#080c1c"))
		# stars
		for i in 26:
			var sx := (i * 83 + 7) % int(w)
			var sy := (i * 29 + 9) % 78
			var tw := (frame / 20 + i * 3) % 6
			var col := STAR_WHITE if tw < 2 else Color("#5868b0")
			draw_rect(Rect2(sx, sy, 1, 1), col)
		# moon
		draw_circle(Vector2(211, 30), 10.0, Color("#d8d0a0"))
		# distant mountains
		var far := PackedVector2Array([
			Vector2(0, 112), Vector2(30, 84), Vector2(58, 112),
			Vector2(92, 74), Vector2(126, 112), Vector2(164, 86),
			Vector2(198, 112), Vector2(228, 90), Vector2(256, 112),
			Vector2(256, 148), Vector2(0, 148),
		])
		draw_colored_polygon(far, Color("#182042"))
		var near := PackedVector2Array([
			Vector2(0, 126), Vector2(24, 106), Vector2(52, 126),
			Vector2(86, 110), Vector2(118, 126), Vector2(150, 112),
			Vector2(186, 126), Vector2(216, 108), Vector2(256, 124),
			Vector2(256, 148), Vector2(0, 148),
		])
		draw_colored_polygon(near, Color("#11162e"))
		# battle ground
		draw_rect(Rect2(0, 128, w, 20), Color("#20381e"))
		draw_rect(Rect2(0, 132, w, 16), Color("#2c4c26"))
		for x in range(0, 256, 16):
			var shade := Color("#254420") if (x / 16) % 2 == 0 else Color("#2c5026")
			draw_rect(Rect2(x, 136, 16, 12), shade)
			draw_rect(Rect2(x, 136, 1, 12), Color("#1a3018"))
		# horizon glow
		draw_rect(Rect2(0, 126, w, 2), Color("#3c5c38"))
		# the whole lower screen is the NES window area
		draw_rect(Rect2(0, 148, w, size.y - 148), Color.BLACK)

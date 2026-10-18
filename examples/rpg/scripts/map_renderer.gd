extends Node2D
# Draws the 16x15 tile map with nearest-neighbour textures.

const Data = preload("res://examples/rpg/scripts/data.gd")

var rows: Array = []
var tiles_tex: Texture2D

func _ready() -> void:
	texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST

func set_map(new_rows: Array, tex: Texture2D) -> void:
	rows = new_rows
	tiles_tex = tex
	queue_redraw()

func _draw() -> void:
	if tiles_tex == null:
		return
	for y in rows.size():
		var row: String = rows[y]
		for x in row.length():
			var ch := row[x]
			var def: Dictionary = Data.TILE_DEFS.get(ch, {})
			if def.is_empty():
				continue
			var frame: int = def["frame"]
			draw_texture_rect_region(
				tiles_tex,
				Rect2(x * Data.TILE_SIZE, y * Data.TILE_SIZE, Data.TILE_SIZE, Data.TILE_SIZE),
				Rect2(frame * Data.TILE_SIZE, 0, Data.TILE_SIZE, Data.TILE_SIZE)
			)

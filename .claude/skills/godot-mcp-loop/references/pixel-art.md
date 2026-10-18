# Pixel art with image_write

`image_write` turns text into a PNG and imports it immediately, so sprites can be drawn without an image editor.

## One image

```json
{
  "path": "res://games/runner/sprites/coin.png",
  "palette": { "k": "#000000", "y": "#f8d830", "o": "#c88820", "w": "#ffffff" },
  "rows": [
    "..kkkk..",
    ".kyyyyk.",
    "kywyyyok",
    "kywyyyok",
    "kyyyyyok",
    "kyyyyyok",
    ".kyyook.",
    "..kkkk.."
  ]
}
```

- Each palette key is one character. `.` and space are transparent; a key mapped to `null` or `"transparent"` is
  too. Colors: `#rrggbb`, `#rrggbbaa`, a name, or `[r, g, b, a]` in 0..1.
- All rows must have the same length (up to 256×256).
- Keep `scale` at 1 and scale the node or the window instead; the art stays crisp and collisions stay simple.

## Sprite sheets

`frames` lays several same-sized frames left to right:

```json
{
  "path": "res://games/runner/sprites/player.png",
  "palette": { "k": "#000000", "s": "#f8b878", "b": "#2038ec" },
  "frames": [
    ["..kk..", ".ksk..", "..bb..", ".b..b."],
    ["..kk..", ".ksk..", "..bb..", "..bb.."]
  ]
}
```

Use it as a `Sprite2D` texture with `hframes` set to the number of frames and change `frame` to animate.

## Symmetric sprites

`mirror: "x"` takes the left half and mirrors it to the right (`"y"` top half, `"xy"` top-left quarter). With an odd
width, add `mirror_overlap: true` to share the middle column instead of repeating it.

## Crisp display

Set this up once in the main scene's `_ready()` (project settings can't be edited through the tools):

```gdscript
const SCREEN_W := 256
const SCREEN_H := 240

func _setup_window() -> void:
	var win := get_window()
	win.content_scale_size = Vector2i(SCREEN_W, SCREEN_H)
	win.content_scale_mode = Window.CONTENT_SCALE_MODE_VIEWPORT
	win.content_scale_aspect = Window.CONTENT_SCALE_ASPECT_KEEP
	win.content_scale_stretch = Window.CONTENT_SCALE_STRETCH_INTEGER
	get_viewport().canvas_item_default_texture_filter = Viewport.DEFAULT_CANVAS_ITEM_TEXTURE_FILTER_NEAREST
	get_viewport().snap_2d_transforms_to_pixel = true
	if not Engine.is_embedded_in_editor() and win.mode == Window.MODE_WINDOWED:
		win.size = Vector2i(SCREEN_W, SCREEN_H) * 3
		win.move_to_center()
```

## Text

- Japanese or other non-Latin text needs a font that has the glyphs, or it shows as □. A `SystemFont` with a list
  of names and `allow_system_fallback = true` works on most systems; turn antialiasing off for a pixel look.
- Leave a margin of at least 2 px between text and window borders. Check every screen in a screenshot — overlaps
  between labels, borders and scrolling text are the most common visual bug.

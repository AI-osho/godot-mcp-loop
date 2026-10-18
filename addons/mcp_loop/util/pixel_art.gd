extends RefCounted
## Builds pixel-art images from text: a palette of single characters and rows
## of those characters. "." and " " are transparent unless the palette defines
## them. Several frames are laid out as a horizontal strip (a sprite sheet that
## Sprite2D can play with hframes/frame). Scaling uses nearest neighbour.

const Codec = preload("res://addons/mcp_loop/util/value_codec.gd")

const MAX_FRAME_SIZE := 256
const MAX_FRAMES := 64
const MAX_SCALE := 16
const MAX_OUTPUT := 4096


static func build(spec: Dictionary) -> Dictionary:
	var has_rows := spec.get("rows") != null
	var has_frames := spec.get("frames") != null
	if has_rows == has_frames:
		return _fail("Give either 'rows' (one image) or 'frames' (a list of row lists), not both.")
	var frames: Array = [spec.rows] if has_rows else spec.frames
	if typeof(frames) != TYPE_ARRAY or frames.is_empty() or frames.size() > MAX_FRAMES:
		return _fail("'frames' must hold 1 to %d frames." % MAX_FRAMES)
	var mirror := str(spec.get("mirror", ""))
	if not ["", "x", "y", "xy"].has(mirror):
		return _fail("'mirror' must be 'x' (left half given), 'y' (top half given) or 'xy' (top-left quarter given).")
	if mirror != "":
		var overlap: bool = spec.get("mirror_overlap", false)
		var mirrored: Array = []
		for rows in frames:
			if typeof(rows) != TYPE_ARRAY:
				mirrored.append(rows)  # reported by the checks below
				continue
			mirrored.append(_mirror(rows, mirror, overlap))
		frames = mirrored
	var scale := int(spec.get("scale", 1))
	if scale < 1 or scale > MAX_SCALE:
		return _fail("'scale' must be between 1 and %d." % MAX_SCALE)

	var raw_palette: Variant = spec.get("palette", {})
	if typeof(raw_palette) != TYPE_DICTIONARY:
		return _fail("'palette' must map single characters to colors.")
	var palette := {".": Color(0, 0, 0, 0), " ": Color(0, 0, 0, 0)}
	for key in raw_palette:
		var ch := str(key)
		if ch.length() != 1:
			return _fail("Palette keys must be a single character (got '%s')." % ch)
		var c := Codec.decode(raw_palette[key], TYPE_COLOR)
		if not c.ok:
			return _fail("Palette color for '%s': %s" % [ch, c.error])
		palette[ch] = c.value

	var fw := -1
	var fh := -1
	for fi in frames.size():
		var rows: Variant = frames[fi]
		var label := "Frame %d" % (fi + 1) if has_frames else "Image"
		if typeof(rows) != TYPE_ARRAY or rows.is_empty():
			return _fail("%s: 'rows' must be a non-empty list of strings." % label)
		var w := str(rows[0]).length()
		for ri in rows.size():
			var row := str(rows[ri])
			if row.length() != w:
				return _fail("%s: every row must have the same length (row %d has %d, row 1 has %d)." % [label, ri + 1, row.length(), w])
			for ci in row.length():
				if not palette.has(row[ci]):
					return _fail("%s: character '%s' (row %d, column %d) is not in the palette." % [label, row[ci], ri + 1, ci + 1])
		if w == 0 or w > MAX_FRAME_SIZE or rows.size() > MAX_FRAME_SIZE:
			return _fail("%s: frames must be 1 to 256 pixels in each direction (got %dx%d)." % [label, w, rows.size()])
		if fw < 0:
			fw = w
			fh = rows.size()
		elif w != fw or rows.size() != fh:
			return _fail("All frames must be the same size (frame 1 is %dx%d, %s is %dx%d)." % [fw, fh, label.to_lower(), w, rows.size()])
	if fw * frames.size() * scale > MAX_OUTPUT or fh * scale > MAX_OUTPUT:
		return _fail("The result would exceed %d pixels; use fewer frames or a smaller scale." % MAX_OUTPUT)

	var img := Image.create(fw * frames.size(), fh, false, Image.FORMAT_RGBA8)
	for fi in frames.size():
		var rows: Array = frames[fi]
		for y in fh:
			var row := str(rows[y])
			for x in fw:
				img.set_pixel(fi * fw + x, y, palette[row[x]])
	if scale > 1:
		img.resize(img.get_width() * scale, img.get_height() * scale, Image.INTERPOLATE_NEAREST)
	return {"ok": true, "image": img, "frames": frames.size(), "frame_width": fw * scale, "frame_height": fh * scale}


## Completes a symmetric sprite from its left half / top half / top-left quarter.
## With overlap, the last column/row is shared instead of repeated (odd sizes).
static func _mirror(rows: Array, axis: String, overlap: bool) -> Array:
	var out: Array = []
	for row in rows:
		var r := str(row)
		if axis.contains("x"):
			var tail := r.substr(0, r.length() - 1) if overlap else r
			var rev := ""
			for i in range(tail.length() - 1, -1, -1):
				rev += tail[i]
			r += rev
		out.append(r)
	if axis.contains("y"):
		var top := out.slice(0, out.size() - 1) if overlap else out.duplicate()
		top.reverse()
		out.append_array(top)
	return out


static func _fail(message: String) -> Dictionary:
	return {"ok": false, "error": message}

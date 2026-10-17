extends Node2D
## Tetris: 10x20 board, 7 tetrominoes, gravity, line clears, score/level, next piece, game over + restart.
## Keys: Left/Right move, Up/X rotate CW, Z rotate CCW, Down soft drop, Space hard drop, R restart.
## For automated tests: set `sequence` (e.g. "OOTI", cycles) or `rng_seed`, and `gravity_enabled = false`.

const COLS := 10
const ROWS := 20
const CELL := 28
const BOARD_ORIGIN := Vector2(40, 44)
const PANEL_X := 360.0
const DAS_DELAY := 0.17
const DAS_REPEAT := 0.05
const SOFT_DROP_INTERVAL := 0.05
const LINE_SCORES := [0, 100, 300, 500, 800]
const KICKS := [Vector2i(0, 0), Vector2i(-1, 0), Vector2i(1, 0), Vector2i(0, -1), Vector2i(-2, 0), Vector2i(2, 0)]
const TYPES := "IOTSZJL"

## Spawn-state cells inside an n x n box; other states are rotations of the box (SRS-style).
const SHAPES := {
	"I": {"n": 4, "cells": [Vector2i(0, 1), Vector2i(1, 1), Vector2i(2, 1), Vector2i(3, 1)]},
	"O": {"n": 2, "cells": [Vector2i(0, 0), Vector2i(1, 0), Vector2i(0, 1), Vector2i(1, 1)]},
	"T": {"n": 3, "cells": [Vector2i(1, 0), Vector2i(0, 1), Vector2i(1, 1), Vector2i(2, 1)]},
	"S": {"n": 3, "cells": [Vector2i(1, 0), Vector2i(2, 0), Vector2i(0, 1), Vector2i(1, 1)]},
	"Z": {"n": 3, "cells": [Vector2i(0, 0), Vector2i(1, 0), Vector2i(1, 1), Vector2i(2, 1)]},
	"J": {"n": 3, "cells": [Vector2i(0, 0), Vector2i(0, 1), Vector2i(1, 1), Vector2i(2, 1)]},
	"L": {"n": 3, "cells": [Vector2i(2, 0), Vector2i(0, 1), Vector2i(1, 1), Vector2i(2, 1)]},
}
const COLORS := {
	"I": Color("#33d6e6"), "O": Color("#f2d33a"), "T": Color("#a64dd9"), "S": Color("#4ccf4c"),
	"Z": Color("#e64040"), "J": Color("#3a6ee6"), "L": Color("#f0962e"),
}

## Fixed piece order (letters from IOTSZJL, repeats when exhausted). Empty = random 7-bag.
@export var sequence: String = ""
## Seed for the random 7-bag. 0 = random each run.
@export var rng_seed: int = 0
@export var gravity_enabled: bool = true
## Lines needed per level step.
@export var lines_per_level: int = 10

# --- Live state (readable with game_query) ---
var board: Array = []  # ROWS arrays of COLS strings ("" = empty, else piece letter)
var piece_type: String = ""
var piece_rot: int = 0
var piece_x: int = 0
var piece_y: int = 0
var next_type: String = ""
var score: int = 0
var lines: int = 0
var level: int = 1
var game_over: bool = false
var pieces_spawned: int = 0
## Every piece type spawned since the last restart, in order (e.g. "TIO"), for checking seeds/sequences.
var spawn_history: String = ""
var last_clear: int = 0
var fall_interval: float = 0.8
# Derived, refreshed after every change (handy for asserts)
var board_rows: PackedStringArray = PackedStringArray()
var filled_count: int = 0
## Rows from the highest non-empty row down to the bottom, joined by "|" ("" when empty). Positional, easy to assert.
var stack_text: String = ""
var piece_cells: String = ""
var ghost_y: int = 0

var _rng := RandomNumberGenerator.new()
var _bag: Array = []
var _seq_index: int = 0
var _fall_timer: float = 0.0
var _held: Dictionary = {}  # keycode -> seconds held
var _repeat_timer: Dictionary = {}

@onready var _score_label: Label = $ScoreLabel
@onready var _lines_label: Label = $LinesLabel
@onready var _level_label: Label = $LevelLabel
@onready var _game_over_label: Label = $GameOverLabel


func _ready() -> void:
	restart()


func restart() -> void:
	board = []
	for r in ROWS:
		var row: Array = []
		row.resize(COLS)
		row.fill("")
		board.append(row)
	score = 0
	lines = 0
	level = 1
	game_over = false
	pieces_spawned = 0
	spawn_history = ""
	last_clear = 0
	_seq_index = 0
	_bag.clear()
	if rng_seed != 0:
		_rng.seed = rng_seed
	else:
		_rng.randomize()
	_fall_timer = 0.0
	_update_speed()
	next_type = _draw_type()
	_spawn()
	print("[tetris] restart (sequence='%s', seed=%d)" % [sequence, rng_seed])


func _draw_type() -> String:
	var seq := sequence.strip_edges().to_upper()
	if seq != "":
		var t := seq[_seq_index % seq.length()]
		_seq_index += 1
		if not SHAPES.has(t):
			push_error("[tetris] invalid piece '%s' in sequence" % t)
			return "T"
		return t
	if _bag.is_empty():
		for c in TYPES:
			_bag.append(c)
		# Fisher-Yates with our own RNG so the seed fully determines the order
		for i in range(_bag.size() - 1, 0, -1):
			var j := _rng.randi_range(0, i)
			var tmp = _bag[i]
			_bag[i] = _bag[j]
			_bag[j] = tmp
	return _bag.pop_front()


func _spawn() -> void:
	piece_type = next_type
	next_type = _draw_type()
	piece_rot = 0
	var n: int = SHAPES[piece_type]["n"]
	piece_x = (COLS - n) / 2
	piece_y = -1 if piece_type == "I" else 0  # I's spawn row is row 1 of its box
	pieces_spawned += 1
	spawn_history += piece_type
	_fall_timer = 0.0
	if not _fits(piece_x, piece_y, piece_rot):
		game_over = true
		print("[tetris] game over: score=%d lines=%d level=%d" % [score, lines, level])
	_refresh()


static func cells_for(type: String, rot: int) -> Array:
	var n: int = SHAPES[type]["n"]
	var out: Array = []
	for c in SHAPES[type]["cells"]:
		var p: Vector2i = c
		for i in posmod(rot, 4):
			p = Vector2i(n - 1 - p.y, p.x)  # rotate 90° clockwise inside the box
		out.append(p)
	return out


func _fits(x: int, y: int, rot: int) -> bool:
	for c in cells_for(piece_type, rot):
		var bx: int = x + c.x
		var by: int = y + c.y
		if bx < 0 or bx >= COLS or by >= ROWS:
			return false
		if by >= 0 and board[by][bx] != "":
			return false
	return true


func move(dx: int, dy: int) -> bool:
	if game_over or not _fits(piece_x + dx, piece_y + dy, piece_rot):
		return false
	piece_x += dx
	piece_y += dy
	_refresh()
	return true


func rotate_piece(dir: int) -> bool:
	if game_over:
		return false
	var new_rot := posmod(piece_rot + dir, 4)
	for k in KICKS:
		if _fits(piece_x + k.x, piece_y + k.y, new_rot):
			piece_x += k.x
			piece_y += k.y
			piece_rot = new_rot
			_refresh()
			return true
	return false


func soft_drop() -> void:
	if not move(0, 1):
		_lock()


func hard_drop() -> void:
	if game_over:
		return
	while _fits(piece_x, piece_y + 1, piece_rot):
		piece_y += 1
	_lock()


func _lock() -> void:
	if game_over:
		return
	for c in cells_for(piece_type, piece_rot):
		var by: int = piece_y + c.y
		if by < 0:
			game_over = true  # locked above the visible field
			continue
		board[by][piece_x + c.x] = piece_type
	if game_over:
		print("[tetris] game over (lock out): score=%d" % score)
		_refresh()
		return
	_clear_lines()
	_spawn()


func _clear_lines() -> void:
	var kept: Array = []
	for row in board:
		if row.has(""):
			kept.append(row)
	var cleared := ROWS - kept.size()
	last_clear = cleared
	if cleared == 0:
		return
	for i in cleared:
		var empty: Array = []
		empty.resize(COLS)
		empty.fill("")
		kept.push_front(empty)
	board = kept
	var gained: int = LINE_SCORES[cleared] * level
	score += gained
	lines += cleared
	level = 1 + lines / maxi(1, lines_per_level)
	_update_speed()
	print("[tetris] cleared %d line(s): +%d -> score=%d lines=%d level=%d" % [cleared, gained, score, lines, level])


func _update_speed() -> void:
	fall_interval = maxf(0.05, 0.8 * pow(0.8, level - 1))


func _process(delta: float) -> void:
	_handle_held(delta)
	if game_over or not gravity_enabled:
		return
	_fall_timer += delta
	while _fall_timer >= fall_interval and not game_over:
		_fall_timer -= fall_interval
		if not move(0, 1):
			_lock()


func _handle_held(delta: float) -> void:
	for k in _held.keys():
		_held[k] += delta
		var t: float = _held[k]
		match k:
			KEY_LEFT, KEY_RIGHT:
				if t >= DAS_DELAY:
					_repeat_timer[k] = _repeat_timer.get(k, 0.0) + delta
					while _repeat_timer[k] >= DAS_REPEAT:
						_repeat_timer[k] -= DAS_REPEAT
						move(-1 if k == KEY_LEFT else 1, 0)
			KEY_DOWN:
				_repeat_timer[k] = _repeat_timer.get(k, 0.0) + delta
				while _repeat_timer[k] >= SOFT_DROP_INTERVAL and not game_over:
					_repeat_timer[k] -= SOFT_DROP_INTERVAL
					soft_drop()


func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey) or event.echo:
		return
	var k: int = event.physical_keycode if event.physical_keycode != 0 else event.keycode
	if not event.pressed:
		_held.erase(k)
		_repeat_timer.erase(k)
		return
	get_viewport().set_input_as_handled()
	if k == KEY_R or (game_over and k == KEY_ENTER):
		restart()
		return
	if game_over:
		return
	match k:
		KEY_LEFT:
			move(-1, 0)
			_held[k] = 0.0
		KEY_RIGHT:
			move(1, 0)
			_held[k] = 0.0
		KEY_DOWN:
			soft_drop()
			_held[k] = 0.0
		KEY_UP, KEY_X:
			rotate_piece(1)
		KEY_Z:
			rotate_piece(-1)
		KEY_SPACE:
			hard_drop()


func _refresh() -> void:
	board_rows = PackedStringArray()
	filled_count = 0
	for row in board:
		var s := ""
		for v in row:
			s += "." if v == "" else v
			if v != "":
				filled_count += 1
		board_rows.append(s)
	var top := 0
	while top < ROWS and board_rows[top] == ".".repeat(COLS):
		top += 1
	stack_text = "|".join(board_rows.slice(top))
	var parts: PackedStringArray = []
	for c in cells_for(piece_type, piece_rot):
		parts.append("%d,%d" % [piece_x + c.x, piece_y + c.y])
	piece_cells = " ".join(parts)
	ghost_y = piece_y
	if not game_over:
		while _fits(piece_x, ghost_y + 1, piece_rot):
			ghost_y += 1
	if is_node_ready():
		_score_label.text = "SCORE\n%d" % score
		_lines_label.text = "LINES\n%d" % lines
		_level_label.text = "LEVEL\n%d" % level
		_game_over_label.visible = game_over
	queue_redraw()


func _draw() -> void:
	var size := Vector2(COLS * CELL, ROWS * CELL)
	draw_rect(Rect2(BOARD_ORIGIN - Vector2(4, 4), size + Vector2(8, 8)), Color("#888"), false, 2.0)
	draw_rect(Rect2(BOARD_ORIGIN, size), Color("#14141c"))
	for x in range(1, COLS):
		draw_line(BOARD_ORIGIN + Vector2(x * CELL, 0), BOARD_ORIGIN + Vector2(x * CELL, size.y), Color("#22222c"))
	for y in range(1, ROWS):
		draw_line(BOARD_ORIGIN + Vector2(0, y * CELL), BOARD_ORIGIN + Vector2(size.x, y * CELL), Color("#22222c"))
	for r in ROWS:
		for c in COLS:
			if board[r][c] != "":
				_draw_cell(BOARD_ORIGIN, c, r, COLORS[board[r][c]])
	if piece_type != "" and not game_over:
		for cell in cells_for(piece_type, piece_rot):
			var gx: int = piece_x + cell.x
			var gy: int = ghost_y + cell.y
			if gy >= 0:
				draw_rect(Rect2(BOARD_ORIGIN + Vector2(gx * CELL + 2, gy * CELL + 2), Vector2(CELL - 4, CELL - 4)), Color(COLORS[piece_type], 0.35), false, 2.0)
		for cell in cells_for(piece_type, piece_rot):
			if piece_y + cell.y >= 0:
				_draw_cell(BOARD_ORIGIN, piece_x + cell.x, piece_y + cell.y, COLORS[piece_type])
	# Next piece preview (4x4 box under the NEXT label)
	var box := Vector2(PANEL_X, 74)
	draw_rect(Rect2(box, Vector2(4 * CELL, 4 * CELL)), Color("#14141c"))
	draw_rect(Rect2(box, Vector2(4 * CELL, 4 * CELL)), Color("#888"), false, 2.0)
	if next_type != "":
		# Center the piece's bounding box in the preview
		var cells := cells_for(next_type, 0)
		var lo := Vector2i(99, 99)
		var hi := Vector2i(-99, -99)
		for cell in cells:
			lo = lo.min(cell)
			hi = hi.max(cell)
		var span := hi - lo + Vector2i.ONE
		var off := Vector2((4 - span.x) * CELL / 2.0, (4 - span.y) * CELL / 2.0) - Vector2(lo) * CELL
		for cell in cells:
			_draw_cell(box + off, cell.x, cell.y, COLORS[next_type])


func _draw_cell(origin: Vector2, cx: int, cy: int, color: Color) -> void:
	var r := Rect2(origin + Vector2(cx * CELL, cy * CELL), Vector2(CELL, CELL)).grow(-1)
	draw_rect(r, color)
	draw_rect(r, color.lightened(0.4), false, 2.0)

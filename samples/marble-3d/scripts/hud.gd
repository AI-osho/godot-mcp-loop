class_name MarbleHUD
extends CanvasLayer
## Builds and updates the HUD and the title / clear / game over overlays in code.
##
## Built in code rather than as a .tscn so the sample has no hand-authored UI nodes to keep in sync, and so every
## label has a stable name (Coins, Time, Lives, ClearTime, ...). Scenarios assert those names, and game_ui_audit
## reports layout problems by name - an unnamed label is invisible to both.

const OVERLAY_COLOR := Color(0.02, 0.03, 0.08, 0.62)
const GOLD := Color(1.0, 0.86, 0.35)
const CLEAR_GREEN := Color(0.35, 1.0, 0.55)
const DANGER_RED := Color(1.0, 0.4, 0.4)

var _bar: Control
var _coins_label: Label
var _time_label: Label
var _lives_label: Label
var _overlay: ColorRect
var _title_panel: VBoxContainer
var _clear_panel: VBoxContainer
var _game_over_panel: VBoxContainer
var _clear_time: Label
var _clear_coins: Label
var _game_over_coins: Label


func _ready() -> void:
	_build()


func _build() -> void:
	var root := Control.new()
	root.name = "Root"
	add_child(root)
	root.size = get_viewport().get_visible_rect().size
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE

	_bar = Control.new()
	_bar.name = "Bar"
	root.add_child(_bar)
	_bar.size = root.size
	_bar.mouse_filter = Control.MOUSE_FILTER_IGNORE

	_coins_label = _make_label("COINS  0 / 10", 28, GOLD)
	_coins_label.name = "Coins"
	_coins_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	_bar.add_child(_coins_label)
	_coins_label.position = Vector2(28.0, 16.0)
	_coins_label.size = Vector2(360.0, 44.0)

	_time_label = _make_label("TIME  0.00", 28, Color.WHITE)
	_time_label.name = "Time"
	_bar.add_child(_time_label)
	_time_label.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_time_label.offset_left = -180.0
	_time_label.offset_right = 180.0
	_time_label.offset_top = 16.0
	_time_label.offset_bottom = 60.0

	_lives_label = _make_label("LIVES  3", 28, DANGER_RED)
	_lives_label.name = "Lives"
	_lives_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_bar.add_child(_lives_label)
	_lives_label.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	_lives_label.offset_left = -360.0
	_lives_label.offset_right = -28.0
	_lives_label.offset_top = 16.0
	_lives_label.offset_bottom = 60.0

	_overlay = ColorRect.new()
	_overlay.name = "Overlay"
	_overlay.color = OVERLAY_COLOR
	root.add_child(_overlay)
	_overlay.size = root.size
	_overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE

	var center := CenterContainer.new()
	center.name = "Center"
	root.add_child(center)
	center.size = root.size
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE

	_title_panel = _make_panel("TitlePanel")
	_title_panel.add_child(_make_label("MARBLE RUN", 92, GOLD))
	_title_panel.add_child(_make_label("Roll, jump and collect the coins.", 26, Color(0.9, 0.95, 1.0)))
	_title_panel.add_child(_make_label("Arrows / WASD to move   -   Space to jump", 20, Color(0.7, 0.82, 1.0)))
	_title_panel.add_child(_make_label("Press Enter to Start", 38, Color.WHITE))
	center.add_child(_title_panel)

	_clear_panel = _make_panel("ClearPanel")
	_clear_panel.add_child(_make_label("CLEAR!", 92, CLEAR_GREEN))
	_clear_time = _make_label("TIME  0.00", 46, Color.WHITE)
	_clear_time.name = "ClearTime"
	_clear_panel.add_child(_clear_time)
	_clear_coins = _make_label("COINS  0 / 10", 32, GOLD)
	_clear_coins.name = "ClearCoins"
	_clear_panel.add_child(_clear_coins)
	_clear_panel.add_child(_make_label("Press Enter to return to title", 24, Color(0.85, 0.9, 1.0)))
	center.add_child(_clear_panel)

	_game_over_panel = _make_panel("GameOverPanel")
	_game_over_panel.add_child(_make_label("GAME OVER", 92, DANGER_RED))
	_game_over_coins = _make_label("COINS  0 / 10", 32, GOLD)
	_game_over_coins.name = "GameOverCoins"
	_game_over_panel.add_child(_game_over_coins)
	_game_over_panel.add_child(_make_label("Press Enter to return to title", 24, Color(0.85, 0.9, 1.0)))
	center.add_child(_game_over_panel)

	show_title()


func _make_label(text: String, font_size: int, color: Color) -> Label:
	var label := Label.new()
	label.text = text
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	label.add_theme_color_override("font_outline_color", Color(0.0, 0.0, 0.0, 0.9))
	label.add_theme_constant_override("outline_size", maxi(4, int(font_size * 0.12)))
	return label


func _make_panel(panel_name: String) -> VBoxContainer:
	var panel := VBoxContainer.new()
	panel.name = panel_name
	panel.alignment = BoxContainer.ALIGNMENT_CENTER
	panel.add_theme_constant_override("separation", 16)
	return panel


func show_title() -> void:
	_bar.visible = false
	_overlay.visible = true
	_title_panel.visible = true
	_clear_panel.visible = false
	_game_over_panel.visible = false


func show_playing() -> void:
	_bar.visible = true
	_overlay.visible = false
	_title_panel.visible = false
	_clear_panel.visible = false
	_game_over_panel.visible = false


func show_clear(seconds: float, coins: int, total: int) -> void:
	_bar.visible = false
	_overlay.visible = true
	_title_panel.visible = false
	_clear_panel.visible = true
	_game_over_panel.visible = false
	_clear_time.text = "TIME  %.2f" % seconds
	_clear_coins.text = "COINS  %d / %d" % [coins, total]


func show_game_over(coins: int, total: int) -> void:
	_bar.visible = false
	_overlay.visible = true
	_title_panel.visible = false
	_clear_panel.visible = false
	_game_over_panel.visible = true
	_game_over_coins.text = "COINS  %d / %d" % [coins, total]


func set_hud(coins: int, total: int, lives: int, seconds: float) -> void:
	_coins_label.text = "COINS  %d / %d" % [coins, total]
	_time_label.text = "TIME  %.2f" % seconds
	_lives_label.text = "LIVES  %d" % lives

extends RefCounted

static func style(bg: Color, border: Color) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	s.border_color = border
	s.set_border_width_all(2)
	s.set_corner_radius_all(8)
	s.content_margin_left = 8
	s.content_margin_right = 8
	return s

static func apply(root: Control) -> void:
	var t := Theme.new()
	t.default_font_size = 18
	t.set_color("font_color","Button",Color("f0e2b9"))
	t.set_color("font_hover_color","Button",Color("fff4d5"))
	t.set_color("font_pressed_color","Button",Color("142c38"))
	t.set_color("font_disabled_color","Button",Color("668589"))
	t.set_stylebox("normal","Button",style(Color("244e4b"),Color("668589")))
	t.set_stylebox("hover","Button",style(Color("366455"),Color("add6a0")))
	t.set_stylebox("pressed","Button",style(Color("f6bf65"),Color("f0e2b9")))
	t.set_stylebox("disabled","Button",style(Color("183c4c"),Color("3e5963")))
	t.set_stylebox("focus","Button",style(Color(0,0,0,0),Color("add6a0")))
	root.theme = t
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.size = Vector2(960,640)
	_no_keyboard_focus(root)

static func _no_keyboard_focus(n: Node) -> void:
	if n is Button:
		n.focus_mode = Control.FOCUS_NONE
	for c in n.get_children():
		_no_keyboard_focus(c)

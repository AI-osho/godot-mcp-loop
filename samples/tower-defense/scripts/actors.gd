extends Node2D
const Rules = preload("res://scripts/rules.gd")
const AMBER = preload("res://assets/amber_tower.png")
const MIST = preload("res://assets/mist_tower.png")
const BEETLE = preload("res://assets/beetle.png")
const RUNNER = preload("res://assets/runner.png")
const HEAVY = preload("res://assets/heavy.png")
const ICONS = preload("res://assets/icons.png")
var garden: Node = null

func _draw() -> void:
	if garden == null:
		return
	var r = garden.rules
	var pad: int = garden.hovered_pad
	if pad >= 0:
		var kind: String = garden.selected_tower
		for t in r.towers:
			if t.pad == pad:
				kind = t.kind
		if Rules.TOWERS.has(kind):
			var center: Vector2 = Rules.SPOTS[pad]
			var radius: float = Rules.TOWERS[kind].range
			var ink := Color("f6bf65") if kind == "amber" else Color("b0e7df")
			ink.a = 0.64
			for i in range(64):
				var a := center + Vector2.from_angle(TAU*i/64.0)*radius
				var b := center + Vector2.from_angle(TAU*(i+1)/64.0)*radius
				if Rect2(20,90,710,512).has_point(a) and Rect2(20,90,710,512).has_point(b):
					draw_line(a,b,ink,2.0)
			draw_arc(center,25.0,0,TAU,24,ink,2.0)
	for t in r.towers:
		var f := 1 if t.recoil > 0.12 else (2 if t.recoil > 0.0 else 0)
		var tex = AMBER if t.kind == "amber" else MIST
		draw_texture_rect_region(tex,Rect2(t.pos-Vector2(28,60),Vector2(56,72)),Rect2(f*28,0,28,36))
	for e in r.enemies:
		var tex = BEETLE
		if e.kind == "runner":
			tex = RUNNER
		elif e.kind == "heavy":
			tex = HEAVY
		var f: int = (int(r.active_ticks/7)+int(e.id))%4
		var direction: Vector2 = r.point_on_path(e.distance+1.0)-e.pos
		draw_set_transform(e.pos,direction.angle()-PI/2.0)
		var tint := Color(1.6,1.3,1.0) if e.hurt > 0.0 else Color.WHITE
		var size := Vector2(32,40) if e.kind != "heavy" else Vector2(40,50)
		draw_texture_rect_region(tex,Rect2(Vector2(-size.x/2,-size.y*0.7),size),Rect2(f*16,0,16,20),tint)
		draw_set_transform(Vector2.ZERO)
		draw_rect(Rect2(e.pos+Vector2(-15,-35),Vector2(30,4)),Color("142c38"))
		draw_rect(Rect2(e.pos+Vector2(-14,-34),Vector2(28.0*e.hp/e.max_hp,2)),Color("f6bf65") if e.slow_time <= 0.0 else Color("b0e7df"))
		if e.slow_time > 0.0:
			draw_arc(e.pos+Vector2(0,4),18,0,TAU,16,Color("b0e7df"),1.5)
	for p in r.projectiles:
		var region := Rect2(0,0,16,16) if p.kind == "amber" else Rect2(16,0,16,16)
		draw_texture_rect_region(ICONS,Rect2(p.pos-Vector2(8,8),Vector2(16,16)),region)
	var font := ThemeDB.fallback_font
	for fx in garden.effects:
		var age: float = 1.0-fx.ttl/fx.life
		var ink := Color("b0e7df") if fx.kind == "mist_hit" else Color("f6bf65")
		ink.a = 1.0-age
		if fx.kind == "kill":
			draw_string(font,fx.pos+Vector2(-10,-20-age*24),"+%d"%fx.value,HORIZONTAL_ALIGNMENT_LEFT,-1,16,ink)
		elif fx.kind == "mist_hit":
			draw_arc(fx.pos,8+age*40,0,TAU,24,ink,2.0)
		elif fx.kind in ["hit","base_hit","place"]:
			for i in range(4):
				var direction := Vector2.from_angle(PI/4+i*PI/2)
				draw_line(fx.pos+direction*(4+age*14),fx.pos+direction*(9+age*14),ink,2)

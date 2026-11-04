extends RefCounted

const START_COINS := 140
const MAX_HEALTH := 8
const SPOTS := [Vector2(162,248),Vector2(328,260),Vector2(328,360),Vector2(408,490),Vector2(546,360),Vector2(580,200),Vector2(584,478),Vector2(690,398)]
const TOWERS := {"amber":{"cost":50,"range":140.0,"damage":16.0,"cooldown":0.60,"speed":440.0}, "mist":{"cost":40,"range":120.0,"damage":3.0,"cooldown":1.0,"speed":360.0}}
var state := "ready"
var wave := 0
var base_health := MAX_HEALTH
var coins := START_COINS
var kills := 0
var enemies: Array[Dictionary] = []
var towers: Array[Dictionary] = []
var projectiles: Array[Dictionary] = []
var paused := false
var ticks := 0
var active_ticks := 0
var spawned := 0
var leaked := 0
var max_simultaneous := 0
var pending: Array = []
var spawn_clock := 0.0
var next_enemy_id := 1
var events: Array[Dictionary] = []
var shots := 0
var slow_applications := 0
var damage_dealt := 0.0
const PATH := [Vector2(36,182),Vector2(262,182),Vector2(262,420),Vector2(478,420),Vector2(478,270),Vector2(644,270),Vector2(644,528)]
const WAVE_KINDS := [["beetle","beetle","beetle","beetle","beetle","beetle"], ["beetle","runner","beetle","beetle","runner","beetle","runner","beetle"], ["beetle","runner","heavy","beetle","runner","beetle","heavy","beetle","runner","beetle"]]
const INTERVALS := [0.85,0.75,0.70]

func start_next_wave() -> bool:
	if paused or state != "ready" or wave >= 3:
		return false
	wave += 1
	state = "playing"
	pending = WAVE_KINDS[wave-1].duplicate()
	spawn_clock = 0.0
	return true

func path_length() -> float:
	var total := 0.0
	for i in range(1,PATH.size()):
		total += PATH[i-1].distance_to(PATH[i])
	return total

func point_on_path(distance: float) -> Vector2:
	var left := distance
	for i in range(1,PATH.size()):
		var length: float = PATH[i-1].distance_to(PATH[i])
		if left <= length:
			return PATH[i-1].lerp(PATH[i],left/length)
		left -= length
	return PATH.back()

func _spawn(kind: String) -> void:
	var hp: float = [48.0,74.0,105.0][wave-1]
	var speed: float = [76.0,88.0,94.0][wave-1]
	var reward: int = [10,12,14][wave-1]
	var damage := 1
	if kind == "runner":
		hp = 42.0 if wave == 2 else 58.0
		speed = 124.0
	elif kind == "heavy":
		hp = 170.0
		speed = 64.0
		reward = 20
		damage = 2
	enemies.append({"id":next_enemy_id,"kind":kind,"hp":hp,"max_hp":hp,"speed":speed,"reward":reward,"damage":damage,"distance":0.0,"pos":PATH[0],"slow_time":0.0,"hurt":0.0})
	next_enemy_id += 1
	spawned += 1
	max_simultaneous = maxi(max_simultaneous,enemies.size())

func _damage(e: Dictionary, amount: float) -> void:
	if e.hp <= 0.0:
		return
	damage_dealt += minf(amount,e.hp)
	e.hp -= amount
	e.hurt = 0.12
	if e.hp <= 0.0:
		kills += 1
		coins += e.reward
		events.append({"kind":"kill","pos":e.pos,"value":e.reward})

func _combat(dt: float) -> void:
	for t in towers:
		t.cooldown = maxf(0.0,t.cooldown-dt)
		t.recoil = maxf(0.0,t.recoil-dt)
		if t.cooldown > 0.0:
			continue
		var target: Dictionary = {}
		for e in enemies:
			if e.hp > 0.0 and t.pos.distance_to(e.pos) <= TOWERS[t.kind].range:
				if target.is_empty() or e.distance > target.distance:
					target = e
		if not target.is_empty():
			t.cooldown = TOWERS[t.kind].cooldown
			t.recoil = 0.20
			shots += 1
			projectiles.append({"kind":t.kind,"pos":t.pos+Vector2(0,-22),"target":target.id,"alive":true})
			events.append({"kind":"shot" if t.kind == "amber" else "mist","pos":t.pos})
	for p in projectiles:
		var target: Dictionary = {}
		for e in enemies:
			if e.id == p.target and e.hp > 0.0:
				target = e
				break
		if target.is_empty():
			p.alive = false
			continue
		var speed: float = TOWERS[p.kind].speed
		if p.pos.distance_to(target.pos) <= speed*dt+4.0:
			p.alive = false
			if p.kind == "mist":
				for e in enemies:
					if e.hp > 0.0 and e.pos.distance_to(target.pos) <= 48.0:
						e.slow_time = 1.6
						slow_applications += 1
						_damage(e,3.0)
				events.append({"kind":"mist_hit","pos":target.pos})
			else:
				_damage(target,16.0)
				events.append({"kind":"hit","pos":target.pos})
		else:
			p.pos = p.pos.move_toward(target.pos,speed*dt)
	projectiles = projectiles.filter(func(p): return p.alive)

func step(dt: float) -> void:
	if paused or state not in ["playing","ready"]:
		return
	ticks += 1
	events.clear()
	if state != "playing":
		return
	active_ticks += 1
	spawn_clock -= dt
	while not pending.is_empty() and spawn_clock <= 0.0:
		_spawn(pending.pop_front())
		spawn_clock += INTERVALS[wave-1]
	for e in enemies:
		e.distance += e.speed * dt * (0.45 if e.slow_time > 0.0 else 1.0)
		e.slow_time = maxf(0.0,e.slow_time-dt)
		e.hurt = maxf(0.0,e.hurt-dt)
		e.pos = point_on_path(e.distance)
		if e.distance >= path_length():
			e.hp = 0.0
			base_health = maxi(0,base_health-e.damage)
			leaked += 1
			events.append({"kind":"base_hit","pos":e.pos})
	_combat(dt)
	enemies = enemies.filter(func(e): return e.hp > 0.0)
	if base_health <= 0:
		state = "defeat"
		projectiles.clear()
		enemies.clear()
		return
	if enemies.is_empty() and pending.is_empty():
		projectiles.clear()
		if wave == 3:
			state = "victory"
		else:
			state = "ready"
			coins += 25

func place(kind: String, pad: int) -> String:
	if not TOWERS.has(kind) or pad < 0 or pad >= SPOTS.size():
		return "invalid"
	if paused or state not in ["ready","playing"]:
		return "blocked"
	for tower in towers:
		if tower.pad == pad:
			return "occupied"
	if coins < TOWERS[kind].cost:
		return "funds"
	coins -= TOWERS[kind].cost
	towers.append({"kind":kind,"pad":pad,"pos":SPOTS[pad],"cooldown":0.0,"recoil":0.0})
	return "placed"

func summary() -> Dictionary:
	var tower_data: Array = []
	for t in towers:
		tower_data.append({"type":t.kind,"pad":String.chr(65+t.pad),"position":[t.pos.x,t.pos.y]})
	var enemy_data: Array = []
	for e in enemies:
		enemy_data.append({"id":e.id,"type":e.kind,"hp":e.hp,"progress":e.distance,"position":[e.pos.x,e.pos.y],"slow_seconds":e.slow_time})
	return {"state":state, "wave":wave, "base_health":base_health, "coins":coins, "kills":kills, "enemies":enemies.size(), "enemy_data":enemy_data, "tower_count":towers.size(), "towers":tower_data, "projectiles":projectiles.size(), "paused":paused,"ticks":ticks,"active_ticks":active_ticks,"spawned":spawned,"pending":pending.size(),"leaked":leaked,"max_simultaneous":max_simultaneous,"shots":shots,"slow_applications":slow_applications,"damage_dealt":damage_dealt}

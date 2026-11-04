extends SceneTree

var failed := 0

func check(ok: bool, message: String) -> void:
	if not ok:
		failed += 1
		print("FAIL: " + message)

func _init() -> void:
	if not ResourceLoader.exists("res://scripts/rules.gd"):
		print("FAIL: new game rules resource is missing")
		quit(1)
		return
	var rules_script = load("res://scripts/rules.gd")
	var game = rules_script.new()
	var s: Dictionary = game.summary()
	check(s.state == "ready", "new game waits for the player's wave click")
	check(s.base_health == 8 and s.coins == 140, "new game has 8 health / 140 coins")
	check(s.wave == 0 and s.enemies == 0 and s.tower_count == 0 and s.kills == 0, "new game is empty")
	if not game.has_method("place"):
		check(false, "normal placement is not implemented")
	else:
		check(game.place("amber",0) == "placed", "can buy amber on pad A")
		check(game.place("amber",0) == "occupied", "occupied pad refuses without spending")
		check(game.place("mist",1) == "placed", "can buy mist on pad B")
		check(game.place("amber",2) == "placed", "can buy second amber on pad C")
		check(game.place("amber",3) == "funds", "limited starting money enforced")
		check(game.place("other",3) == "invalid" and game.place("amber",99) == "invalid", "invalid type / pad refused")
		check(game.coins == 0 and game.towers.size() == 3, "spending conserves coins and towers")
	if not game.has_method("start_next_wave") or not game.has_method("step"):
		check(false, "ordinary wave progression is not implemented")
	else:
		var undefended = rules_script.new()
		check(undefended.start_next_wave(), "wave starts from ready")
		check(not undefended.start_next_wave(), "cannot overlap waves")
		for i in range(180):
			undefended.step(1.0/60.0)
		check(undefended.enemies.size() >= 3, "several enemies advance simultaneously")
		check(undefended.enemies[0].distance > undefended.enemies[1].distance, "enemies keep distinct progress")
		undefended.paused = true
		var frozen: Dictionary = undefended.summary()
		for i in range(180):
			undefended.step(1.0/60.0)
		check(undefended.summary() == frozen, "pause freezes the complete rules summary")
		check(undefended.place("amber",0) == "blocked" and not undefended.start_next_wave(), "pause blocks placement and wave advance")
		undefended.paused = false
		for i in range(3000):
			undefended.step(1.0/60.0)
		check(undefended.state == "ready" and undefended.wave == 1 and undefended.base_health == 2, "all six undefended enemies deal one base damage")
		check(undefended.start_next_wave(), "wave two can be called normally")
		for i in range(3000):
			undefended.step(1.0/60.0)
		check(undefended.state == "defeat" and undefended.base_health == 0 and undefended.kills == 0, "no towers eventually lose")
		var defended = rules_script.new()
		defended.place("amber",0)
		defended.place("mist",1)
		defended.place("amber",2)
		var wave_receipts: Array = []
		for w in range(1,4):
			if w == 2:
				check(defended.place("amber",4) == "placed", "wave-one rewards buy an E fire tower")
			elif w == 3:
				check(defended.place("amber",5) == "placed", "wave-two rewards buy F")
				check(defended.place("amber",6) == "placed", "wave-two rewards buy G")
			check(defended.start_next_wave(), "normal defended wave %d starts" % w)
			for i in range(6000):
				defended.step(1.0/60.0)
				if defended.state != "playing":
					break
			wave_receipts.append(defended.summary())
		check(defended.state == "victory" and defended.wave == 3 and defended.base_health > 0, "legal placements can win all three waves")
		check(defended.kills == 24 and defended.leaked == 0, "recommended defense defeats every enemy")
		check(not defended.start_next_wave(), "there is no fourth wave")
		print("DEFENDED_WAVES ", JSON.stringify(wave_receipts))
	print("RULES_TEST failures=", failed)
	quit(1 if failed else 0)

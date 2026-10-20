extends "res://tests/godot/test_case.gd"
## Property test: any path that still reaches a protected file must be refused, however it is spelled.
## Mutations are case flips, doubled slashes and "./" segments — all of which resolve to the same file on a
## case-insensitive file system (macOS, Windows), so a bypass here is a real escape, not a spelling variant.
## On a case-sensitive file system the mutated path simply does not exist, and the check is skipped: there is
## nothing behind it to reach.

const PathGuard = preload("res://addons/mcp_loop/util/path_guard.gd")

const SEED := 20261020
const MUTATIONS_PER_PATH := 240

const READ_TARGETS: Array[String] = [
	"res://.git/config",
	"res://.godot/global_script_class_cache.cfg",
]
const WRITE_TARGETS: Array[String] = [
	"res://addons/mcp_loop/fuzz_probe.gd",
	"res://.git/hooks/pre-commit",
]
## Reachable, harmless paths: the same mutations must still be allowed.
const ALLOWED_TARGETS: Array[String] = [
	"res://examples/marble/main.tscn",
	"res://tests/godot/test_case.gd",
]


func _flip_case(path: String, rng: RandomNumberGenerator) -> String:
	var out := ""
	for i in path.length():
		var c := path[i]
		if c.to_lower() != c.to_upper() and rng.randf() < 0.4:
			out += c.to_upper() if rng.randf() < 0.5 else c.to_lower()
		else:
			out += c
	return out


func _mutations(path: String, rng: RandomNumberGenerator) -> Array[String]:
	var out: Array[String] = [path]
	out.append(path.replace("/", "//"))
	out.append(path.replace("res://", "res://./"))
	out.append(path.replace("res://", "res://././"))
	out.append(path.replace("res://", "res://./")) 
	out.append(path + "/.")
	out.append("res://" + path.substr("res://".length()))
	for _i in MUTATIONS_PER_PATH:
		var m := _flip_case(path, rng)
		if rng.randf() < 0.4:
			m = m.replace("res://", "res://./")
		if rng.randf() < 0.2:
			m = m.replace("/", "//")
		out.append(m)
	return out


func _dir_exists(path: String) -> bool:
	return DirAccess.open(path.get_base_dir()) != null


func test_read_mutations_never_reach_a_protected_file() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = SEED
	var reachable := 0
	for target in READ_TARGETS:
		for m in _mutations(target, rng):
			if not FileAccess.file_exists(m):
				continue  # case-sensitive file system: nothing behind this spelling
			reachable += 1
			assert_true(PathGuard.check_read(m) != "", "read bypass: %s" % m)
	assert_true(reachable > 0, "no mutated path resolved; the property test proved nothing")


func test_write_mutations_never_reach_a_protected_dir() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = SEED + 1
	var reachable := 0
	for target in WRITE_TARGETS:
		for m in _mutations(target, rng):
			if not _dir_exists(m):
				continue
			reachable += 1
			assert_true(PathGuard.check_write(m, ["gd"]) != "", "write bypass: %s" % m)
	assert_true(reachable > 0, "no mutated path resolved; the property test proved nothing")


func test_harmless_mutations_stay_allowed() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = SEED + 2
	for target in ALLOWED_TARGETS:
		for m in _mutations(target, rng):
			if not FileAccess.file_exists(m):
				continue
			assert_eq(PathGuard.check_read(m), "", "allowed path refused: %s" % m)

extends RefCounted
## Bridge protocol v1 constants and envelope helpers.
## Every handler returns either ok(result) or err(code, message, hint).

const VERSION := 1

const UNAUTHORIZED := "UNAUTHORIZED"
const PROTOCOL_MISMATCH := "PROTOCOL_MISMATCH"
const UNKNOWN_METHOD := "UNKNOWN_METHOD"
const INVALID_PARAMS := "INVALID_PARAMS"
const NO_EDITED_SCENE := "NO_EDITED_SCENE"
const NODE_NOT_FOUND := "NODE_NOT_FOUND"
const PATH_FORBIDDEN := "PATH_FORBIDDEN"
const FILE_NOT_FOUND := "FILE_NOT_FOUND"
const ALREADY_EXISTS := "ALREADY_EXISTS"
const SCRIPT_PARSE_ERROR := "SCRIPT_PARSE_ERROR"
const GAME_NOT_RUNNING := "GAME_NOT_RUNNING"
const GAME_ALREADY_RUNNING := "GAME_ALREADY_RUNNING"
const TIMEOUT := "TIMEOUT"
const RENDERING_UNAVAILABLE := "RENDERING_UNAVAILABLE"
const NOTHING_TO_UNDO := "NOTHING_TO_UNDO"
const INTERNAL := "INTERNAL"


static func ok(result: Variant = {}) -> Dictionary:
	return {"ok": true, "result": result}


static func err(code: String, message: String, hint: String = "") -> Dictionary:
	var e := {"code": code, "message": message}
	if hint != "":
		e["hint"] = hint
	return {"ok": false, "error": e}


static func is_envelope(value: Variant) -> bool:
	if typeof(value) != TYPE_DICTIONARY:
		return false
	var d: Dictionary = value
	if d.get("ok") == true:
		return d.has("result")
	if d.get("ok") == false:
		return typeof(d.get("error")) == TYPE_DICTIONARY and d["error"].has("code")
	return false

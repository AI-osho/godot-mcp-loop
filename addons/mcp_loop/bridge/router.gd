extends RefCounted
## Routes bridge requests ({id, method, params}) to registered handlers.
## The first request of every session must be a successful `hello` carrying
## the session token; everything else is rejected with UNAUTHORIZED until then.
## Handlers are Callables taking the params Dictionary and returning a protocol
## envelope (Protocol.ok / Protocol.err). They may be coroutines.

const Protocol = preload("res://addons/mcp_loop/bridge/protocol.gd")

var _token: String
var _authenticated := false
var _handlers: Dictionary = {}


func _init(token: String) -> void:
	_token = token
	register("ping", func(_p: Dictionary) -> Dictionary: return Protocol.ok({"pong": true}))


func register(method: String, handler: Callable) -> void:
	_handlers[method] = handler


func has_method_registered(method: String) -> bool:
	return _handlers.has(method)


func is_authenticated() -> bool:
	return _authenticated


func reset_session() -> void:
	_authenticated = false


func handle_text(text: String) -> String:
	var json := JSON.new()
	if json.parse(text) != OK or typeof(json.data) != TYPE_DICTIONARY:
		return JSON.stringify(_with_id(null, Protocol.err(Protocol.INVALID_PARAMS, "Request must be a JSON object.")))
	var response: Dictionary = await handle(json.data)
	return JSON.stringify(response)


func handle(request: Dictionary) -> Dictionary:
	var id: Variant = request.get("id")
	var method: Variant = request.get("method")
	if typeof(method) != TYPE_STRING or method == "":
		return _with_id(id, Protocol.err(Protocol.INVALID_PARAMS, "Missing 'method'."))

	var params: Variant = request.get("params", {})
	if params == null:
		params = {}
	if typeof(params) != TYPE_DICTIONARY:
		return _with_id(id, Protocol.err(Protocol.INVALID_PARAMS, "'params' must be an object."))

	if method == "hello":
		return _with_id(id, _hello(params))

	if not _authenticated:
		return _with_id(id, Protocol.err(Protocol.UNAUTHORIZED, "Send a successful 'hello' first."))

	if not _handlers.has(method):
		return _with_id(id, Protocol.err(Protocol.UNKNOWN_METHOD, "Unknown method '%s'." % method))

	var handler: Callable = _handlers[method]
	var result: Variant = await handler.call(params)
	if not Protocol.is_envelope(result):
		return _with_id(id, Protocol.err(Protocol.INTERNAL, "Handler for '%s' returned an invalid response." % method))
	return _with_id(id, result)


## Checks a hello's token and protocol without changing session state.
func verify_hello(params: Dictionary) -> Dictionary:
	var token: Variant = params.get("token", "")
	if typeof(token) != TYPE_STRING or not _constant_time_equals(token, _token):
		return Protocol.err(Protocol.UNAUTHORIZED, "Invalid token.", "Read the token from .godot/mcp_loop/session.json of the running editor.")
	var protocol: Variant = params.get("protocol", -1)
	if (typeof(protocol) != TYPE_INT and typeof(protocol) != TYPE_FLOAT) or int(protocol) != Protocol.VERSION:
		return Protocol.err(Protocol.PROTOCOL_MISMATCH,
			"Addon speaks protocol %d, client sent %s." % [Protocol.VERSION, str(protocol)],
			"Update the MCP server and the Godot addon to matching versions.")
	return Protocol.ok({})


func _hello(params: Dictionary) -> Dictionary:
	var check := verify_hello(params)
	if not check.ok:
		_authenticated = false
		return check
	_authenticated = true
	return Protocol.ok({
		"protocol": Protocol.VERSION,
		"godot_version": Engine.get_version_info().get("string", ""),
		"addon_version": "0.1.0",
	})


func _with_id(id: Variant, envelope: Dictionary) -> Dictionary:
	var out := {"id": id}
	out.merge(envelope)
	return out


static func _constant_time_equals(a: String, b: String) -> bool:
	var ba := a.to_utf8_buffer()
	var bb := b.to_utf8_buffer()
	if ba.size() != bb.size():
		return false
	var diff := 0
	for i in ba.size():
		diff |= ba[i] ^ bb[i]
	return diff == 0

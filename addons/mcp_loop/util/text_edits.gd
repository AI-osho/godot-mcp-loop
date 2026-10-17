extends RefCounted
## Exact-text replacements for partial file edits (script_edit).
## Each edit {old, new, replace_all?} applies to the result of the previous one.
## `old` must occur exactly once unless replace_all is set, so an edit never
## lands somewhere unintended.

const MAX_EDITS := 50


static func apply(content: String, edits: Variant) -> Dictionary:
	if typeof(edits) != TYPE_ARRAY or edits.is_empty():
		return {"ok": false, "error": "'edits' must be a non-empty array of {old, new}."}
	if edits.size() > MAX_EDITS:
		return {"ok": false, "error": "At most %d edits per call." % MAX_EDITS}
	var text := content
	var replacements := 0
	for i in edits.size():
		var e: Variant = edits[i]
		var n: int = i + 1
		if typeof(e) != TYPE_DICTIONARY or typeof(e.get("old")) != TYPE_STRING or typeof(e.get("new")) != TYPE_STRING:
			return {"ok": false, "error": "Edit %d must be {\"old\": string, \"new\": string}." % n}
		var old: String = e["old"]
		var new: String = e["new"]
		if old == "":
			return {"ok": false, "error": "Edit %d: 'old' must not be empty (use script_write to create files)." % n}
		if old == new:
			return {"ok": false, "error": "Edit %d: 'old' and 'new' are identical." % n}
		var count: int = text.count(old)
		if count == 0:
			return {"ok": false, "error": "Edit %d: text not found: %s" % [n, _snippet(old)],
				"hint": "Read the current file with script_read; 'old' must match exactly, including indentation (tabs)."}
		if count > 1 and not e.get("replace_all", false):
			return {"ok": false, "error": "Edit %d: text occurs %d times: %s" % [n, count, _snippet(old)],
				"hint": "Include more surrounding lines to make it unique, or set replace_all: true."}
		text = text.replace(old, new)
		replacements += count
	return {"ok": true, "content": text, "replacements": replacements}


static func _snippet(s: String) -> String:
	var one_line := s.replace("\n", "\\n").replace("\t", "\\t")
	return "\"%s\"" % (one_line if one_line.length() <= 80 else one_line.substr(0, 77) + "...")

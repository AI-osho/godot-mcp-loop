@tool
extends RefCounted
## Path sandbox. Every path coming from the AI goes through here.
## Reads: must be inside res://. Writes: additionally restricted by extension
## and never into .godot/, .git/ or this addon's own folder.
## Functions return "" when allowed, otherwise a human-readable reason.

const PROTECTED_READ_PREFIXES := [
	"res://.godot/",
	"res://.git/",
]

const PROTECTED_WRITE_PREFIXES := [
	"res://.godot/",
	"res://.git/",
	"res://addons/mcp_loop/",
]


static func normalize(path: String) -> String:
	if not path.begins_with("res://"):
		return path
	var rest := path.substr("res://".length())
	var parts: Array[String] = []
	for seg in rest.split("/"):
		if seg == "" or seg == ".":
			continue
		parts.append(seg)
	return "res://" + "/".join(parts)


static func _has_control_chars(s: String) -> bool:
	for i in s.length():
		var c := s.unicode_at(i)
		if c < 32 or c == 127 or c == 0xFFFD:
			return true
	return false


static func check_read(path: String) -> String:
	if path == "":
		return "Path is empty."
	if path.contains("\\") or _has_control_chars(path):
		return "Path contains forbidden characters: %s" % path.c_escape()
	if not path.begins_with("res://"):
		return "Only res:// paths are allowed (got '%s')." % path
	for seg in path.substr("res://".length()).split("/"):
		if seg == "..":
			return "Parent directory segments ('..') are not allowed: %s" % path
	var norm := normalize(path)
	for prefix in PROTECTED_READ_PREFIXES:
		if norm.begins_with(prefix):
			return "Access under %s is not allowed." % prefix
	return ""


static func check_write(path: String, allowed_extensions: Array) -> String:
	var r := check_read(path)
	if r != "":
		return r
	var norm := normalize(path)
	for prefix in PROTECTED_WRITE_PREFIXES:
		if norm.begins_with(prefix):
			return "Writing under %s is not allowed." % prefix
	var ext := norm.get_extension().to_lower()
	if not allowed_extensions.has(ext):
		return "Only %s files can be written here (got '%s')." % [", ".join(allowed_extensions.map(func(e): return "." + e)), norm.get_file()]
	return ""

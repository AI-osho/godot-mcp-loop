@tool
extends RefCounted
## Path sandbox. Every path coming from the AI goes through here.
## Reads: must be inside res://. Writes: additionally restricted by extension
## and never into .godot/, .git/ or this addon's own folder.
## Functions return "" when allowed, otherwise a human-readable reason.

const MAX_DIRECTORY_ENTRIES := 4096

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


## macOS and Windows ignore case (and Unicode normalization) in file names, so `res://.GIT/config`
## reaches `.git/`, and `res://Addons/mcp_loop/x.gd` reaches the addon. Rebuild the path with the
## real on-disk spelling of every existing segment before any prefix check.
static func canonical(path: String) -> String:
	var norm := normalize(path)
	var rest := norm.substr("res://".length())
	if rest == "":
		return norm
	var parts := rest.split("/")
	var dir := DirAccess.open("res://")
	if dir == null:
		return norm
	dir.include_hidden = true
	var out: Array[String] = []
	for i in parts.size():
		var lookup := _real_name(dir, parts[i])
		if not lookup.ok:
			return "" # Every guard must preserve this fail-closed result.
		var actual: String = lookup.name
		if actual == "":
			out.append(parts[i])
		else:
			out.append(actual)
		if i == parts.size() - 1:
			break
		if actual == "" or dir.is_link(actual) or not dir.dir_exists(actual) or dir.change_dir(actual) != OK:
			out.append_array(Array(parts.slice(i + 1)))
			break
	return "res://" + "/".join(out)


## The name a segment has on disk, or "" when nothing matches (a new file or folder).
## Only the directory listing is trusted: `dir_exists()` ignores case, so asking it about
## "Addons" would happily answer yes and keep the caller's spelling.
static func _real_name(dir: DirAccess, seg: String) -> Dictionary:
	# Preserve links for the subsequent no-follow check, without traversing them.
	if dir.is_link(seg):
		return {"ok": true, "name": seg}
	if dir.list_dir_begin() != OK:
		return {"ok": false}
	var low := seg.to_lower()
	var folded := ""
	var equivalent := ""
	var exists := dir.dir_exists(seg) or dir.file_exists(seg)
	var count := 0
	while true:
		var name := dir.get_next()
		if name == "":
			break
		count += 1
		if count > MAX_DIRECTORY_ENTRIES:
			dir.list_dir_end()
			return {"ok": false}
		if name == seg:
			dir.list_dir_end()
			return {"ok": true, "name": name}
		if folded == "" and name.to_lower() == low:
			folded = name
		# Native equivalence covers Unicode/short-name aliases without a retained listing.
		if equivalent == "" and exists and dir.is_equivalent(seg, name):
			equivalent = name
	dir.list_dir_end()
	return {"ok": true, "name": folded if folded != "" else equivalent}


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
		if seg.contains(":") or (seg != "." and (seg.ends_with(".") or seg.ends_with(" "))):
			return "Colons and trailing dots/spaces are not allowed in path segments."
	var norm := canonical(path)
	if norm == "":
		return "Path canonicalization failed or exceeds the 4096-entry directory scan limit."
	for prefix in PROTECTED_READ_PREFIXES:
		if norm.to_lower() == prefix.to_lower().trim_suffix("/") or norm.to_lower().begins_with(prefix.to_lower()):
			return "Access under %s is not allowed." % prefix
	return _symlink_reason(norm)


## Godot follows symbolic links, so a link inside the project could point
## anywhere on disk. Refuse any path whose existing segments include a link.
static func _symlink_reason(norm: String) -> String:
	var scheme := "user://" if norm.begins_with("user://") else "res://"
	var rest := norm.substr(scheme.length())
	if rest == "":
		return ""
	var parts := rest.split("/")
	var dir := DirAccess.open(scheme)
	if dir == null:
		return ""
	for i in parts.size():
		var seg := parts[i]
		if dir.is_link(seg):
			return "Symbolic links are not followed: %s%s" % [scheme, "/".join(parts.slice(0, i + 1))]
		if i == parts.size() - 1 or not dir.dir_exists(seg) or dir.change_dir(seg) != OK:
			return ""
	return ""


## For fixed internal cache paths only, never an agent-selected alternative to check_write().
## The regular guard blocks .godot/ entirely; internal token/movie/test writers still must not follow its links.
static func check_internal_path(path: String) -> String:
	if path.contains("\\") or _has_control_chars(path):
		return "Path contains forbidden characters."
	if not path.begins_with("res://") and not path.begins_with("user://"):
		return "Expected a project or user-data path."
	for seg in path.substr(path.find("://") + 3).split("/"):
		if seg == "..":
			return "Parent directory segments are not allowed."
	var norm := canonical(path) if path.begins_with("res://") else path
	if norm == "":
		return "Path canonicalization failed or exceeds the 4096-entry directory scan limit."
	return _symlink_reason(norm)


static func check_write(path: String, allowed_extensions: Array) -> String:
	var r := check_read(path)
	if r != "":
		return r
	var norm := canonical(path)
	if norm == "":
		return "Path canonicalization failed or exceeds the 4096-entry directory scan limit."
	for prefix in PROTECTED_WRITE_PREFIXES:
		if norm.to_lower() == prefix.to_lower().trim_suffix("/") or norm.to_lower().begins_with(prefix.to_lower()):
			return "Writing under %s is not allowed." % prefix
	var ext := norm.get_extension().to_lower()
	if not allowed_extensions.has(ext):
		return "Only %s files can be written here (got '%s')." % [", ".join(allowed_extensions.map(func(e): return "." + e)), norm.get_file()]
	return ""

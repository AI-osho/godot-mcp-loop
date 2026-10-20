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
	var out: Array[String] = []
	for i in parts.size():
		var actual := _real_name(dir, parts[i])
		if actual == "":
			out.append(parts[i])
		else:
			out.append(actual)
		if i == parts.size() - 1:
			break
		if actual == "" or not dir.dir_exists(actual) or dir.change_dir(actual) != OK:
			out.append_array(Array(parts.slice(i + 1)))
			break
	return "res://" + "/".join(out)


## The name a segment has on disk, or "" when nothing matches (a new file or folder).
## Only the directory listing is trusted: `dir_exists()` ignores case, so asking it about
## "Addons" would happily answer yes and keep the caller's spelling.
static func _real_name(dir: DirAccess, seg: String) -> String:
	var dirs := dir.get_directories()
	var files := dir.get_files()
	for d in dirs:
		if d == seg:
			return seg
	for f in files:
		if f == seg:
			return seg
	var low := seg.to_lower()
	for d in dirs:
		if d.to_lower() == low:
			return d
	for f in files:
		if f.to_lower() == low:
			return f
	return ""


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
	var norm := canonical(path)
	for prefix in PROTECTED_READ_PREFIXES:
		if norm.to_lower().begins_with(prefix.to_lower()):
			return "Access under %s is not allowed." % prefix
	return _symlink_reason(norm)


## Godot follows symbolic links, so a link inside the project could point
## anywhere on disk. Refuse any path whose existing segments include a link.
static func _symlink_reason(norm: String) -> String:
	var rest := norm.substr("res://".length())
	if rest == "":
		return ""
	var parts := rest.split("/")
	var dir := DirAccess.open("res://")
	if dir == null:
		return ""
	for i in parts.size():
		var seg := parts[i]
		if dir.is_link(seg):
			return "Symbolic links are not followed: res://%s" % "/".join(parts.slice(0, i + 1))
		if i == parts.size() - 1 or not dir.dir_exists(seg) or dir.change_dir(seg) != OK:
			return ""
	return ""


static func check_write(path: String, allowed_extensions: Array) -> String:
	var r := check_read(path)
	if r != "":
		return r
	var norm := canonical(path)
	for prefix in PROTECTED_WRITE_PREFIXES:
		if norm.to_lower().begins_with(prefix.to_lower()):
			return "Writing under %s is not allowed." % prefix
	var ext := norm.get_extension().to_lower()
	if not allowed_extensions.has(ext):
		return "Only %s files can be written here (got '%s')." % [", ".join(allowed_extensions.map(func(e): return "." + e)), norm.get_file()]
	return ""

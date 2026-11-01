@tool
extends RefCounted
## Reject values Godot rewrites before parsing its argv list. Never silently change a caller's path or identifier.

static func check(value: String) -> String:
	if value == "" or value != value.strip_edges() or "%20" in value:
		return "The value cannot be passed literally to Godot's command-line parser (edge whitespace or literal %20)."
	for i in value.length():
		var c := value.unicode_at(i)
		if c < 32 or c == 127:
			return "Control characters are not allowed in a Godot command-line argument."
	return ""

extends "res://tests/godot/test_case.gd"

const EditorContext = preload("res://addons/mcp_loop/commands/context.gd")
const LogCapture = preload("res://addons/mcp_loop/util/log_capture.gd")
const NodeCommands = preload("res://addons/mcp_loop/commands/node_commands.gd")
const ScriptCommands = preload("res://addons/mcp_loop/commands/script_commands.gd")

class PreviewContext extends EditorContext:
	var scene: Node
	func _init(root: Node) -> void:
		super(LogCapture.new(10))
		scene = root
	func edited_root() -> Node:
		return scene

func test_invalid_indexed_builtin_member_is_rejected_without_native_access_or_changes() -> void:
	var root := Node2D.new()
	var ctx := PreviewContext.new(root)
	var commands := NodeCommands.new(ctx)
	var result: Dictionary = commands._set_props({"path": ".", "properties": {"position:q": 9}, "dry_run": true})
	assert_error_code(result, "INVALID_PARAMS", "Invalid members must fail before native indexed access.")
	assert_eq(root.position, Vector2.ZERO)
	assert_eq(ctx._counter, 0)
	root.free()


func test_indexed_resource_preview_does_not_mutate_the_live_resource() -> void:
	var root := CollisionShape2D.new()
	var shape := RectangleShape2D.new()
	shape.size = Vector2(10, 20)
	root.shape = shape
	var ctx := PreviewContext.new(root)
	var commands := NodeCommands.new(ctx)
	var result: Dictionary = commands._set_props({"path": ".", "properties": {"shape:size": [50, 60]}, "dry_run": true})
	assert_eq(result.ok, true, JSON.stringify(result))
	assert_eq(shape.size, Vector2(10, 20), "preparing a preview must not change a shared native Resource")
	assert_eq(root.shape, shape, "the original identity must remain installed on the node")
	assert_eq(result.result.changes["shape:size"].before, [10.0, 20.0], "before must be captured before any mutation")
	assert_eq(result.result.changes["shape:size"].after, [50.0, 60.0])
	root.free()


func test_native_save_identity_fields_are_not_generic_property_edits() -> void:
	var root := CollisionShape2D.new()
	root.scene_file_path = "res://qa/original.tscn"
	root.shape = RectangleShape2D.new()
	var commands := NodeCommands.new(PreviewContext.new(root))
	for properties in [
		{"scene_file_path": "res://qa/replaced.tscn"},
		{"shape:resource_path": "res://qa/replaced.tres"},
		{"shape": {"new": "RectangleShape2D", "properties": {"resource_path": "res://qa/replaced.tres"}}},
	]:
		var result: Dictionary = commands._set_props({"path": ".", "properties": properties, "dry_run": true})
		assert_error_code(result, "INVALID_PARAMS", JSON.stringify(properties))
	assert_eq(root.scene_file_path, "res://qa/original.tscn")
	assert_eq(root.shape.resource_path, "")
	root.free()

func test_tool_annotation_scanner_preserves_comments_strings_and_locations() -> void:
	for content in ["# @tool\nextends Node\n", 'extends Node\nvar s = "@tool"\n', "extends Node\nvar s = '''\n@tool\n'''\n", 'extends Node\nvar s = r"@tool"\n']:
		var result := ScriptCommands.validation_source(content)
		assert_eq(result.is_tool, false, content)
		assert_eq(result.source, content, "non-annotation source must remain byte-identical")
	var content := '@icon("res://é.svg")@tool # @tool\nextends Node\nvar s = "@tool"\n'
	var result := ScriptCommands.validation_source(content)
	assert_eq(result.is_tool, true)
	assert_eq(result.source, content.replace(')@tool #', ')      #'))
	assert_eq(result.source.to_utf8_buffer().size(), content.to_utf8_buffer().size())

class ReferencedNodeHost extends Node:
	var target: Node2D

func test_indexed_non_resource_object_preview_is_rejected_without_mutation() -> void:
	var root := ReferencedNodeHost.new()
	var target := Node2D.new()
	root.target = target
	var commands := NodeCommands.new(PreviewContext.new(root))
	var result: Dictionary = commands._set_props({"path": ".", "properties": {"target:position": [50, 60]}, "dry_run": true})
	assert_error_code(result, "INVALID_PARAMS")
	assert_eq(target.position, Vector2.ZERO, "an indexed Object reference must not expose another live node to preview mutation")
	target.free()
	root.free()

func test_indexed_script_source_preview_requires_the_script_editing_path() -> void:
	var root := Node.new()
	var script := GDScript.new()
	var source := "extends Node\nvar fixture := 1\n"
	script.source_code = source
	assert_eq(script.reload(), OK)
	root.set_script(script)
	var commands := NodeCommands.new(PreviewContext.new(root))
	var result: Dictionary = commands._set_props({"path": ".", "properties": {"script:source_code": "extends Node\nvar fixture := 2\n"}, "dry_run": true})
	assert_error_code(result, "INVALID_PARAMS")
	assert_eq(script.source_code, source, "code changes must go through script_write/script_edit, not indexed property preparation")
	root.free()

func test_remembered_actions_are_bounded() -> void:
	var ctx := EditorContext.new(LogCapture.new(10))
	for i in EditorContext.MAX_TRACKED_ACTIONS + 25:
		ctx._remember(0, "MCP#%d: x" % i)
	assert_eq(ctx.tracked_action_count(), EditorContext.MAX_TRACKED_ACTIONS)
	assert_eq(ctx._actions.back().name, "MCP#%d: x" % (EditorContext.MAX_TRACKED_ACTIONS + 24), "newest kept")

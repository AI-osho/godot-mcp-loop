@tool
extends EditorPlugin

var _ticked := false

func _enter_tree() -> void:
	print("MCP_LOOP_READY")

func _process(_delta: float) -> void:
	if not _ticked:
		_ticked = true
		print("MCP_LOOP_TICK")

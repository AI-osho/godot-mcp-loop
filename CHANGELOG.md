# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-17

First private preview.

### Added
- Godot 4 editor addon with a localhost-only, token-authenticated WebSocket bridge (protocol v1).
- MCP server (stdio) with 22 tools:
  - status: `godot_status`, `project_info`
  - editing (undoable, `dry_run`, validated): `scene_open`, `scene_create`, `scene_save`, `scene_tree`,
    `node_add`, `node_delete`, `node_get`, `node_set`, `script_read`, `script_write` (compile-checked, diff),
    `script_attach`, `edit_undo` (only reverts MCP edits)
  - run & observe: `game_run`, `game_stop`, `game_query`, `game_input`, `game_wait_for`, `logs_read`, `screenshot`
  - judge: `scenario_run` (YAML/JSON scenarios with per-step report, failure screenshot, game errors)
- In-game runtime (`MCPLoopRuntime` autoload) over Godot's debugger channel; inactive in exported builds.
- Automatic continue on debugger breaks caused by script errors (opt out with `pause_on_error`).
- Platformer example with passing and intentionally failing scenarios.
- Tests: GDScript unit tests, TypeScript unit tests, end-to-end tests against a real headless editor and game; CI on Linux.

# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `game_set` / `game_call`: change state in the running game (members, array elements, dictionary keys; values
  converted to the existing type; all-or-nothing) and call methods (arguments converted to declared types,
  coroutines awaited). Scenario steps `set` and `call` do the same, so test setups no longer need extra scenes.
- Scenario `repeat: {times, steps}` (nestable, up to 10 000 expanded steps). Reported as one step; a failure names
  the iteration and inner step.
- Indexed property paths everywhere values are read (`items:3`, `items:-1`, `stats:hp`, `area:size:x`) with errors
  that explain the problem (index out of range with size, missing key with the available keys, unknown member).

### Performance
- The editor throttles its main loop to 100 ms per iteration while its window is in the background, and every bridge
  hop waited for an iteration: an editor call took ~100 ms and a game round trip ~300 ms. While requests are active
  (and for 30 s after), the addon now shortens the loop sleep to 5 ms, then restores the editor's own value.
  Measured: editor call 100 → 5 ms, game round trip 300 → 38 ms, for about +2 % CPU while active.

### Changed
- `game_input` `record` documentation: min/max are computed over every recorded frame; only the returned sample list
  is thinned to 50. In both re-trials the model raised `interval_ms` believing recording itself was capped at 50,
  which made the apex measurement slightly less precise.

## [0.2.1] - 2026-10-17

### Added
- `godot_status` reports `server_version` and a `warning` when the addon and the MCP server versions differ — found
  in the re-trial, where a stale server process kept running after an update and new tools silently looked missing.

## [0.2.0] - 2026-10-17

Fixes and additions from the first hands-on trial with Claude Code.

### Fixed
- The MCP server never reconnected after it had once found the editor not running: a synchronous
  session-file error left a failed connection attempt cached. It now reconnects as soon as the editor is back.
- Numbers sent as strings (`"2"`) made `game_wait_for` fail (`compares numbers only`). Value parameters now declare
  their JSON types, and the addon also accepts numeric/JSON strings in comparisons and property values.
- Scenario failure screenshots were labelled with a 0-based step number; they now match the 1-based summary.
- The not-running hint said Godot 4.4+; the addon needs 4.5+.

### Added
- Embedded resources: `{"new": "RectangleShape2D", "properties": {"size": [32, 48]}}` in `node_add` / `node_set`
  (any concrete `Resource` class except scripts, nesting allowed). `node_get` returns embedded resources in the same form.
- `game_input` `record` option: samples node properties every frame during the input sequence and returns
  min/max with timestamps, so brief states (the top of a jump) can be measured in one call.
- Scenario step results carry `target` (what was checked, e.g. `Player.position:y >= 370`), and the summary shows it
  with the observed value.
- One-time checks (`timeout_ms: 0`, scenario `assert`) fail with `ASSERTION_FAILED` and the actual value instead of
  `TIMEOUT ... within 0 ms`.

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

# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

Improvements from the vertical-shooter generation trial.

### Added
- Frame-based input timing: `hold_frames` / `wait_frames` count physics frames, so tests of logic in
  `_physics_process` don't depend on wall-clock time (a momentary stall made a "hold 2.5 s" test fail once).
- Inline `set` / `call` / `assert` / `wait_for` steps inside `game_input` (and scenario `input`): they run inside the
  game between inputs with no time passing; a failing step aborts the sequence and releases held input.
- `record.expect`: checks on the recording summary (`{property, stat: min|max|first|last|min_at_ms|max_at_ms, op, value}`),
  failing with `ASSERTION_FAILED` and the actual value. Scenario `input` accepts `{steps, record}`.
- Relative waits: `op: changed | increased | decreased` compare with the value seen when waiting starts.
- `image_write` `mirror: x | y | xy` (with `mirror_overlap`) completes symmetric sprites from a half or quarter.

### Fixed
- `input_action_set` stored events for "keyboard only" (device 16); they now match all devices (-1) like actions
  made in the editor.
- The first `image_write` into a new folder logged "Can't find file … during file reimport" in the editor.

## [0.3.0] - 2026-10-17

Tool improvements from the Tetris generation trial (Claude Code built a full Tetris; these remove the friction it reported).

### Added
- `game_set` / `game_call`: change state in the running game (members, array elements, dictionary keys; values
  converted to the existing type; all-or-nothing) and call methods (arguments converted to declared types,
  coroutines awaited). Scenario steps `set` and `call` do the same, so test setups no longer need extra scenes.
- Scenario `repeat: {times, steps}` (nestable, up to 10 000 expanded steps). Reported as one step; a failure names
  the iteration and inner step.
- `script_edit`: partial edits by exact text replacement (unique match or `replace_all`, applied in order),
  compile-checked and undoable like `script_write`. In the trial the model bypassed the editor for small fixes because
  every change needed the whole file.
- `image_write`: pixel-art PNGs from text (palette of single characters + rows; frames become a horizontal sprite
  sheet; nearest-neighbour scaling), imported immediately so they can be used as textures; undoable.
- `file_write`: text files (.yaml/.yml/.json/.md/.txt/.csv) by whole content or exact edits; YAML syntax is checked
  before writing, scenario files are validated (warnings), JSON must parse; undoable.
- `input_action_set`: add, replace or remove input actions (keys by physical position, mouse and joypad buttons) in
  project.godot; undoable.
- `game_input` `record.mode: "changes"` keeps samples only when a value changes.
- Indexed property paths everywhere values are read (`items:3`, `items:-1`, `stats:hp`, `area:size:x`) with errors
  that explain the problem (index out of range with size, missing key with the available keys, unknown member).

### Changed
- `scenario_run` returns only the summary by default (each step with what it checked and the observed value or query
  result, the first game errors, screenshot labels); `report: "full"` adds the JSON report.
- `project_info` hides Godot's ~90 built-in `ui_*` input actions unless `include_builtin_actions` is set.
- `script_write` returns a one-line summary for new files instead of a diff of every line; diffs are capped at 300 lines.

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

# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `scenario_run` `movie.from_step` / `movie.to_step`: keep only that section of the recording in the GIF, contact
  sheet and `frames/`. The whole run is still recorded and the server cuts the frames afterwards; contact labels keep
  the time from the start of the recording.
- `project_setting_set`: change the main scene, viewport and window size, stretch mode/aspect, project name or
  `max_fps` from a fixed list of keys (other keys are refused). Undoable; the editor window and a running game apply
  them when they start.
- `game_input` accepts `pause_at_end: true`: the game is left paused when the sequence finishes, so the next call
  reads the state the input produced instead of a later one (the game keeps running between calls).
- `script_write` / `script_edit` report the `class_name` they registered and wait until the editor's global class
  list contains it, so a script that uses a type written moments earlier compiles right away.

### Fixed
- A script that used a `class_name` declared by a just-written script failed with "Could not find type" until the
  editor was restarted. The tools now scan and wait for the class; when that does not help, the parse error hints at
  restarting the editor.
- An argument a tool does not declare (for example `method` on `game_query`) is rejected with `Unrecognized key`
  instead of being silently dropped.
- `game_step` reports `stepped_frames`, and the reference says `physics_frame` is the engine's total counter — it
  keeps increasing while the game is paused, so it is not the number of frames stepped.

## [0.7.0] - 2026-10-19

One registration for many projects, an agent that can open and close the editor, Movie Maker recordings with a GIF
and a contact sheet, and the sample games' scenarios in CI (which found two runtime bugs fixed here).

### Added
- `project_connect` / `project_list`: one server registration for many projects (#12). Start the server with
  `--projects-root <folder>` (repeatable, or `GODOT_PROJECTS_ROOT`) and the agent can list the Godot projects below it
  (name, addon installed, editor running) and point the running server at another one; the following tool calls work
  on it. Targets must contain `project.godot` and resolve inside a root (symbolic links included, not `.godot/` or
  `.git/`). Without `--projects-root` nothing changes (`PROJECT_SWITCH_DISABLED`). `godot_status` shows
  `projects_roots`; the `GODOT_NOT_RUNNING` hint mentions switching when it is enabled. A connect still in flight for
  the previous project is discarded.
- `editor_launch` / `editor_quit`: the agent can open the Godot editor on the current project and close it again.
  Godot is the server's new `--godot <path>` / `GODOT_BIN`, else the first Godot 4.5+ on `PATH` or in the usual install
  folders (checked with `--version`). The editor starts detached with a fixed argument list (`[--headless] -e --path
  <project>`), no shell, output in `res://.godot/mcp_loop/editor.log`; the tool waits until the bridge answers and
  returns the `godot_status` fields. It refuses projects without the addon installed and enabled, and reports an
  editor that exits early with the end of its log. `editor_quit` closes only editors this server opened: stops the
  game, saves the open scenes (new bridge method `editor.quit`), waits for the process, SIGTERM after `timeout_ms`.
- `scenario_run` `movie`: records the run with Godot's Movie Maker (fixed frame rate) and saves `movie.gif` and
  `contact.png` — evenly spaced, labelled frames in one image, also returned to the agent so it can see the motion —
  with the evidence (`save_to`); `frames: true` keeps every frame. Options `fps`, `gif`, `gif_fps`, `max_width`,
  `contact_sheet`. The addon sets the Movie Maker settings only for that launch, the frames go to
  `res://.godot/mcp_loop/movie/`, and the game is asked to quit by itself at the end (`game.stop {graceful: true}`, new
  runtime command `quit`). GIF and PNG encoding are built in (no new dependencies). Needs a game window
  (`RENDERING_UNAVAILABLE` when the game runs headless).
- Test: every tool is listed in `docs/tools.md` and the three READMEs.
- CI job "samples": the 19 regression scenarios of the sample games (platformer, Falling Blocks, shooter, side-scroller,
  RPG) and two Movie Maker recordings run against a real editor with the games in a window (xvfb, software OpenGL);
  the screenshots, reports and GIFs are kept as the `sample-evidence` artifact for a visual check.
- Release automation: pushing tag `vX.Y.Z` runs `.github/workflows/release.yml` — checks that the tag, the package,
  the addon and the CHANGELOG agree, builds the addon zip, the npm tarball and `SHA256SUMS.txt`
  (`scripts/release-artifacts.sh`), creates the GitHub release with notes from the CHANGELOG, and stages exactly that
  tarball on npm with trusted publishing (no token); a maintainer approves it with 2FA. `docs/releasing.md`.

### Fixed
- `screenshot` with `target: "editor"` no longer hangs (30 s `TIMEOUT`) when the editor is idle in the background: in
  low-processor mode it draws only on changes, so the addon now requests a redraw (and forces one after 2 s).
- Commands sent to a running game no longer run in the middle of the game's own code. GDScript polls the debugger
  every few thousand executed lines, and the runtime agent handled requests right there, so e.g. a `game_call` that
  freed enemies could run inside the game's loop over those enemies ("previously freed" errors, found by the new CI
  job). Requests are now queued and handled at the next deferred-call flush, between callbacks.
- Recording a movie on a slow machine: `wait_for` timeouts count game time while recording (like waits and holds), a
  scenario's `wait_ms` waits in the game instead of in the server, and the editor's and server's safety timeouts get
  ten times more room — before, a game rendering slower than real time hit timeouts early.

## [0.6.0] - 2026-10-18

Agent workflow and distribution, from reviewing Claude-Code-Game-Studios and Coding-Solo/godot-mcp (#13–#16).

### Added
- Agent skill `.claude/skills/godot-mcp-loop` (Agent Skills format): the edit → run → observe → judge loop,
  deterministic checks, scenario patterns, test hooks and pixel art. Its YAML and JSON examples are validated
  against the real schemas in the test suite.
- `scripts/new-game.sh`: creates a new Godot project with the addon enabled, the agent skill, `AGENTS.md` /
  `CLAUDE.md`, a `scenarios/` folder and an initial commit; optionally registers the MCP server with Claude Code.
- `AGENTS.md` / `CLAUDE.md` for agents working on this repository.
- `scenario_run` `save_to`: keeps the evidence as files in a project folder — every screenshot as `NN-label.png`,
  `report.md` (summary and images) and `report.json`; a folder run gets one subfolder per scenario and `summary.md`.
  The folder gets a `.gdignore`; a re-run replaces only its own files; checked before the game starts (#13).
- `scripts/new-game.sh` adds `PROGRESS.md` and Claude Code project settings: a `SessionStart` hook prints
  `PROGRESS.md`, the last commits and uncommitted changes into the agent's context (startup, resume, `/clear`, after
  compaction; under Claude Code's 10,000 character limit), the godot-loop tools are allowed, destructive shell commands
  and reading the session token are denied. `qa/evidence/` is ignored by git (#14).
- `test_run`: runs the project's GUT or GdUnit4 unit tests in a separate headless Godot process started by the editor
  (its own executable, no shell, only the framework's runner script), with a timeout, and returns pass/fail counts,
  each failing test with its message and the log's error lines, parsed from the JUnit report. `path` (folder or test
  script), `test` (GUT), `framework` when both are installed. Error codes `TEST_FRAMEWORK_NOT_FOUND` and `BUSY` (#15).
- npm package with the addon and the agent skill bundled: `npx -y godot-mcp-loop@<version> --project <dir>` starts the
  server, and `npx godot-mcp-loop install-addon <dir> [--skill] [--force] [--no-enable]` copies the addon of the same
  version into a project and enables it in `project.godot` (keeps other plugins; refuses symbolic links; another
  version needs `--force`). `server/README.md` for the npm page (#16).

## [0.5.0] - 2026-10-18

Tool improvements from the RPG generation trial (#6–#9).

### Added
- `game_step` takes `press` / `release` / `tap` lists of actions, sent just before the first stepped frame like real
  input — the game sees them in that frame as `Input.is_action_just_pressed()` and as input events; `tap` lasts one
  frame. Scenario steps: `step: {frames, press?, release?, tap?}` (#6). (Godot counts a press made during a physics
  frame as "just pressed" only from the next frame, so the input is sent between frames.)
- Conditions can check a method's return value: `{node, method, args?, property?, op, value}` where `property` is a
  path inside the result (e.g. `summary().state`). Works in `game_wait_for`, scenario `wait_for` / `assert` and inline
  steps (#7).
- `scenario_run` runs a folder (`path` to a directory) or a list (`paths`) and returns one summary with the details of
  failures; `stop_on_failure` ends the batch early (#8).
- `record.per: "physics"` samples once per physics frame and adds the frame index (#9).
- `scenario_run` with a folder or list sends a progress notification after each scenario, so clients that reset their
  timeout on progress can run long batches.

### Changed
- Development dependencies: TypeScript 7 (emitted JavaScript identical to 5.9); `@types/node` on Node 22, the oldest
  line the test toolchain accepts (Node 20 is still tested in CI); CI actions updated (checkout 7, setup-node 7,
  cache 6), still pinned to commit SHAs.
- The RPG sample's movement scenario drives frame-exact moves with `step: {frames: 1, tap: [...]}` and checks
  `summary()` directly, instead of a `start_move()` test hook.

## [0.4.1] - 2026-10-18

### Added
- Fourth advanced sample: an NES-style RPG, "星剣のルカ" (`examples/rpg/`), generated by DeepSeek V4.1 Flash with an
  original story, cast and monsters — title, prologue, grid movement, NPC dialogue, random encounters, front-view
  battles, a boss and an ending; six scenarios. Four small fixes after review (hold to keep walking, three cosmetic
  overlaps).
- The falling-block puzzle sample is now `examples/blocks/` ("Falling Blocks"), named generically.
- `SECURITY.md` and Dependabot configuration (npm, GitHub Actions).
- The server package now ships its `LICENSE`.

### Security
- Godot literals given as strings are parsed only when they are a flat literal of the expected type. Godot's
  `str_to_var` constructs objects (`Object(...)`) while parsing, so such strings could create (and leak) objects and
  bypass the "no inline scripts" rule.
- The MCP server now refuses `.godot/` and `.git/` when reading project files (`scenario_run`, `file_write`
  validation), matching the addon; previously `res://.godot/mcp_loop/session.json` was readable through it.
- The `project_info` file listing no longer follows symbolic links (paths outside the project; endless recursion on
  a link loop).
- CI: actions pinned to commit SHAs, checkout without persisted credentials, job timeouts.

## [0.4.0] - 2026-10-18

Improvements from the vertical-shooter and side-scroller generation trials, and three advanced samples.

### Added
- Advanced samples in `examples/`: a falling-block puzzle, a vertical shooter and a side-scroller, each generated end to end by an AI
  agent through godot-mcp-loop (Claude Opus 5.5 and DeepSeek V4.1 Flash) and verified independently.
- Frame-based input timing: `hold_frames` / `wait_frames` count physics frames, so tests of logic in
  `_physics_process` don't depend on wall-clock time (a momentary stall made a "hold 2.5 s" test fail once).
- Inline `set` / `call` / `assert` / `wait_for` steps inside `game_input` (and scenario `input`): they run inside the
  game between inputs with no time passing; a failing step aborts the sequence and releases held input.
- `record.expect`: checks on the recording summary (`{property, stat: min|max|first|last|min_at_ms|max_at_ms, op, value}`),
  failing with `ASSERTION_FAILED` and the actual value. Scenario `input` accepts `{steps, record}`.
- Relative waits: `op: changed | increased | decreased` compare with the value seen when waiting starts.
- `image_write` `mirror: x | y | xy` (with `mirror_overlap`) completes symmetric sprites from a half or quarter.
- `game_pause` / `game_step` (and scenario `pause:` / `step:`): freeze the game while inspecting or setting it up across calls,
  then run exactly N physics frames — requested in both the shooter and the side-scroller trials.
- `tolerance` and `message` on `game_wait_for` / scenario `wait_for` / `assert`.
- `image_write` palette entries may be `null` or `"transparent"`; a flat `frames` list gets an error showing the expected shape.

### Fixed
- `input_action_set` stored events for "keyboard only" (device 16); they now match all devices (-1) like actions
  made in the editor.
- The first `image_write` into a new folder logged "Can't find file … during file reimport" in the editor.
- Responses containing control characters (e.g. colored log lines) timed out: Godot's `JSON.stringify` leaves them
  unescaped, which the server's JSON parser rejected. The server now escapes them and parses again; captured logs
  drop terminal color codes.

## [0.3.0] - 2026-10-17

Tool improvements from the falling-block puzzle generation trial (Claude Code built a complete game; these remove the friction it reported).

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

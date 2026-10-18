---
name: godot-mcp-loop
description: Build, play-test and verify Godot 4 games through the godot-loop MCP tools (edit, run, observe, judge with scenarios). Use when working on a Godot project with the godot-loop MCP server connected.
---

# Godot development with godot-mcp-loop

The godot-loop MCP server connects you to a running Godot 4 editor and to the game it launches. Use it to close the
loop on every change: **inspect → edit → run → observe → judge**. A change is not done until you have run the game
and checked the result with a query, a condition or a scenario.

## Start of a session

1. `godot_status` — connection, Godot/addon versions, edited scene, whether a game runs and its error count.
2. `project_info` — main scene, autoloads, input actions; `glob: "*.tscn"` lists scenes.
3. Read before you change: `scene_tree`, `node_get`, `script_read`.

If `godot_status` fails with `GODOT_NOT_RUNNING`, open the editor with `editor_launch` (`headless: true` when nobody
needs to see it; screenshots need a window) and close it with `editor_quit` when you are done. If it fails with
`GODOT_NOT_FOUND` or `ADDON_NOT_INSTALLED` / `ADDON_NOT_ENABLED`, ask the user — do not install or configure Godot
yourself.

Several games: when `godot_status` shows `projects_roots`, `project_list` lists the projects you may switch to and
`project_connect {path}` points every following tool call at another one (check that its result names the project
you meant before editing).

## Editing

| Do | With |
|---|---|
| Write or change GDScript | `script_write` (whole file) or `script_edit` (exact `old`→`new` replacements). Both compile first: on errors nothing is written and every error comes back with its line — fix and retry. |
| Build scenes | `scene_create`, `node_add` (type or instanced scene, initial `properties`), `node_set`, `script_attach`, then `scene_save`. |
| Pixel art | `image_write` — see [references/pixel-art.md](references/pixel-art.md). |
| Input actions | `input_action_set` (keys by physical position). Restart the game afterwards. |
| Data files, scenarios | `file_write` (`.yaml/.json/.md/.txt/.csv`; scenario YAML is validated). |
| Preview / revert | `dry_run: true` on any editing tool; `edit_undo` reverts your own MCP edits. |

Rules:
- Keep work inside the folder you were given (for example `res://games/<name>/`) and prefix input actions you add
  with the game's name (`rpg_confirm`, not `confirm`) so they don't collide with other games in the project.
- Don't change the project's main scene, autoloads or other games unless asked.
- `project.godot` can't be edited directly; set window scaling and texture filtering from the main scene's script
  (see the pixel-art reference).
- A running game keeps the old code. After script, scene or input-map changes, `game_run` with `restart: true`.

## Running and observing

- `game_run {scene: "res://.../main.tscn", restart: true}` waits until the in-game runtime connects.
- `game_query` reads live values (`properties: ["position:x", "score"]`, script variables included).
- `game_wait_for` instead of sleeping: `{node, property, op, value, timeout_ms}`; `timeout_ms: 0` is a one-shot
  assert. Ops: `== != > >= < <= contains`, and `changed / increased / decreased` (no value).
- `game_input` sends real input: `{action, hold_ms}` or `hold_frames`, `{action, press: true}` / `release: true`,
  `{key: "Space"}`, `{mouse_click: [x, y]}`, `{wait_ms}` / `{wait_frames}`.
- `logs_read {since}` after every run: script errors don't stop the game (it auto-continues), so they only show up
  here and in `godot_status.game.errors`.
- `screenshot` and **look at it** — overlapping text, wrong colors, clipped UI and missing glyphs (□) are only
  visible this way. Check small pixel-art screens closely.

## Deterministic checks

Wall-clock timing makes tests flaky. Prefer frame-exact tools — details and YAML in
[references/deterministic-testing.md](references/deterministic-testing.md):

- `game_pause` + `game_step {frames}`: every node gets exactly N `_physics_process` calls.
- `game_step {frames: 1, tap: [jump]}`: the press arrives in that frame, so `Input.is_action_just_pressed()` sees it.
  Pressing with `game_input` while paused does **not** count as a new press.
- `hold_frames` / `wait_frames` in `game_input` count physics frames.
- `record: {node, properties, per: "physics", expect: [...]}` captures brief states (the top of a jump) and checks
  min/max/first/last in the same call.
- Conditions can read a method's result: `{node: ".", method: "summary", property: "state", op: "==", value: "battle"}`.

## Make the game testable

Design for checks from the start (see [references/test-hooks.md](references/test-hooks.md)):
- Run game logic in `_physics_process` at the default 60 Hz, counting frames instead of reading the clock.
- Expose plain variables and small hook methods: `rng_seed`, `invincible`, `start_game()`, `start_at(...)`,
  `spawn_enemy(...)`, and a side-effect-free `summary()` returning a Dictionary of the important state.
- Seed every random generator from `rng_seed` so scenarios are reproducible.

## Judge with scenarios

Write regression scenarios as YAML files next to the game, numbered so a folder run keeps order:
`scenarios/1_title.yaml`, `2_movement.yaml`, ... Then `scenario_run {path: "res://.../scenarios"}` runs them all and
returns `Scenarios: N/M passed` with the details of failures. A scenario (re)starts the game, so it is independent of
earlier state. Patterns: [references/scenario-cookbook.md](references/scenario-cookbook.md).

- End each scenario with `assert_no_errors: true`.
- Use `set`/`call` steps to jump to the situation under test instead of playing up to it.
- Run the folder twice before reporting; a scenario that passes only sometimes is a bug in the game or the test.
- For the final run add `save_to: "res://qa/evidence/<name>"`: screenshots, `report.md` and `report.json` stay as files
  that a person can check later. Name the folder in your report.
- To see or show motion (animation, a jump arc, a boss pattern), add `movie: {}` to a single-scenario run with
  `save_to`: you get `contact.png` (12 labelled frames in one image, also returned to you — look at it) and
  `movie.gif` for the report or README. It needs a game window, not `--headless` in Main Run Args. If the frames look
  cut off at the top and bottom, the project's viewport size has another aspect ratio than the game picture
  (docs/scenarios.md, "Recording a movie").

Logic that has no screen (damage formulas, inventory rules, save data, level generation) is cheaper to check with unit
tests. If the project has GUT or GdUnit4 in `addons/`, write tests in `res://test/` and run them with
`test_run {path: "res://test"}` (GUT: `test: "test_jump"` runs matching tests only). It returns counts and every
failing test with its message. Don't install a test framework unless asked.

## Before you report done

- [ ] The game starts from the intended scene and `logs_read` shows no errors or warnings you introduced.
- [ ] Every requested behaviour is covered by a passing scenario (or a `game_wait_for` / `record` check), and
  `test_run` passes if the project has unit tests.
- [ ] Screenshots of each screen were looked at, not just taken.
- [ ] The scenario folder passes twice in a row; the last run saved its evidence with `save_to`.
- [ ] The report lists what was checked, with measured values, and anything not verified.

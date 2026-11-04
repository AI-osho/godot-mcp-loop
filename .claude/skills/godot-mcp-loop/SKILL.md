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

An `editor_launch` readiness timeout does not stop its editor. Do not blindly repeat startup: a live owned process
returns `BUSY`; check `godot_status` later or use `editor_quit`. Project switching is refused throughout launch,
including the final status reply. A `game_run` refusal saying main/current changed means recheck the selected scene
before retrying; it does not authorize running whichever scene replaced it during a wait.

Several games: when `godot_status` shows `projects_roots`, `project_list` lists the projects you may switch to and
`project_connect {path}` points every following tool call at another one (check that its result names the project
you meant before editing).

## Illustrated 2D artwork production (since 0.10.0)

Use this optional path when the work needs original illustration rather than a quick text-palette sprite.
`production_plan` -> `art_request` -> the client's existing authorized image producer -> `art_register` ->
`asset_build` -> `asset_preview` + `asset_verify` -> `asset_scene_add` -> `scene_save` -> ordinary runtime checks.

- `art_request` prepares an `openai-codex` / `gpt-image-2-medium` request with medium quality; it does not generate
  images, acquire credentials, switch providers or authorise high-quality fallback. If the client has no approved
  image producer, ask for real PNGs or a suitable authorized producer; never invent an image/response.
- Register the actual project-local PNG. Preserve requested versus reported quality/model and actual dimensions;
  omit reported values the producer did not supply rather than inferring them. Record a real raw response when
  available. `needs_revision` and `rejected` are not accepted artwork.
- `asset_build` accepts declarative crop/key/pose/icon/common-scale/copy/atlas recipes, never executable code.
  Inspect the original before choosing crop/foot/frame numbers. PNG tools need optional Python 3.11+ and Pillow
  13.0.0; brief/request records and existing editor tools do not. Nothing auto-installs dependencies.
- Require `asset_verify.passed == true`; a failed domain report is not necessarily `isError`. A preview is processed
  artwork, not a Godot screenshot. Check both before placing a frame/atlas with explicit position/scale/z order.
  Do not edit manifests or regenerate `manifest.sha256` to force acceptance; rebuild under a new ID. Code,
  dependency or recorded Python/Pillow environment changes invalidate old verification.
- Records/builds are append-only files under new project paths. Editor undo removes the placement group but does
  not delete source art or exports. `asset_scene_add` supports dry_run and one-step undo; save explicitly.
- Use ordinary `game_input` keys/actions and actual screenshots/logs to verify the result. `game_set`/`game_call`
  can prepare diagnostic states, but teleport/debug completion does not prove the normal gameplay route.
- Story, game rules, collisions and project-specific test routes stay in the project. Passing automation is not
  the user's acceptance of visual style, fun or sound. No automatic publication or sample-game changes.

The packaged runtime is under `authoring/`; full recipes and limitations are in the repository's
`docs/art-production.md` and `docs/art-production.ja.md`. They ship in 0.12.0 and were introduced in 0.10.0. Use
the same selected server/addon distribution and reconnect existing clients explicitly when needed.

## Editing

For a new ordinary empty Node2D/Control scene, `node_add_tree` (since 0.12.0) can add one complete native
subtree. Version 0.12.0 has 49 tools; previous 0.11.0 has 48. Use the same selected server/addon distribution, not a floating npm
command. Create/open the explicit empty target first, preview, apply, and save with `scene_save` separately.

```json tool=node_add_tree
{
  "schema_version": 1,
  "scene": "res://scenes/new_ui.tscn",
  "dry_run": true,
  "nodes": [
    {"id":"ui","type":"Control","name":"UI"},
    {"id":"title","parent_id":"ui","type":"Label","name":"Title","properties":{"text":"拠点を守ろう","offset_left":24,"offset_top":24,"offset_right":320,"offset_bottom":56}},
    {"id":"start","parent_id":"ui","type":"Button","name":"Start","properties":{"text":"開始","offset_left":24,"offset_top":80,"offset_right":200,"offset_bottom":126}}
  ]
}
```

- One parent-first top (Node2D/Control); only supported native types/properties. At most 64 nodes, depth 8,
  32 properties/node and 512 total including embedded resources. Use literal finite JSON values, not numeric strings.
- Only bounded imported PNG references and new RectangleShape2D/CircleShape2D/CapsuleShape2D/StyleBoxFlat resources;
  no scripts, custom classes, scene instances, arbitrary resources or existing children. No automatic import repair.
- Preview leaves the scene/history unchanged. Apply is one undo action with all descendant owners set; saving is
  separate. A later human edit prevents MCP undo. Native redo does not become a new public tool.
- `structuredContent.applied=false`/`created_count=0` means a known refusal. Null means a dispatched result is
  uncertain: inspect `scene_tree` and history before retrying. Timeout/disconnect is never automatic-retry permission.
- Inspect actual runtime UI/screenshots/input. Detached preview does not certify final Container/theme layout.
  Full property policy and bounds are in the source `docs/scene-tree-build.md` / `docs/scene-tree-build.ja.md`.

| Do | With |
|---|---|
| Write or change GDScript | `script_write` (whole file) or `script_edit` (exact `old`→`new` replacements). Both compile first: on errors nothing is written and every error comes back with its line — fix and retry. |
| Build scenes | `scene_create`, `node_add` (type or instanced scene, initial `properties`), `node_set`, `script_attach`, then `scene_save`. |
| Pixel art | `image_write` — see [references/pixel-art.md](references/pixel-art.md). |
| Input actions | `input_action_set` (keys by physical position). Restart the game afterwards. |
| Data files, scenarios | `file_write` (`.yaml/.json/.md/.txt/.csv`; scenario YAML is validated). |
| Preview / revert | `dry_run: true` on any editing tool; `edit_undo` reverts your own MCP edits. |

Rules:
- Trust project code before loading/running it. `dry_run` skips the planned edit, not constructors or callbacks.
- A refused `edit_undo` after a path became linked does not consume the action; restore a safe path before retrying.
- A file I/O undo failure retains its recovery record. Check `undone`, `stopped_reason` and `error` for partial multi-step
  progress; repair the filesystem before retrying. PNG/sidecar removal is not atomic. Native GUI history movement alone
  is not an I/O receipt; a failed native redo needs editor undo/redo realignment. If an error says disk changed without
  confirmed history registration, inspect it rather than blindly replaying the write.
- Native `Node.scene_file_path` / `Resource.resource_path` identities are not generic properties to edit. Indexed Resource
  previews use copies; Script/non-Resource Object reference edits are refused. Use dedicated scene/script tools.
- Native play/save-all checks all open scene destinations, including inactive ones. Repair a refused save path;
  `editor_quit` does not discard unsaved work by force-killing an editor on a save refusal.
- Keep work inside the folder you were given (for example `res://games/<name>/`) and prefix input actions you add
  with the game's name (`rpg_confirm`, not `confirm`) so they don't collide with other games in the project.
- Don't change the project's main scene, autoloads or other games unless asked.
- `project.godot` can't be edited directly; set window scaling and texture filtering from the main scene's script
  (see the pixel-art reference).
- A running game keeps the old code. After script, scene or input-map changes, `game_run` with `restart: true`.

## Running and observing

- `game_run {scene: "res://.../main.tscn", restart: true}` waits until the in-game runtime connects.
- Godot launch/export/test arguments must remain literal: `%20`, edge whitespace/control characters and option-like
  export presets are refused, not rewritten. Ordinary Unicode names and interior spaces work.
- `game_query` reads live values (`properties: ["position:x", "score"]`, script variables included).
- `game_wait_for` instead of sleeping: `{node, property, op, value, timeout_ms}`; `timeout_ms: 0` is a one-shot
  assert. Ops: `== != > >= < <= contains`, and `changed / increased / decreased` (no value).
- `game_input` sends real input: `{action, hold_ms}` or `hold_frames`, `{action, press: true}` / `release: true`,
  `{key: "Space"}`, `{mouse_click: [x, y]}`, `{wait_ms}` / `{wait_frames}`. Add `pause_at_end: true` when the next
  call should measure what the input left behind — otherwise the game keeps running between the two calls.
- `logs_read {since}` after every run: script errors don't stop the game (it auto-continues), so they only show up
  here and in `godot_status.game.errors`.
- `screenshot` and **look at it** — overlapping text, wrong colors, clipped UI and missing glyphs (□) are only
  visible this way. Check small pixel-art screens closely.
- 3D checks without a picture: `game_in_view {node}` (behind the camera? where on screen), `game_ray {from, to}`
  (world axes — a child `RayCast3D` rotates with its body), `game_contacts {node}` (a RigidBody3D's contact points;
  needs `contact_monitor`), `game_ui_audit` (HUD layout problems).

## Deterministic checks

Wall-clock timing makes tests flaky. Prefer frame-exact tools — details and YAML in
[references/deterministic-testing.md](references/deterministic-testing.md):

- `game_pause` + `game_step {frames}`: every node gets exactly N `_physics_process` calls.
- `game_step {frames: 1, tap: [jump]}`: the press arrives in that frame, so `Input.is_action_just_pressed()` sees it.
  Pressing with `game_input` while paused does **not** count as a new press.
- `hold_frames` / `wait_frames` in `game_input` count physics frames.
- The game keeps running between tool calls. To read the state that an input left behind, finish the call with
  `pause_at_end: true` (or use `game_pause` + `game_step` from a paused game).
- `record: {node, properties, per: "physics", expect: [...]}` captures brief states (the top of a jump) and checks
  min/max/first/last in the same call.
- `match_screenshot: {baseline: "res://qa/baselines/x.png"}` compares the screen with a PNG in the project (written on
  the first run; `update: true` to accept a new look) and attaches a red diff image when it differs — use it for
  screens that must not change.
- Conditions can read a method's result: `{node: ".", method: "summary", property: "state", op: "==", value: "battle"}`.
  Use pure observation methods: `game_wait_for` can mutate state through a method and is not a read-only sandbox.
- Action presses in `game_input` and `game_step` remain held across application focus changes; explicitly release them
  when finished. Taps and timed holds release automatically. Physical key/mouse events are not persistent actions.
- 3D values are JSON: `transform` reads as `{origin, basis: {x, y, z}}`, and `transform:origin:y`, `aabb:size:z`,
  `plane:normal:y` work in queries, sets and conditions. `record: {node, method, properties}` samples a method's
  return value (e.g. `{node: ".", method: "summary", properties: ["ball_pos:2"]}`).

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
failing test with its message. A valid successful-looking report does not pass when the child exits nonzero; check
the summary's process exit code as well as test counts. Don't install a test framework unless asked.

## Before you report done

- [ ] The game starts from the intended scene and `logs_read` shows no errors or warnings you introduced.
- [ ] Every requested behaviour is covered by a passing scenario (or a `game_wait_for` / `record` check), and
  `test_run` passes if the project has unit tests.
- [ ] Screenshots of each screen were looked at, not just taken.
- [ ] The scenario folder passes twice in a row; the last run saved its evidence with `save_to`.
- [ ] The report lists what was checked, with measured values, and anything not verified.

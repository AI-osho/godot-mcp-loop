# Tools reference

35 tools, grouped by what they do in the loop: **inspect → edit → run → observe → judge**.

Conventions

- **Editor node paths** are relative to the edited scene's root; `.` is the root (`Player/Sprite2D`).
- **Game node paths** are relative to the running scene (`Player`) or absolute (`/root/Main/Player`).
- **Values** are JSON: `Vector2/3` as `[x, y(, z)]` or `{x, y}`; `Color` as `"#rrggbb"`, `"#rrggbbaa"`, `"red"` or `[r, g, b, a]`;
  `Rect2` as `[x, y, w, h]`; resources as `{"res": "res://path"}` for a file, or `{"new": "RectangleShape2D", "properties": {"size": [32, 48]}}`
  to create an embedded resource (shapes, materials, styles — any concrete `Resource` class except scripts; nested
  `new` works); `null` clears. Reading an embedded resource returns the same `new` form with its non-default
  properties, so it can be copied. Values sent as strings (`"120"`, `"[10, 20]"`) are decoded to the property's type. Indexed sub-properties use Godot's
  syntax: `"position:x"`.
- Every editing tool accepts `dry_run: true` to validate and preview without changing anything.
- Errors come back as `Error <CODE>: <message>` plus a `Hint:` line the agent can act on (codes in [protocol.md](protocol.md)).

## Status & project

| Tool | Purpose |
|---|---|
| `godot_status` | Connection, Godot version, project, edited scene, whether the game is running, game error count. Call first. |
| `project_info` | Name, main scene, autoloads, input actions (built-in `ui_*` hidden unless `include_builtin_actions`); `glob` (e.g. `*.tscn`) lists matching files. |
| `project_list` | Godot projects the server may switch to: folders with `project.godot` up to 3 levels below each `--projects-root` (hidden folders, `node_modules`, `addons` and symbolic links skipped), with `name`, `addon_installed`, `editor_running` and `current`. |
| `project_connect` | Point the running server at another project (`path`: absolute, `~/…`, or relative to a projects root) — one MCP registration for many games. Allowed only below `--projects-root` folders (resolved through symbolic links, never inside `.godot/` or `.git/`); without `--projects-root` it fails with `PROJECT_SWITCH_DISABLED`. Returns the new project's `godot_status` fields, or `editor_running: false` with how to open it. The previous editor and game keep running. |

### Several projects with one server

By default the server stays on its `--project`. Start it with `--projects-root <folder>` (repeatable, or
`GODOT_PROJECTS_ROOT` with the system path separator) to let the agent switch:

```bash
npx -y godot-mcp-loop@<version> --project ~/games/shooter --projects-root ~/games
```

Then `project_list` → `project_connect {"path": "rpg"}` → the following tools work on `~/games/rpg`. `godot_status`
reports `project_path` and `projects_roots`. When the project's editor isn't open, tools fail with `GODOT_NOT_RUNNING`
until it is.

## Editor

| Tool | Purpose |
|---|---|
| `editor_launch` | Open the Godot editor on the current project and wait (default 120 s, `timeout_ms`) until the MCP Loop bridge answers; returns the `godot_status` fields plus `pid`, `godot_path` and `log` (the editor's output, `res://.godot/mcp_loop/editor.log`). Nothing happens when an editor already runs for the project (`already_running: true`). `headless: true` opens it without a window (no screenshots — for servers and CI). Godot is the server's `--godot` / `GODOT_BIN` if set, else the first Godot 4.5+ on `PATH` (`godot`, `godot4`, `Godot`) or in the usual install folders (`/Applications/Godot.app`, `/usr/bin/godot`, …). The project needs the addon installed and enabled (`ADDON_NOT_INSTALLED` / `ADDON_NOT_ENABLED` otherwise — `npx godot-mcp-loop install-addon <dir>` does both). The editor keeps running when the server stops. Errors: `GODOT_NOT_FOUND`, `EDITOR_EXITED` (with the end of the log), `TIMEOUT` (the editor keeps starting). |
| `editor_quit` | Close the editor of the current project — only one this server opened with `editor_launch`; any other is refused with `EDITOR_NOT_LAUNCHED`. Stops a running game, saves the open scenes (`save: false` skips that), quits, and waits for the process to end (`timeout_ms`, default 20 s, then SIGTERM; `killed: true` in the result). |

## Scenes & nodes (all undoable)

| Tool | Purpose |
|---|---|
| `scene_open` | Open a `.tscn` and make it the edited scene. |
| `scene_create` | New scene with a root node of `root_type`; refuses to overwrite. |
| `scene_save` | Save the edited scene. |
| `scene_tree` | Hierarchy with class, path, script, instanced scene (`depth` limit). |
| `node_add` | Add by `type` (engine class or `class_name`) or instance a `scene`; optional initial `properties` validated up front. |
| `node_delete` | Delete a node subtree (root is protected). Undo restores it exactly, including owners. |
| `node_get` | Properties of a node — by default only non-default values plus script variables. |
| `node_set` | Set several properties as one undo step; returns `before`/`after`. Nothing changes if any value is invalid. |

## Scripts

| Tool | Purpose |
|---|---|
| `script_read` | Read a text file in the project. |
| `script_write` | Write a `.gd` file. **Compiled first**; on errors nothing is written and every error is returned with its line. Returns a unified diff. A `class_name` declared here is added to the editor's global class list before the call returns (`class_name` in the result). Undoable. |
| `script_edit` | Partial edit of an existing `.gd` by exact text replacement (`edits: [{old, new, replace_all?}]`, applied in order; `old` must match once unless `replace_all`). Compiled first like `script_write`; returns a diff. A new `class_name` is registered like in `script_write`. |
| `script_attach` | Attach/detach a script on a node (checks the script's base class fits). |

## Files & assets (all undoable)

| Tool | What it does |
|---|---|
| `file_write` | Text files `.yaml/.yml/.json/.md/.txt/.csv` by `content` or `edits`. YAML syntax is checked before writing; a YAML file with `steps` is validated as a scenario (warnings); JSON must parse. Not for `.gd`, `.tscn`, `.cfg`, `.tres`, or anything under `addons/` / `.godot/`. |
| `image_write` | Pixel-art PNG from text: `palette` (single character → color) and `rows`, or `frames` for a horizontal sprite sheet; `scale` uses nearest neighbour; `mirror: x / y / xy` (+ `mirror_overlap`) completes symmetric sprites from a half or quarter. A palette entry of `null` or `"transparent"` is see-through. Imported immediately — use `{"res": path}` as a `Sprite2D` texture, `texture_filter: 1` (Nearest) for crisp pixels, `hframes`/`frame` to animate. |
| `input_action_set` | Add/replace an input action in project.godot (`keys` by physical position, `mouse_buttons`, `joypad_buttons`, `deadzone`) or `remove: true`. Restart the game to apply. |

## Undo

| Tool | Purpose |
|---|---|
| `edit_undo` | Undo the latest `steps` actions **made through MCP**, newest first. Stops if a human made a later edit in the same history, so it never reverts your own work. |

## Run & observe

| Tool | Purpose |
|---|---|
| `game_run` | Launch `main`, `current`, or a scene path; waits until the in-game runtime connects. `restart`, `pause_on_error`. |
| `game_stop` | Stop the game. Game logs remain readable. |
| `game_query` | Live values from the running game (`properties`), or an overview incl. script variables and children. |
| `game_input` | Ordered input steps with real timing: `{action, hold_ms}`, `{action, press}`/`{action, release}`, `{key}`, `{mouse_move}`, `{mouse_click}`, `{wait_ms}`. Unknown actions/keys are rejected before anything runs. `hold_frames` / `wait_frames` count physics frames (deterministic for logic in `_physics_process`). Inline steps `{set}`, `{call}`, `{assert}`, `{wait_for}` run inside the game between inputs with no time passing; a failing one aborts and releases held input. Optional `record: {node, properties, interval_ms?, mode?, per?, expect?}` samples the properties every frame while the steps run (`per: "physics"` samples once per physics frame and adds the frame index — use it for fixed-step logic) and returns `summary` (`min`, `max`, `min_at_ms`, `max_at_ms`, `first`, `last`) computed over every recorded frame (up to 3000), plus `samples_total` and an evenly thinned list of at most 50 samples — keep `interval_ms` at 0 for exact min/max — use it for brief states such as the top of a jump (add a final `{wait_ms}` to keep recording after the input). `pause_at_end: true` leaves the game paused when the sequence finishes, so the next call measures what the input left behind (otherwise the game keeps running between calls). |
| `game_wait_for` | Wait until `node.property <op> value` (`== != > >= < <= contains`), checked every frame. With `method` (and optional `args`) the method's return value is checked instead, and `property` becomes a path inside it — e.g. `{node: ".", method: "summary", property: "state", op: "==", value: "battle"}`; the method runs on every check, so it should only read state. `timeout_ms: 0` = one-shot assertion (`ASSERTION_FAILED` with the actual value). `op: changed / increased / decreased` waits for a change from the value seen when waiting starts. `tolerance` widens numeric comparisons (default 0.0001); `message` is prefixed to a failure. On timeout returns the last observed value. |
| `game_set` | Change live state: `{properties: {"score": 300, "position:x": 40, "items:2": 5}}`. Paths may address members, array elements and dictionary keys; values are converted to the existing type; all-or-nothing; returns before/after. |
| `game_pause` | `paused: true/false`. While paused, game nodes don't run but `game_query` / `game_set` / `game_call` / `game_wait_for` still work, so a situation can be inspected and set up across calls without time passing. |
| `game_step` | Run exactly `frames` physics frames, then stay paused. Every pausable node gets the same N `_physics_process` calls, independent of call latency. Actions held with `press: true` stay held. `press` / `release` / `tap` (lists of actions) are sent just before the first stepped frame, like real input, so the game sees them in that frame as `Input.is_action_just_pressed()` and as input events (`_unhandled_input`); `tap` is released after the first frame (a one-frame step works). Input sent with `game_input` while paused can't do this — the press belongs to an earlier frame. |
| `game_call` | Call a method on a game node (e.g. a test hook `restart()` or `spawn_wave(3)`); arguments converted to the declared types; coroutines awaited; returns the result. |
| `logs_read` | `print` output, errors and warnings with file/line/stack. `source: game` (default) or `editor`; use `since: <next>` to read incrementally. |
| `screenshot` | PNG of the running game (`target: game`) or the editor viewport (`target: editor`). Unavailable when headless. |

## Judge

| Tool | Purpose |
|---|---|
| `scenario_run` | Run a YAML/JSON play-test file or inline scenario (`movie` records it as `movie.gif` + `contact.png`, [details](scenarios.md#recording-a-movie)); returns a pass/fail report with per-step timing, the failing value, game errors, and screenshots. `path` may be a folder (every `.yaml`/`.yml`/`.json` in it, name order) and `paths` a list; both return one summary (`Scenarios: 5/6 passed`) with details of failures, and attach only failure screenshots by default. `stop_on_failure` stops the batch early. `save_to` keeps the screenshots, `report.md` and `report.json` as files in a project folder ([evidence](scenarios.md#keeping-evidence)). See [scenarios.md](scenarios.md). |
| `test_run` | Run the project's unit tests with [GUT](https://github.com/bitwes/Gut) or [GdUnit4](https://github.com/MikeSchulze/gdUnit4) (whichever is installed under `addons/`; `framework` picks one when both are) in a separate headless Godot process started by the editor. Returns `Tests (GUT, res://test): FAILED — 11/13 passed, 1 failed, 1 skipped`, each failing test with its message, and error lines from the log; `report: "full"` adds every test's status as JSON. `path` is a test folder or one test script (default `res://test` or `res://tests`; GUT uses `.gutconfig.json` when there is one), `test` (GUT only) runs the tests whose name contains the text, `timeout_ms` (default 120000) stops the run. Failing tests are a normal result, not a tool error. Use it for game logic; `scenario_run` for play. |

## Script errors in the running game

By default Godot's debugger pauses a game on a script error, which would freeze an automated loop. The addon records
the break in the game log and immediately continues, so the agent sees the error in `logs_read` /
`godot_status.game.errors` and the game stays responsive. Pass `game_run(pause_on_error=true)` to keep Godot's default.

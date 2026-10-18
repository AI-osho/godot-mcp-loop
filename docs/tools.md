# Tools reference

28 tools, grouped by what they do in the loop: **inspect → edit → run → observe → judge**.

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
| `script_write` | Write a `.gd` file. **Compiled first**; on errors nothing is written and every error is returned with its line. Returns a unified diff. Undoable. |
| `script_edit` | Partial edit of an existing `.gd` by exact text replacement (`edits: [{old, new, replace_all?}]`, applied in order; `old` must match once unless `replace_all`). Compiled first like `script_write`; returns a diff. |
| `script_attach` | Attach/detach a script on a node (checks the script's base class fits). |

## Files & assets (all undoable)

| Tool | What it does |
|---|---|
| `file_write` | Text files `.yaml/.yml/.json/.md/.txt/.csv` by `content` or `edits`. YAML syntax is checked before writing; a YAML file with `steps` is validated as a scenario (warnings); JSON must parse. Not for `.gd`, `.tscn`, `.cfg`, `.tres`, or anything under `addons/` / `.godot/`. |
| `image_write` | Pixel-art PNG from text: `palette` (single character → color) and `rows`, or `frames` for a horizontal sprite sheet; `scale` uses nearest neighbour; `mirror: x / y / xy` (+ `mirror_overlap`) completes symmetric sprites from a half or quarter. Imported immediately — use `{"res": path}` as a `Sprite2D` texture, `texture_filter: 1` (Nearest) for crisp pixels, `hframes`/`frame` to animate. |
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
| `game_input` | Ordered input steps with real timing: `{action, hold_ms}`, `{action, press}`/`{action, release}`, `{key}`, `{mouse_move}`, `{mouse_click}`, `{wait_ms}`. Unknown actions/keys are rejected before anything runs. `hold_frames` / `wait_frames` count physics frames (deterministic for logic in `_physics_process`). Inline steps `{set}`, `{call}`, `{assert}`, `{wait_for}` run inside the game between inputs with no time passing; a failing one aborts and releases held input. Optional `record: {node, properties, interval_ms?, mode?, expect?}` samples the properties every frame while the steps run and returns `summary` (`min`, `max`, `min_at_ms`, `max_at_ms`, `first`, `last`) computed over every recorded frame (up to 3000), plus `samples_total` and an evenly thinned list of at most 50 samples — keep `interval_ms` at 0 for exact min/max — use it for brief states such as the top of a jump (add a final `{wait_ms}` to keep recording after the input). |
| `game_wait_for` | Wait until `node.property <op> value` (`== != > >= < <= contains`), checked every frame. `timeout_ms: 0` = one-shot assertion (`ASSERTION_FAILED` with the actual value). `op: changed / increased / decreased` waits for a change from the value seen when waiting starts. On timeout returns the last observed value. |
| `game_set` | Change live state: `{properties: {"score": 300, "position:x": 40, "items:2": 5}}`. Paths may address members, array elements and dictionary keys; values are converted to the existing type; all-or-nothing; returns before/after. |
| `game_call` | Call a method on a game node (e.g. a test hook `restart()` or `spawn_wave(3)`); arguments converted to the declared types; coroutines awaited; returns the result. |
| `logs_read` | `print` output, errors and warnings with file/line/stack. `source: game` (default) or `editor`; use `since: <next>` to read incrementally. |
| `screenshot` | PNG of the running game (`target: game`) or the editor viewport (`target: editor`). Unavailable when headless. |

## Judge

| Tool | Purpose |
|---|---|
| `scenario_run` | Run a YAML/JSON play-test file or inline scenario; returns a pass/fail report with per-step timing, the failing value, game errors, and screenshots. See [scenarios.md](scenarios.md). |

## Script errors in the running game

By default Godot's debugger pauses a game on a script error, which would freeze an automated loop. The addon records
the break in the game log and immediately continues, so the agent sees the error in `logs_read` /
`godot_status.game.errors` and the game stays responsive. Pass `game_run(pause_on_error=true)` to keep Godot's default.

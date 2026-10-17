# Tools reference

22 tools, grouped by what they do in the loop: **inspect → edit → run → observe → judge**.

Conventions

- **Editor node paths** are relative to the edited scene's root; `.` is the root (`Player/Sprite2D`).
- **Game node paths** are relative to the running scene (`Player`) or absolute (`/root/Main/Player`).
- **Values** are JSON: `Vector2/3` as `[x, y(, z)]` or `{x, y}`; `Color` as `"#rrggbb"`, `"#rrggbbaa"`, `"red"` or `[r, g, b, a]`;
  `Rect2` as `[x, y, w, h]`; resources as `{"res": "res://path"}` (`null` clears). Indexed sub-properties use Godot's
  syntax: `"position:x"`.
- Every editing tool accepts `dry_run: true` to validate and preview without changing anything.
- Errors come back as `Error <CODE>: <message>` plus a `Hint:` line the agent can act on (codes in [protocol.md](protocol.md)).

## Status & project

| Tool | Purpose |
|---|---|
| `godot_status` | Connection, Godot version, project, edited scene, whether the game is running, game error count. Call first. |
| `project_info` | Name, main scene, autoloads, input actions; `glob` (e.g. `*.tscn`) lists matching files. |

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
| `script_attach` | Attach/detach a script on a node (checks the script's base class fits). |

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
| `game_input` | Ordered input steps with real timing: `{action, hold_ms}`, `{action, press}`/`{action, release}`, `{key}`, `{mouse_move}`, `{mouse_click}`, `{wait_ms}`. Unknown actions/keys are rejected before anything runs. |
| `game_wait_for` | Wait until `node.property <op> value` (`== != > >= < <= contains`), checked every frame. `timeout_ms: 0` = one-shot assertion. On timeout returns the last observed value. |
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

# Tools reference

48 tools, grouped by what they do in the loop: **plan → produce → inspect → edit → run → observe → judge**.

Conventions

- **Editor node paths** are relative to the edited scene's root; `.` is the root (`Player/Sprite2D`).
- **Game node paths** are relative to the running scene (`Player`) or absolute (`/root/Main/Player`).
- **Values** are JSON: `Vector2/3` as `[x, y(, z)]` or `{x, y}`; `Color` as `"#rrggbb"`, `"#rrggbbaa"`, `"red"` or `[r, g, b, a]`;
  `Rect2` as `[x, y, w, h]`; resources as `{"res": "res://path"}` for a file, or `{"new": "RectangleShape2D", "properties": {"size": [32, 48]}}`
  to create an embedded resource (shapes, materials, styles — any concrete `Resource` class except scripts; nested
  `new` works); `null` clears. Reading an embedded resource returns the same `new` form with its non-default
  properties, so it can be copied. Values sent as strings (`"120"`, `"[10, 20]"`) are decoded to the property's type. Indexed sub-properties use Godot's
  syntax: `"position:x"`. Indexed Resource previews use copies; indexed Script/non-Resource Object references are
  refused. `scene_file_path` and Resource `resource_path` identities are managed by dedicated scene/resource tools,
  not generic property writes.
- **3D values** read and write as: `Transform3D` `{"origin": [x, y, z], "basis": {"x": [...], "y": [...], "z": [...]}}`
  (the basis vectors are the columns; 9 numbers in that order work too), `Basis` `{"x": [...], "y": [...], "z": [...]}`,
  `Quaternion` `[x, y, z, w]`, `AABB` `{"position": [x, y, z], "size": [x, y, z]}` (or 6 numbers), `Plane`
  `{"normal": [x, y, z], "d": 0.0}` (or 4 numbers). Sub-properties reach inside them:
  `"transform:origin:y"`, `"transform:basis:x"`, `"aabb:size:z"`, `"plane:normal:y"`.
- Editing tools accept `dry_run: true` to preview the planned edit without applying it. Validation/loading can still
  invoke project constructors or callbacks; `dry_run` is not a no-code-execution sandbox (see [security.md](security.md)).
- Arguments a tool does not declare are rejected (`Unrecognized key: ...`), so a typo or a field that belongs to
  another tool fails loudly instead of being ignored.
- Errors come back as `Error <CODE>: <message>` plus a `Hint:` line the agent can act on (codes in [protocol.md](protocol.md)).

## Artwork production (development-source addition)

These are optional 2D production tools. They do not execute an image API or acquire credentials. The client's
existing authorized image producer performs generation; requested and reported quality remain separate.
PNG tools need Python 3.11+ / Pillow 13.0.0. Brief/request records and existing tools do not.

| Tool | What it does |
|---|---|
| `production_plan` | New strict production brief: goal, controls, art direction, scenes and assets. `path`, `brief`, optional `dry_run`. |
| `art_request` | `plan`, `asset_id`, new `path`, optional `size`, `correction`, `dry_run`; prepares a GPT Image 2 medium request, status `awaiting_external_image`. No generation. |
| `art_register` | `request`, actual `png`, new `path`, `decision`; optional reported model/quality, raw `response_file`, notes, dry_run. Records actual dimensions and stored-byte fingerprints without inventing missing reports. |
| `asset_build` | New `output_root` below `res://assets/generated/`, declarative `recipe`, optional dry_run; bounded crop/key/fit/common-scale/atlas processing and complete provenance manifest. |
| `asset_preview` | `manifest`, `asset_id`, optional frame/max_size; MCP image block of a processed asset, explicitly not a Godot screenshot. |
| `asset_verify` | Read-only verification of the manifest, current code/source/record/output bytes, layout and inventory. Check returned `passed`, not just absence of `isError`. |
| `asset_scene_add` | `manifest`, explicit `placements`, optional parent/name/dry_run; verified PNGs to one undoable Node2D group with anchors, scale, z order and standard SpriteFrames. Separate `scene_save`. |

Records/builds are append-only artifacts, not undo entries. No overwrite of an existing revision; scene undo does
not delete artwork. For full arguments, recipes, cancellation/timeout semantics, project-path protections and
non-guarantees see [art-production.md](art-production.md) / [日本語](art-production.ja.md).

## Status & project

| Tool | Purpose |
|---|---|
| `godot_status` | Connection, Godot version, project, edited scene, whether the game is running, game error count. Call first. |
| `project_info` | Name, main scene, viewport size and stretch mode, autoloads, input actions (built-in `ui_*` hidden unless `include_builtin_actions`); `glob` (e.g. `*.tscn`) lists matching files. |
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
until it is. A multi-step scenario/evidence save, export or editor launch/quit pins the current selection until it
finishes; a concurrent `project_connect` returns `BUSY` rather than redirecting the operation to another project.

## Editor

| Tool | Purpose |
|---|---|
| `editor_launch` | Open the Godot editor on the current project and wait (default 120 s, `timeout_ms`) until the MCP Loop bridge answers; returns the `godot_status` fields plus `pid`, `godot_path` and `log` (the editor's output, `res://.godot/mcp_loop/editor.log`). Nothing happens when an editor already runs for the project (`already_running: true`). `headless: true` opens it without a window (no screenshots — for servers and CI). Godot is the server's `--godot` / `GODOT_BIN` if set, else the first Godot 4.5+ on `PATH` (`godot`, `godot4`, `Godot`) or in the usual install folders (`/Applications/Godot.app`, `/usr/bin/godot`, …). The project needs the addon installed and enabled (`ADDON_NOT_INSTALLED` / `ADDON_NOT_ENABLED` otherwise — `npx godot-mcp-loop install-addon <dir>` does both). The editor keeps running when the server stops. Errors: `GODOT_NOT_FOUND`, `EDITOR_EXITED` (with the end of the log), `TIMEOUT` (the editor keeps starting). |
| `editor_quit` | Close the editor of the current project — only one this server opened with `editor_launch`; any other is refused with `EDITOR_NOT_LAUNCHED`. Stops a running game, saves the open scenes (`save: false` skips that), quits, and waits for the process to end (`timeout_ms`, default 20 s, then SIGTERM/SIGKILL if needed; `killed: true` only after exit is confirmed). If termination cannot be confirmed it returns `TIMEOUT` and retains ownership for a retry, rather than claiming `quit: true`. |

## Scenes & nodes (all undoable)

| Tool | Purpose |
|---|---|
| `scene_open` | Open a `.tscn` and make it the edited scene. |
| `scene_create` | New scene with a root node of `root_type`; refuses to overwrite. |
| `scene_save` | Save the edited scene after validating its current native destination. Native play/save-all also checks every open scene, including inactive roots; unsafe destinations return `PATH_FORBIDDEN`. |
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
| `file_write` | Text files `.yaml/.yml/.json/.md/.txt/.csv` by `content` or `edits`. YAML syntax is checked before writing; a YAML file with `steps` is validated as a scenario (warnings); JSON must parse. Not for `.gd`, `.tscn`, `.cfg`, `.tres`, or anything under `addons/mcp_loop/`, `.godot/` or `.git/`. |
| `image_write` | Pixel-art PNG from text: `palette` (single character → color) and `rows`, or `frames` for a horizontal sprite sheet; `scale` uses nearest neighbour; `mirror: x / y / xy` (+ `mirror_overlap`) completes symmetric sprites from a half or quarter. A palette entry of `null` or `"transparent"` is see-through. Imported immediately — use `{"res": path}` as a `Sprite2D` texture, `texture_filter: 1` (Nearest) for crisp pixels, `hframes`/`frame` to animate. |
| `project_export` | Build the project with one of its `export_presets.cfg` presets: Godot's `--export-release`, headless, fixed argument list, no shell. The selected output must be under `res://build/` (default `res://build/<preset>/`; `index.html` for Web); output folders and companion files are checked for links before spawning. This is not a sandbox for Godot or export-plugin writes. Returns the files found at the selected output location with sizes and the log tail; `dry_run` shows the command. A timeout includes partial diagnostics and says whether direct-child exit was confirmed; plugin descendants are not covered. Needs export templates (a clear `TEMPLATES_MISSING` otherwise). |
| `input_action_set` | Add/replace an input action in project.godot (`keys` by physical position, `mouse_buttons`, `joypad_buttons`, `deadzone`) or `remove: true`. Restart the game to apply. An action that already matches is reported as `unchanged` and the file is left alone; any real save rewrites project.godot in Godot's canonical form, so blank lines between actions are dropped. |
| `project_setting_set` | One project setting from a fixed list: `application/run/main_scene`, `display/window/size/*`, `display/window/stretch/*`, `application/config/name`, `application/run/max_fps`. Values converted to the setting's type; other keys are refused. Undoable; the editor window and a running game apply most of them when they start. |

## Undo

| Tool | Purpose |
|---|---|
| `edit_undo` | Undo the latest `steps` actions **made through MCP**, newest first. Stops if a human made a later edit in the same history, so it never reverts your own work. |

File-backed edits (`file_write`, `script_write`, `image_write`, project settings and input actions) report actual save
failures and do not register a successful edit when their forward I/O fails. `edit_undo` checks the inverse I/O
before consuming its native history step. A refused path returns `PATH_FORBIDDEN`; an I/O failure retains the
pending edit and its original error instead of becoming `NOTHING_TO_UNDO`. If earlier requested steps succeeded,
the returned JSON includes their `undone` list plus `stopped_reason` and `error`; the whole request is not atomic.
Removing a PNG and its `.import` sidecar is not atomic either: an unlink failure can leave partial removal, which
is reported and can be retried after repairing the filesystem. An existing orphan sidecar is not overwritten.

Before replacing an existing text file, script or PNG, its undo snapshot must be read successfully. A read failure
refuses the replacement without changing disk or adding history; it is not treated as an empty original. Restore
read access and retry. A genuinely empty readable file remains a valid original.

Godot's own undo/redo can advance its cursor even if a file callback fails. Such a failure logs a warning and its
recovery record is retained in this editor session; do not treat the native cursor alone as proof of disk success.
A redo followed by a failed GUI undo between MCP calls still retains that failure ahead of older MCP edits.
A failed native redo requires filesystem repair and editor undo/redo realignment before MCP undo proceeds.
Reentrant file edits/undo return `BUSY`. If disk changed but native registration cannot be confirmed, the error
explicitly says so and blocks further file edits/undo; inspect that edit rather than blindly repeating it.

## Run & observe

| Tool | Purpose |
|---|---|
| `game_run` | Launch `main`, `current`, or a scene path; waits until the in-game runtime connects. `restart`, `pause_on_error`. |
| `game_stop` | Stop the game. Game logs remain readable. |
| `game_query` | Live values from the running game (`properties`), or an overview incl. script variables and children. |
| `game_ui_audit` | Walk the Control tree of the running game: rect, size, anchors, text and issues (no size, outside the viewport, beyond its parent panel, clipped text, overlapping labels). Use it before judging a HUD by screenshot. |
| `game_in_view` | Is a Node3D inside the camera's view (`in_view`, `behind`, `screen` position in viewport pixels). The 3D judgement that otherwise needs a screenshot. |
| `game_ray` | Cast a ray between two world-space points: `hit`, `position`, `normal`, `distance`, `collider`; `exclude` a body, limit `collision_mask`, include areas. World axes do not follow a body's rotation, unlike a child RayCast3D. |
| `game_contacts` | Contact points of a RigidBody3D (needs `contact_monitor`): `position`, `normal`, `collider` per contact — grounding read instead of guessed. |
| `game_input` | Ordered input steps with real timing: `{action, hold_ms}`, `{action, press}`/`{action, release}`, `{key}`, `{mouse_move}`, `{mouse_click}`, `{wait_ms}`. Unknown actions/keys are rejected before anything runs. `hold_frames` / `wait_frames` count physics frames (deterministic for logic in `_physics_process`). Inline steps `{set}`, `{call}`, `{assert}`, `{wait_for}` run inside the game between inputs with no time passing; a failing one aborts and releases held input. Optional `record: {node, properties, method?, args?, interval_ms?, mode?, per?, expect?}` samples the properties every frame while the steps run (with `method`, the properties are paths inside its return value, e.g. `{node: ".", method: "summary", properties: ["ball_pos:2"]}` — the method runs every sample, so it should only read state) (`per: "physics"` samples once per physics frame and adds the frame index — use it for fixed-step logic) and returns `summary` (`min`, `max`, `min_at_ms`, `max_at_ms`, `first`, `last`) computed over every recorded frame (up to 3000), plus `samples_total` and an evenly thinned list of at most 50 samples — keep `interval_ms` at 0 for exact min/max — use it for brief states such as the top of a jump (add a final `{wait_ms}` to keep recording after the input). `pause_at_end: true` leaves the game paused when the sequence finishes, so the next call measures what the input left behind (otherwise the game keeps running between calls). Input that needs physics frames (actions, `hold_frames`/`wait_frames`, `wait_for`) is refused while the game is paused — the tree never ticks, so a wait would pass real time and change nothing; use `game_step`. |
| `game_wait_for` | Wait until `node.property <op> value` (`== != > >= < <= contains`), checked every frame. With `method` (and optional `args`) the method's return value is checked instead, and `property` becomes a path inside it — e.g. `{node: ".", method: "summary", property: "state", op: "==", value: "battle"}`; the method runs on every check, so use a side-effect-free observation method. This tool is not marked read-only: it can invoke a mutating method and does not enforce purity. `timeout_ms: 0` = one-shot assertion (`ASSERTION_FAILED` with the actual value). `op: changed / increased / decreased` waits for a change from the value seen when waiting starts. `tolerance` widens numeric comparisons (default 0.0001); `message` is prefixed to a failure. On timeout returns the last observed value. |
| `game_set` | Change live state: `{properties: {"score": 300, "position:x": 40, "items:2": 5}}`. Paths may address members, array elements and dictionary keys; values are converted to the existing type; all-or-nothing; returns before/after. |
| `game_pause` | `paused: true/false`. While paused, game nodes don't run but `game_query` / `game_set` / `game_call` / `game_wait_for` still work, so a situation can be inspected and set up across calls without time passing. |
| `game_step` | Run exactly `frames` physics frames, then stay paused. Every pausable node gets the same N `_physics_process` calls, independent of call latency. Actions held with `press: true` stay held until explicit release, even when another application takes focus; `game_input` action presses use the same API-owned state. `press` / `release` / `tap` (lists of actions) are sent just before the first stepped frame, like real input, so the game sees them in that frame as `Input.is_action_just_pressed()` and as input events (`_unhandled_input`); `tap` is released after the first frame (a one-frame step works). Input sent with `game_input` while paused can't do this — the press belongs to an earlier frame. Returns `stepped_frames` (the N that just ran) and `physics_frame` (the engine's total physics counter — it keeps increasing while paused, so it is not the number of frames stepped). |
| `game_call` | Call a method on a game node (e.g. a test hook `restart()` or `spawn_wave(3)`); arguments converted to the declared types; coroutines awaited; returns the result. |
| `logs_read` | `print` output, errors and warnings with file/line/stack. `source: game` (default) or `editor`; use `since: <next>` to read incrementally. |
| `screenshot` | PNG of the running game (`target: game`) or the editor viewport (`target: editor`). Game captures are scaled to the project's viewport size so repeated screenshots compare like for like (`normalize: "none"` keeps the window size); the text gives the size and the window size when they differed. Unavailable when headless. |

## Judge

| Tool | Purpose |
|---|---|
| `scenario_run` | Run a YAML/JSON play-test file or inline scenario (`movie` records it as `movie.gif` + `contact.png`, [details](scenarios.md#recording-a-movie)); returns a pass/fail report with per-step timing, the failing value, game errors, and screenshots. `path` may be a folder (every `.yaml`/`.yml`/`.json` in it, natural name order) and `paths` a list; both return one summary (`Scenarios: 5/6 passed`) with details of failures, and attach only failure screenshots by default. `stop_on_failure` stops the batch early. `save_to` keeps the screenshots, `report.md` and `report.json` as files in a project folder ([evidence](scenarios.md#keeping-evidence)). See [scenarios.md](scenarios.md). |
| `test_run` | Run the project's unit tests with [GUT](https://github.com/bitwes/Gut) or [GdUnit4](https://github.com/MikeSchulze/gdUnit4) (whichever is installed under `addons/`; `framework` picks one when both are) in a separate headless Godot process started by the editor. Returns `Tests (GUT, res://test): FAILED — 11/13 passed, 1 failed, 1 skipped`, each failing test with its message, and error lines from the log; `report: "full"` adds every test's status as JSON. `path` is a test folder or one test script (default `res://test` or `res://tests`; GUT uses `.gutconfig.json` when there is one), `test` (GUT only) runs the tests whose name contains the text, `timeout_ms` (default 120000) requests termination and waits for direct-child exit; unconfirmed exit keeps the runner `BUSY` until that process is observed dead. Only the last 64 KiB of its log is read; JUnit reports above 8 MiB are refused as unavailable. These are read limits, not a disk quota. Failing tests are a normal result, not a tool error. Use it for game logic; `scenario_run` for play. |

A test run passes only with exit code `0` and a valid JUnit report containing tests and no failures/errors. Reports
must finish normally with matching closing tags and one JUnit root; a successful prefix of a truncated report,
extra roots or trailing non-XML text cannot contribute passing cases. A
successful-looking report never overrides a nonzero process exit; summaries show that exit code and full JSON
keeps `passed: false`.

## Operational limits and game errors

### Native command-line values and save refusals

Godot changes literal `%20` and leading/trailing whitespace before it parses arguments. Export, editor/game launch
and child test-runner arguments refuse these values and control characters instead of silently rewriting them;
export preset names also cannot begin with `-`. Interior spaces and ordinary Unicode names are supported. Repair a
refused native save destination before retrying; `editor_quit` does not force-kill the editor on a domain-level save
refusal. `edit_undo` similarly keeps a refused file/project-setting action pending until its path is safe again.

### Startup, session ownership and launch selection

An `editor_launch` readiness timeout leaves its owned editor running. While that process is alive, another startup
is refused with `BUSY` rather than spawning again or replacing the ownership record; check `godot_status` later or
use `editor_quit`. Startup admission begins before executable discovery and readiness must match the owned PID.
The complete launch request, including already-running and final-status paths, pins the selected project until it
finishes. This is a selection lease, not a lock blocking all requests for that project.

The editor removes only session metadata matching its own successful publication fingerprint. This distinguishes
changed generations in one process, but is not an inode-bound compare-and-delete against a racing same-user actor,
and byte-identical rewrites cannot be distinguished. Runtime replies must match a live request, its native debugger
session and its run generation; unsolicited, duplicate and late replies are dropped. Stop/restart cancels old waits.

`game_run(scene="main"|"current")` captures the selected target before waits and refuses a changed selection with
`BUSY`; retry only after checking the intended target. Scene paths and all open-scene save destinations are rechecked
before native play. A valid native main-scene UID is retained as a UID, not rewritten into a filename argument;
its resolved resource path is checked for containment. Native UID and direct filename argv handling are not identical.

### Game errors

By default Godot's debugger pauses a game on a script error, which would freeze an automated loop. The addon records
the break in the game log and immediately continues, so the agent sees the error in `logs_read` /
`godot_status.game.errors` and the game stays responsive. Pass `game_run(pause_on_error=true)` to keep Godot's default.

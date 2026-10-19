# Scenario tests

A scenario is a small, declarative play-test. `scenario_run` (re)starts the game, runs the steps in order, stops at
the first failure, always stops the game afterwards, and returns a report.

```yaml
name: player moves right and jumps        # required
scene: res://examples/platformer/main.tscn # optional: "main" (default), "current", or a res:// path
keep_running: false                        # optional: leave the game running afterwards
steps:
  - wait_for: { node: Player, property: "position:y", op: ">=", value: 370, timeout_ms: 5000 }
  - input: { action: move_right, hold_ms: 1000 }
  - assert: { node: Player, property: "position:x", op: ">", value: 250 }
  - input: [{ action: jump, hold_ms: 100 }, { wait_ms: 200 }]
  - wait_for: { node: Player, property: jumps, op: "==", value: 1, timeout_ms: 2000 }
  - query: { node: Player, properties: [position, velocity] }
  - screenshot: after_jump
  - assert_no_errors: true
```

## Steps

| Step | Meaning | Fails when |
|---|---|---|
| `wait_for: {node, property, op, value, timeout_ms?}` | Poll every frame until true (default 5 s). `op: changed/increased/decreased` needs no value. `tolerance` and `message` work on `wait_for` and `assert`. | Timeout — the report shows the last value. |
| `pause: true` / `pause: false` | Pause or resume the game (game nodes stop; checks still work). | — |
| `step: N` | Run exactly N physics frames, then stay paused — frame-exact tests without timing slack. `step: {frames, press?, release?, tap?}` sends input just before the first frame, so `Input.is_action_just_pressed()` sees it in that frame (`tap` = one frame). | — |
| `assert: {node, property, op, value}` | Check once, right now. In `assert` and `wait_for`, `method` (with optional `args`) checks a method's return value instead; `property` is then a path inside it, e.g. `{node: ".", method: summary, property: message, op: contains, value: "LEVEL UP"}`. | Condition false. |
| `input: <step>`, `[<step>, ...]` or `{steps, record?}` | Same steps as `game_input`, run inside the game in one call: `hold_frames`/`wait_frames` for frame-exact timing, inline `set`/`call`/`assert`/`wait_for`, and `record` with `expect` checks on min/max. | Unknown action/key, a failing inline step or record check. |
| `query: {node, properties?}` | Record live values in the report. | Node/property missing. |
| `screenshot: <label>` | Attach a screenshot. | Never — skipped when headless. |
| `wait_ms: <n>` | Sleep. | Never. |
| `assert_no_errors: true` | No error-level game log so far. | Any script/engine error was logged. |
| `set: {node, properties}` | Change live state (same as `game_set`), e.g. fix the piece order or skip to a level. | Path/value invalid (nothing changed). |
| `call: {node, method, args?, timeout_ms?}` | Call a method (same as `game_call`); the result is shown in the summary. | Unknown method, bad arguments. |
| `repeat: {times, steps}` | Run `steps` `times` times (nestable; at most 10 000 steps after expansion). Reported as one step. | An inner step fails — the message names the iteration and inner step. |

Operators: `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`. Numbers compare with a 0.0001 tolerance; vectors compare
element-wise (`[x, y]`); `>`/`<` need numbers — compare a component such as `position:x`.

## Running a folder

`scenario_run {path: "res://tests/scenarios"}` runs every `.yaml` / `.yml` / `.json` file directly in the folder, in
name order (number them: `1_title.yaml`, `2_movement.yaml`, ...). `paths: [...]` runs a list in the given order. The
result starts with one line such as `Scenarios: 5/6 passed (41.2 s)`, lists each file, then shows the full report of
each failure. A file that can't be read or parsed is reported as a failure and the rest still run;
`stop_on_failure: true` stops at the first one. Only failure screenshots are attached unless `include_screenshots: true`.
The server sends a progress notification after each scenario, so clients that reset their timeout on progress can run
long batches; others may stop at their tool timeout (for Codex, raise `tool_timeout_sec` in the server's config) — run
large suites a folder at a time there.

## Report

By default the tool returns the summary and the screenshots; pass `report: "full"` to also get the JSON report.
The three parts:

1. A human summary:
   ```
   Scenario "intentional failure demo": FAILED (2.1 s)
     ✓ 1. wait_for Player.position:y >= 370 (412 ms) → 375.13
     ✓ 2. input move_right (hold 200 ms) (215 ms)
     ✗ 3. assert Player.position:x > 600 (6 ms) — ASSERTION_FAILED: Condition position:x > 600.0 is false. Actual value: 144.0
     - 4. input jump (hold 100 ms)
   ```
2. The JSON report: `passed`, `duration_ms`, `steps[]` (`status`: `pass` / `fail` / `error` / `skip` / `skipped`,
   `target` — what the step checked or did, `message`, `detail`), `errors[]` (error logs from the game), `setup_error`.
3. Screenshots as images: every `screenshot` step plus an automatic one at the failing step (when a renderer is available),
   labelled with the same 1-based step number as the summary.

A failing scenario is a *successful* tool call (`isError` is false); `passed` tells you the outcome.

## Keeping evidence

`save_to: "res://qa/evidence/move"` also writes the run to a folder in the project, so a person can check it later or
attach it to a pull request (a screenshot that was looked at once and discarded is not evidence):

```
qa/evidence/move/            one scenario                 qa/evidence/all/             a folder or paths
  01-start.png                                              1_title/  (same files as one scenario)
  02-after-jump.png                                         2_movement/
  failure.png    (if a step failed)                         summary.md   table with links to each report.md
  report.md      summary + every screenshot                 summary.json
  report.json    JSON report and the list of files
```

The folder gets a `.gdignore`, so the editor does not import the images. A re-run into the same folder deletes only the
files its previous run listed in `report.json` / `summary.json` and leaves anything else; a non-empty folder that
scenario_run did not write is refused. Same path rules as other writes (inside the project, not `.godot/` or `.git/`,
not the project root); the folder is checked before the game starts. Writing evidence is not undoable — add the folder
to `.gitignore` or commit it on purpose.

## Recording a movie

`movie` records the run with Godot's Movie Maker and keeps it with the evidence (one scenario, `save_to` required):

```json
{"path": "res://examples/shooter/scenarios/4_boss_clear.yaml", "save_to": "res://qa/boss",
 "movie": {"fps": 30, "gif_fps": 15, "max_width": 480, "contact_sheet": 12}}
```

```
qa/boss/
  movie.gif      the run as a looping GIF (every second frame at 15 fps, 480 px wide)
  contact.png    12 evenly spaced frames in a grid, each labelled "<game time>s (<frame>)"
  frames/        every recorded frame, only with "frames": true
  report.md      summary, screenshots, the GIF and the contact sheet
```

The contact sheet also comes back as an image in the tool result, so the agent sees the motion in one look; the
summary adds a line such as `Movie: 240 frames at 30 fps (8.00 s of game time) → movie.gif 480×270, 120 frames at 15 fps
(812 KB); contact.png (12 frames)`.

Keep only one section of the run with `from_step` / `to_step` (1-based step numbers, inclusive):

```json
{"path": "res://examples/marble/scenarios/5_goal.yaml", "save_to": "res://qa/goal",
 "movie": {"fps": 30, "from_step": 5, "to_step": 7}}
```

The whole run is still recorded (Movie Maker starts with the game), but the server notes how many frames existed when
each step started and cuts the GIF, contact sheet and `frames/` to that range. Contact labels keep the time from the
start of the recording, so a trimmed frame still says when it happened. A range that covers no frames is reported and
the whole recording is used.

How it works: the editor starts the game with `--write-movie` and `--fixed-fps <fps>` (the Movie Maker settings are
set only for that launch and restored at once), the game writes `res://.godot/mcp_loop/movie/frameNNNNNNNN.png`, and
at the end the game is asked to quit by itself so the last frame is complete. The server then builds the GIF (one
palette — exact for up to 256 colours, as in pixel art — and only the changed rectangle per frame) and the contact
sheet. Things to know:

- The game runs at a fixed step of 1/`fps` per frame, as fast as it can render — faster or slower than real time.
  Waits, holds and `wait_for` timeouts in the scenario count game time, so the movie shows the same timing a player
  would see and a slow machine (software rendering) doesn't make them fire early; the editor's and server's own safety
  timeouts get ten times more room. Prefer frame-based steps (`hold_frames`, `wait_frames`, `step`) for exact timing.
- Recording needs a game window: remove `--headless` from *Main Run Args* (`RENDERING_UNAVAILABLE` otherwise). The
  editor itself may be headless. On a Linux server, run it under `xvfb-run`.
- The movie has the project's window size (*Display › Window › Size › Viewport Width/Height*, or the window size
  override with the `canvas_items` stretch mode). Godot crops each frame to that aspect ratio, so a game that sets a
  different content size at runtime (e.g. 256×240 pixel art in a 1152×648 project) loses its top and bottom — set the
  viewport size to the game's aspect (768×720 for 256×240).
- GIFs are capped at 300 frames (longer recordings are thinned evenly) and `gif_fps` at 50 (browsers slow faster
  GIFs down).

## Examples

- [`examples/platformer/scenarios/move_right.yaml`](../examples/platformer/scenarios/move_right.yaml) — passes.
- [`examples/platformer/scenarios/intentional_failure.yaml`](../examples/platformer/scenarios/intentional_failure.yaml) — fails on purpose to show the report.

# Marble Run

Collect coins and roll/jump across ramps, gaps and checkpoints to reach the goal before the timer expires.
The existing course, grounded jumps, camera and life/checkpoint rules are retained.

## Play it

The standalone game does not require the MCP addon or an AI account. Godot 4.7.2 is the verified engine.

```sh
godot --headless --path . --import
godot --path .
```

For agent editing/testing, explicitly install the addon from the same selected server build and open the editor.
Included in 0.12.0 alongside the other showcased games. Earlier 0.11.0 also includes this sample.
[日本語の操作](PLAY.ja.md) · [Delivery changes](UPGRADING.md).

Why the course is built the way it is — the staircase rule and the numbers behind it, the movement and camera model,
the state machine and the deliberate limits — is in [DESIGN.md](DESIGN.md).

Press Enter on the title, then:

| Key | Action |
|---|---|
| Arrows / WASD | roll the marble (camera-relative) |
| Space | jump (only when grounded) |
| Enter | start, and return to the title after a clear or a game over |

Collect 10 coins, pass the two checkpoints, and reach the goal before the timer runs out. Falling costs a life
(three in total).

## What is in it

- `main.tscn` — the course: a ramp, three landings, a 1.8 m beam, two gaps that need a jump, coins, checkpoints, the
  goal, a chase camera and the HUD.
- `scripts/` — `main.gd` (state machine, physics loop, camera, test hooks), `ball.gd`, `coin.gd`, `goal.gd`,
  `checkpoint.gd`, `platform.gd`, `hud.gd`.
- `scenarios/` — seven YAML play-tests, including `7_gap_needs_jump.yaml`, which proves both halves of the course's
  design: rolling forward alone loses lives and never clears, while a jump at 9 m/s lands on the far platform.

## Test hooks (for scenarios and agents)

`start_game()`, `teleport_ball(x, y, z)`, `set_checkpoint(index)`, and
`summary()` → `{state, coins, lives, time_frames, ball_pos, ball_speed, on_floor, checkpoint}`.

```bash
# with an editor open on this project
scenario_run {"path": "res://scenarios", "save_to": "res://qa/evidence"}
```

## Recorded sample qualification

- `scenario_run` on the folder: 7/7 passed, twice in a row.
- 40 seconds of random input: 0 script errors, 0 debugger stops.
- Every screen (title, ready, play, jump, coin, game over, clear) inspected; the gap rule re-measured frame by frame.
- A movie recording of the clear (`movie: {}`) checked as a GIF and a contact sheet.

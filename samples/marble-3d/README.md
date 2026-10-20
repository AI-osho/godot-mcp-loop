# Marble Run — the 3D sample

A small 3D game built end to end by an AI agent through godot-mcp-loop, and then verified independently: seven
regression scenarios, a 40-second random-input run without a single script error, and every screen checked by
screenshot. It is the game the 3D tools were hardened against — `game_in_view`, `game_ray`, `game_contacts`,
JSON `Transform3D` values and `record.method` all exist because this game needed them.

## Play it

```bash
cd marble-3d
npx -y godot-mcp-loop@latest install-addon . --skill   # the addon must match the server version
godot -e --path .                                      # Godot 4.5 or newer
```

Open it in the editor (or run `godot --headless --path . --import`) once before a headless run: a fresh folder has no
global class cache yet, so `class_name MarbleBall` and friends are unknown until Godot has imported the project.

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

## How it was verified

- `scenario_run` on the folder: 7/7 passed, twice in a row.
- 40 seconds of random input: 0 script errors, 0 debugger stops.
- Every screen (title, ready, play, jump, coin, game over, clear) inspected; the gap rule re-measured frame by frame.
- A movie recording of the clear (`movie: {}`) checked as a GIF and a contact sheet.

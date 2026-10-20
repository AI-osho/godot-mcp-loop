# Marble Run — design notes

Why the game is built the way it is. Written by reading the code and re-running the measurements, so the comments in
`scripts/` and the scenarios can point at reasons instead of restating lines.

## The course is a staircase, on purpose

Each landing is **0.6 m higher** than the one before (start pad 0 → ramp 1.5 → Platform 2 at 1.5 → Platform 3 at 2.1 →
beam and Platform 4 at 2.1 → goal pad at 2.7). That single rule is what makes the two gaps real:

- A marble rolling off an edge falls about **0.54 m over a 3 m gap** at 9 m/s, so with level platforms it would land
  on the far side (or pop over the corner) without ever jumping — exactly what the first build did.
- With a 0.6 m step up, the falling marble meets the **side of the next platform** and drops into the gap. A jump
  reaches about **1.6 m** (measured: ground 0.49 m, peak 2.11 m), so a jump clears the step comfortably.

`scenarios/7_gap_needs_jump.yaml` proves both halves: 1500 frames of forward alone lose lives and never clear; a
marble given 9 m/s and one jump lands past the gap. Do not flatten the course without changing that scenario.

## Movement: forces, a cap, and braking only on the ground

`MOVE_FORCE 18`, `BRAKE_FORCE 6`, `MAX_SPEED 9`. Input is camera-relative (`-camera.basis.z` flattened and
normalised), so "forward" is always away from the camera, and the marble is pushed with a central force rather than
teleported — rolling and bouncing come from the physics engine.

The speed cap compares the **total** velocity, so a falling marble can exceed 9 m/s downward while its horizontal speed
stays at 9. Braking only applies while grounded; in the air the marble keeps its momentum, which is what makes the
gaps jumpable.

## Camera: an offset, frame-rate-independent smoothing, and a ray

Offset `(0, 3.6, 6.4)`, looking at the marble plus `(0, 0.6, 0)`. Smoothing is `1 - exp(-8 * delta)`, which behaves
the same at any frame rate (a plain `lerp(a, b, 0.1)` would not). `_avoid_wall` casts from just above the marble to the
desired position and pulls the camera to `hit + normal * 0.3` when something is in the way; the marble is excluded
from the ray so it cannot push its own camera.

## State machine and the input lock

`title → playing → clear | game_over → title`. After a clear or a game over the state stays for
`STATE_LOCK_FRAMES = 30` (0.5 s) before Enter returns to the title, so a held Enter cannot skip the result screen.
`_enter_title` and `start_game` share the same reset (coins, lives, timer, checkpoint, frozen marble) — the title screen
is the same world with the marble frozen, which keeps one scene instead of two.

## Lives and checkpoints

Three spawn points: start, after the ramp (index 1), and before the last gap (index 2). A fall costs one life and
respawns at the **last checkpoint reached**, so the two hard sections stay retryable. Reaching zero freezes the marble
and shows the game-over panel; the run's time is kept for the clear screen only.

## Test hooks

`start_game`, `teleport_ball`, `set_checkpoint`, `summary`, `ball_on_screen`. The first four are the interface the
scenarios and the agent use. `ball_on_screen()` was written by the coding agent because the tools had no way to ask
"is this on screen?" — `game_in_view` now does that generically, and the sample keeps the method as a documented
example of what a hand-written probe used to look like.

## Known limits (deliberate)

- No audio, no menu, no level select — it is a sample, not a product.
- The camera's wall ray is never exercised: the course has no walls tall enough to block the camera.
- The marble's materials are set from code (`ball.gd`), so swapping in Blender models is a mesh swap, not a re-export.

## Comment plan (what gets written into `scripts/`)

| File | What the comments explain |
|---|---|
| `main.gd` | the staircase rule and the numbers behind it, why braking is grounded-only, why the speed cap uses the total velocity, the `exp` smoothing, what the wall ray excludes, why the input lock exists, what each hook is for |
| `ball.gd` | why the ground ray is 0.75 m and why the ball's own RID is excluded; that `jump` is an impulse, not a velocity |
| `coin.gd`, `goal.gd`, `checkpoint.gd` | why they only report (`collected` / `reached` / `checkpoint_entered`) and leave scoring to `main.gd` |
| `platform.gd` | why size and colour are applied in `_ready` (shared sub-resources would otherwise leak between instances) |
| `hud.gd` | what the label names are for (assertions and `game_ui_audit`), and why the HUD is built in code |

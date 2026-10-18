# Deterministic testing

Tests that depend on wall-clock time pass on one machine and fail on another. godot-mcp-loop lets you count physics
frames instead. All of this assumes the game runs its logic in `_physics_process` (60 frames per second by default).

## Pause and step

```yaml
name: frame-exact jump
scene: res://games/runner/main.tscn
steps:
  - wait_for: { node: Player, method: is_on_floor, op: "==", value: true, timeout_ms: 3000 }
  - pause: true
  - step: { frames: 1, tap: [runner_jump] }      # the press lands in this frame
  - assert: { node: Player, property: "velocity:y", op: "<", value: 0 }
  - step: 10
  - assert: { node: Player, property: jumps, op: "==", value: 1 }
  - pause: false
  - assert_no_errors: true
```

- `pause: true` freezes game nodes; `query`, `set`, `call`, `assert`, `wait_for` still work, so you can set up a
  situation without time passing.
- `step: N` runs exactly N physics frames and stays paused.
- `step: {frames, press, release, tap}` sends input just before the first stepped frame, the way real input arrives.
  `tap` releases after the first frame; `press` keeps holding (release it later with `release`).
- Why not `game_input` while paused? Godot only reports `is_action_just_pressed()` in the frame where the press was
  registered. A press sent while paused belongs to a frame the game never saw, so it is ignored.

## Frame-counted input

```yaml
name: three tiles in twenty frames
scene: res://games/quest/main.tscn
steps:
  - call: { node: ., method: start_new_game }
  - input: { action: quest_right, hold_frames: 20, wait_frames: 12 }
  - assert: { node: ., property: tile, op: "==", value: [10, 9], message: "holding right walks 3 tiles" }
```

`hold_frames` / `wait_frames` count physics frames. A release takes effect on the next frame.

## Recording brief states

The top of a jump lasts a single frame. Record it instead of trying to query at the right moment:

```yaml
name: jump height
scene: res://games/runner/main.tscn
steps:
  - wait_for: { node: Player, property: "position:y", op: ">=", value: 370, timeout_ms: 3000 }
  - input:
      steps:
        - { action: runner_jump, hold_frames: 6 }
        - { wait_frames: 50 }
      record:
        node: Player
        properties: ["position:y"]
        per: physics
        expect:
          - { property: "position:y", stat: min, op: "<", value: 300 }
          - { property: "position:y", stat: last, op: ">=", value: 370 }
```

- `per: physics` samples once per physics frame and adds the frame index; the default samples per rendered frame.
- `stat` is one of `min`, `max`, `first`, `last`, `min_at_ms`, `max_at_ms`.
- The result also returns `summary` and up to 50 evenly spaced samples, useful for tuning.

## Reading a method's result

A side-effect-free `summary()` hook is the easiest way to check game state:

```yaml
name: battle starts
scene: res://games/quest/main.tscn
steps:
  - call: { node: ., method: start_battle, args: [slime] }
  - wait_for: { node: ., method: summary, property: "battle:phase", op: "==", value: menu, timeout_ms: 4000 }
  - assert: { node: ., method: summary, property: "player:hp", op: ">", value: 0 }
```

`property` is a path inside the returned value (`battle:phase`, `items:0`). Arguments are converted to the declared
parameter types. The method runs on every check, so it must only read state.

## Inline steps

`input` can mix input with `set`, `call`, `assert` and `wait_for` that run inside the game between inputs, with no
time passing between them. A failing inline step aborts the sequence and releases held input:

```yaml
name: inline checks
scene: res://games/quest/main.tscn
steps:
  - input:
      steps:
        - call: { node: ., method: start_new_game }
        - set: { node: ., properties: { encounter_rate: 1 } }
        - assert: { node: ., property: state, op: "==", value: field }
        - { action: quest_down, hold_frames: 1 }
        - wait_for: { node: ., property: state, op: "==", value: battle, timeout_ms: 2000 }
```

## Tolerance and messages

Numbers compare with a 0.0001 tolerance by default; widen it with `tolerance`. `message` explains a failure in the
test's own words:

```yaml
name: landing spot
scene: res://games/runner/main.tscn
steps:
  - assert: { node: Player, property: "position:x", op: "==", value: 120, tolerance: 0.5, message: "player starts at x=120" }
```

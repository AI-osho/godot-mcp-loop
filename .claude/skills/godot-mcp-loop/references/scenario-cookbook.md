# Scenario cookbook

Scenario files live next to the game in `scenarios/`, numbered so `scenario_run {path: ".../scenarios"}` runs them in
order. Each scenario restarts the game. Use hooks (`call`, `set`) to reach the situation under test quickly, then
drive it with real input.

## Title screen to gameplay

```yaml
name: 1 title to game
scene: res://games/shooter/main.tscn
steps:
  - wait_for: { node: ., property: state, op: "==", value: title, timeout_ms: 5000 }
  - screenshot: title
  - input: { action: shooter_start, hold_frames: 2 }
  - wait_for: { node: ., property: state, op: "==", value: playing, timeout_ms: 2000 }
  - assert: { node: ., property: lives, op: "==", value: 3 }
  - assert_no_errors: true
```

## Movement and collision

```yaml
name: 2 walls stop the player
scene: res://games/quest/main.tscn
steps:
  - call: { node: ., method: start_new_game }
  - set: { node: ., properties: { encounters_enabled: false } }
  - pause: true
  - call: { node: ., method: warp, args: [castle, 1, 7] }
  - step: { frames: 1, tap: [quest_left] }
  - assert: { node: ., property: moving, op: "==", value: false, message: "wall on the left" }
  - assert: { node: ., property: tile, op: "==", value: [1, 7] }
  - pause: false
  - assert_no_errors: true
```

## Menu navigation

Menus usually react to `is_action_just_pressed`, so use one-frame taps while paused:

```yaml
name: 3 battle menu cursor
scene: res://games/quest/main.tscn
steps:
  - call: { node: ., method: start_battle, args: [slime] }
  - wait_for: { node: ., method: summary, property: "battle:phase", op: "==", value: menu, timeout_ms: 4000 }
  - pause: true
  - step: { frames: 1, tap: [quest_down] }
  - assert: { node: ., method: summary, property: "battle:selected", op: "==", value: 1 }
  - step: { frames: 1, tap: [quest_up] }
  - assert: { node: ., method: summary, property: "battle:selected", op: "==", value: 0 }
  - pause: false
```

## Score, damage and game over

```yaml
name: 4 losing the last life ends the game
scene: res://games/shooter/main.tscn
steps:
  - call: { node: ., method: start_game, args: [1] }
  - set: { node: ., properties: { lives: 1, invincible: false } }
  - call: { node: ., method: spawn_enemy_bullet, args: [128, 150, 0, 2] }
  - wait_for: { node: ., property: state, op: "==", value: game_over, timeout_ms: 5000 }
  - screenshot: game_over
  - input: { action: shooter_start, hold_frames: 2 }
  - wait_for: { node: ., property: state, op: "==", value: playing, timeout_ms: 2000 }
  - assert: { node: ., property: score, op: "==", value: 0, message: "a new game resets the score" }
```

## Waiting for a change

```yaml
name: 5 coins count up
scene: res://games/runner/main.tscn
steps:
  - call: { node: ., method: start_at, args: [400, 200] }
  - wait_for: { node: ., property: coins, op: increased, timeout_ms: 3000 }
```

`changed / increased / decreased` compare with the value seen when waiting starts and need a timeout.

## Repeating

```yaml
name: 6 fifty rotations keep the board valid
scene: res://games/blocks/main.tscn
steps:
  - repeat:
      times: 50
      steps:
        - input: { action: blocks_rotate, hold_frames: 1, wait_frames: 2 }
  - assert: { node: ., method: summary, property: valid, op: "==", value: true }
```

## Exploratory checks (not in scenario files)

Before writing scenarios, explore with tools: `game_run`, then a few seconds of mixed `game_input`, then `logs_read`
and `screenshot`. Random input for 30–60 seconds (mashing every action) is a cheap way to find crashes; check
`godot_status.game.errors` afterwards.

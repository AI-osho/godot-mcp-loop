# Designing a game for testing

Games built in this project are checked by an agent that cannot see the screen continuously. A few habits make every
behaviour checkable.

## Fixed-step logic

- Put gameplay (movement, timers, AI, animation counters) in `_physics_process` and count frames
  (`state_frame += 1`) instead of reading `Time` or accumulating `delta` for game rules.
- Keep `_process` for purely visual work (interpolation, particles).
- Then `game_step`, `hold_frames` and `record per: physics` give exact, repeatable results.

## Readable state

- Keep important state in plain script variables (`state`, `score`, `lives`, `tile`, `moving`), not only inside
  nodes created at runtime, so `game_query` and conditions can read them by name.
- Add a `summary() -> Dictionary` method that returns the important state in one place. It must not change
  anything; conditions call it every frame.
- Use stable node names (`Player`, `HUD`, `Battle`) — paths in scenarios depend on them.

## Hooks for setting up situations

Expose small methods and variables so a test can jump straight to the case it checks:

| Kind | Examples |
|---|---|
| Reproducibility | `rng_seed` (seed every `RandomNumberGenerator` from it), `sequence` (fixed piece/enemy order) |
| Skipping ahead | `start_new_game()`, `start_game(wave)`, `start_at(x, y)`, `warp(map, x, y)`, `start_battle(key)` |
| Isolation | `invincible`, `encounters_enabled`, `timer_frozen`, `enemies_frozen`, `gravity_enabled` |
| Spawning | `spawn_enemy(kind, x, y)`, `clear_enemies()` |

Hooks should leave the game in a state a player could reach, and print one log line when used.

## Logging

Print short, greppable lines for important events (`print("jump #%d" % jumps)`, `print("STATE battle")`). Scenarios
and `logs_read` can then confirm that something happened even when it lasted a single frame.

## Window and input

- Set the window, scaling and texture filter from the main scene's script (see pixel-art.md) so the game looks the
  same when run on its own or embedded in the editor.
- Add input actions with `input_action_set`, prefixed with the game's name. Read input with
  `Input.is_action_pressed()` for held movement and `is_action_just_pressed()` for menus and one-shot actions.

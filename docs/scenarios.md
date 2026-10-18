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
| `wait_for: {node, property, op, value, timeout_ms?}` | Poll every frame until true (default 5 s). `op: changed/increased/decreased` needs no value. | Timeout — the report shows the last value. |
| `assert: {node, property, op, value}` | Check once, right now. | Condition false. |
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

## Examples

- [`examples/platformer/scenarios/move_right.yaml`](../examples/platformer/scenarios/move_right.yaml) — passes.
- [`examples/platformer/scenarios/intentional_failure.yaml`](../examples/platformer/scenarios/intentional_failure.yaml) — fails on purpose to show the report.

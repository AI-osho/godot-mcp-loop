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
| `wait_for: {node, property, op, value, timeout_ms?}` | Poll every frame until true (default 5 s). | Timeout — the report shows the last value. |
| `assert: {node, property, op, value}` | Check once, right now. | Condition false. |
| `input: <step>` or `[<step>, ...]` | Same steps as `game_input`. | Unknown action/key. |
| `query: {node, properties?}` | Record live values in the report. | Node/property missing. |
| `screenshot: <label>` | Attach a screenshot. | Never — skipped when headless. |
| `wait_ms: <n>` | Sleep. | Never. |
| `assert_no_errors: true` | No error-level game log so far. | Any script/engine error was logged. |

Operators: `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`. Numbers compare with a 0.0001 tolerance; vectors compare
element-wise (`[x, y]`); `>`/`<` need numbers — compare a component such as `position:x`.

## Report

The tool returns three things:

1. A human summary:
   ```
   Scenario "intentional failure demo": FAILED (2.1 s)
     ✓ 1. wait_for (412 ms)
     ✓ 2. input (215 ms)
     ✗ 3. assert (6 ms) — TIMEOUT: Condition position:x > 600 not met within 0 ms. Last value: 144.0
     - 4. input
   ```
2. The JSON report: `passed`, `duration_ms`, `steps[]` (`status`: `pass` / `fail` / `error` / `skip` / `skipped`,
   `message`, `detail`), `errors[]` (error logs from the game), `setup_error`.
3. Screenshots as images: every `screenshot` step plus an automatic one at the failing step (when a renderer is available).

A failing scenario is a *successful* tool call (`isError` is false); `passed` tells you the outcome.

## Examples

- [`examples/platformer/scenarios/move_right.yaml`](../examples/platformer/scenarios/move_right.yaml) — passes.
- [`examples/platformer/scenarios/intentional_failure.yaml`](../examples/platformer/scenarios/intentional_failure.yaml) — fails on purpose to show the report.

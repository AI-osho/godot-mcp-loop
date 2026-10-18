import { describe, expect, it } from "vitest";
import { BridgeError } from "../src/errors.js";
import { runScenario, type BridgeCall } from "../src/scenario/runner.js";
import { parseScenario } from "../src/scenario/schema.js";

type Handler = (params: Record<string, unknown>) => unknown;

/** Scripted fake of the bridge: records calls, answers from handlers. */
function fakeBridge(handlers: Record<string, Handler>): { call: BridgeCall; calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const defaults: Record<string, Handler> = {
    "game.run": () => ({ running: true, scene: "res://main.tscn" }),
    "game.stop": () => ({ stopped: true }),
    "logs.read": () => ({ entries: [], next: 1 }),
    "screenshot": () => ({ png_base64: "AAAA", width: 10, height: 10, target: "game" }),
  };
  const call: BridgeCall = async (method, params = {}) => {
    calls.push([method, params]);
    const h = handlers[method] ?? defaults[method];
    if (!h) throw new Error(`unexpected call ${method}`);
    return h(params);
  };
  return { call, calls };
}

describe("parseScenario", () => {
  it("accepts YAML with all step kinds", () => {
    const s = parseScenario(`
name: moves right
scene: res://main.tscn
steps:
  - wait_for: { node: Player, property: "position:y", op: ">=", value: 370, timeout_ms: 3000 }
  - input: { action: move_right, hold_ms: 500 }
  - input: [{ action: jump }, { wait_ms: 100 }]
  - assert: { node: Player, property: "position:x", op: ">", value: 250 }
  - query: { node: Player, properties: [position] }
  - screenshot: after_move
  - wait_ms: 100
  - assert_no_errors: true
`);
    expect(s.name).toBe("moves right");
    expect(s.steps).toHaveLength(8);
  });

  it("accepts a plain object", () => {
    expect(parseScenario({ name: "x", steps: [{ wait_ms: 1 }] }).name).toBe("x");
  });

  it("rejects unknown step kinds with a readable message", () => {
    expect(() => parseScenario({ name: "x", steps: [{ teleport: true }] })).toThrowError(BridgeError);
    try {
      parseScenario({ name: "x", steps: [{ teleport: true }] });
    } catch (e) {
      expect((e as BridgeError).code).toBe("INVALID_PARAMS");
      expect((e as BridgeError).message).toMatch(/steps\.0/);
    }
  });

  it("rejects an empty step list and bad YAML", () => {
    expect(() => parseScenario({ name: "x", steps: [] })).toThrowError(/steps/);
    expect(() => parseScenario("name: [unclosed")).toThrowError(BridgeError);
  });
});

describe("runScenario", () => {
  it("runs steps in order, passes, and stops the game", async () => {
    const { call, calls } = fakeBridge({
      "game.wait_for": () => ({ met: true, value: 300 }),
      "game.input": () => ({ steps: 1 }),
      "game.query": () => ({ properties: { position: [1, 2] } }),
    });
    const s = parseScenario({
      name: "ok",
      scene: "res://main.tscn",
      steps: [
        { wait_for: { node: "Player", property: "position:x", op: ">", value: 1 } },
        { input: { action: "move_right", hold_ms: 10 } },
        { assert: { node: "Player", property: "position:x", op: ">", value: 1 } },
        { query: { node: "Player", properties: ["position"] } },
        { assert_no_errors: true },
      ],
    });
    const report = await runScenario(s, call);
    expect(report.passed).toBe(true);
    expect(report.steps.map((x) => x.status)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
    expect(report.steps[3]!.detail).toEqual({ properties: { position: [1, 2] } });
    // each step says what it checked or did, so reports can't be misread
    expect(report.steps.map((x) => x.target)).toEqual([
      "Player.position:x > 1",
      "move_right (hold 10 ms)",
      "Player.position:x > 1",
      "Player [position]",
      undefined,
    ]);
    expect(calls[0]).toEqual(["game.run", { scene: "res://main.tscn", restart: true }]);
    expect(calls.at(-1)![0]).toBe("game.stop");
    // assert = wait_for with timeout 0
    expect(calls.find(([m, p]) => m === "game.wait_for" && p.timeout_ms === 0)).toBeDefined();
    // input object is normalised to a steps array
    expect(calls.find(([m]) => m === "game.input")![1]).toEqual({ steps: [{ action: "move_right", hold_ms: 10 }] });
  });

  it("stops at the first failure, skips the rest, attaches a failure screenshot and error logs", async () => {
    const { call, calls } = fakeBridge({
      "game.wait_for": () => {
        throw new BridgeError("TIMEOUT", "Condition position:x > 999 not met within 0 ms. Last value: 120");
      },
      "game.input": () => ({}),
      "logs.read": (p) => (p.min_level === "error" ? { entries: [{ level: "error", message: "boom", file: "res://p.gd", line: 3 }], next: 2 } : { entries: [], next: 1 }),
    });
    const s = parseScenario({
      name: "fails",
      steps: [{ assert: { node: "Player", property: "position:x", op: ">", value: 999 } }, { input: { action: "jump" } }],
    });
    const report = await runScenario(s, call);
    expect(report.passed).toBe(false);
    expect(report.steps.map((x) => x.status)).toEqual(["fail", "skipped"]);
    expect(report.steps[0]!.message).toContain("Last value: 120");
    expect(report.failure_screenshot?.png_base64).toBe("AAAA");
    expect(report.failure_screenshot?.label).toBe("failure at step 1 (assert)"); // 1-based like the summary
    expect(report.errors).toEqual([{ level: "error", message: "boom", file: "res://p.gd", line: 3 }]);
    expect(calls.some(([m]) => m === "game.input")).toBe(false);
    expect(calls.at(-1)![0]).toBe("game.stop");
  });

  it("assert_no_errors fails when the game logged errors", async () => {
    const { call } = fakeBridge({
      "logs.read": (p) => (p.min_level === "error" ? { entries: [{ level: "error", message: "null instance" }], next: 2 } : { entries: [], next: 1 }),
    });
    const report = await runScenario(parseScenario({ name: "e", steps: [{ assert_no_errors: true }] }), call);
    expect(report.passed).toBe(false);
    expect(report.steps[0]!.message).toContain("null instance");
  });

  it("a screenshot step without a renderer is skipped, not failed", async () => {
    const { call } = fakeBridge({
      screenshot: () => {
        throw new BridgeError("RENDERING_UNAVAILABLE", "headless");
      },
    });
    const report = await runScenario(parseScenario({ name: "s", steps: [{ screenshot: "x" }] }), call);
    expect(report.passed).toBe(true);
    expect(report.steps[0]!.status).toBe("skip");
  });

  it("named screenshots are collected", async () => {
    const { call } = fakeBridge({});
    const report = await runScenario(parseScenario({ name: "s", steps: [{ screenshot: "after" }] }), call);
    expect(report.screenshots).toEqual([{ label: "after", png_base64: "AAAA", width: 10, height: 10 }]);
  });

  it("reports a game that fails to start as an error without running steps", async () => {
    const { call, calls } = fakeBridge({
      "game.run": () => {
        throw new BridgeError("GAME_NOT_RUNNING", "exited");
      },
    });
    const report = await runScenario(parseScenario({ name: "s", steps: [{ wait_ms: 1 }] }), call);
    expect(report.passed).toBe(false);
    expect(report.setup_error).toContain("GAME_NOT_RUNNING");
    expect(report.steps[0]!.status).toBe("skipped");
    expect(calls.map(([m]) => m)).not.toContain("game.stop");
  });

  it("set and call steps drive game.set / game.call and describe themselves", async () => {
    const { call, calls } = fakeBridge({
      "game.set": () => ({ changes: {} }),
      "game.call": () => ({ returned: 7 }),
    });
    const s = parseScenario({
      name: "setup",
      steps: [
        { set: { node: "Game", properties: { sequence: "OOT", gravity_enabled: false } } },
        { call: { node: "Game", method: "restart" } },
        { call: { node: "Game", method: "add", args: [1, 2] } },
      ],
    });
    const report = await runScenario(s, call);
    expect(report.passed).toBe(true);
    expect(calls.find(([m]) => m === "game.set")![1]).toEqual({ node: "Game", properties: { sequence: "OOT", gravity_enabled: false } });
    expect(calls.filter(([m]) => m === "game.call").map(([, p]) => p)).toEqual([
      { node: "Game", method: "restart" },
      { node: "Game", method: "add", args: [1, 2] },
    ]);
    expect(report.steps.map((x) => x.target)).toEqual([
      'Game: sequence = "OOT", gravity_enabled = false',
      "Game.restart()",
      "Game.add(1, 2)",
    ]);
    expect(report.steps[2]!.detail).toEqual({ returned: 7 });
  });

  it("repeat runs its steps n times as one reported step", async () => {
    const { call, calls } = fakeBridge({ "game.input": () => ({}), "game.wait_for": () => ({ met: true, value: 1 }) });
    const s = parseScenario({
      name: "rep",
      steps: [
        { repeat: { times: 3, steps: [{ input: { key: "Right" } }, { assert: { node: "P", property: "x", op: ">", value: 0 } }] } },
        { repeat: { times: 2, steps: [{ repeat: { times: 2, steps: [{ input: { key: "Up" } }] } }] } },
      ],
    });
    const report = await runScenario(s, call);
    expect(report.passed).toBe(true);
    expect(report.steps).toHaveLength(2);
    expect(report.steps[0]!.kind).toBe("repeat");
    expect(report.steps[0]!.detail).toEqual({ iterations: 3, steps_per_iteration: 2 });
    expect(report.steps[0]!.target).toMatch(/^3× \[input key Right \(hold 50 ms\)|^3× \[key Right/);
    expect(calls.filter(([m]) => m === "game.input")).toHaveLength(3 + 4);
  });

  it("a failure inside repeat says which iteration and inner step failed", async () => {
    let n = 0;
    const { call } = fakeBridge({
      "game.input": () => ({}),
      "game.wait_for": () => {
        n++;
        if (n === 2) throw new BridgeError("ASSERTION_FAILED", "Condition x > 0 is false. Actual value: 0");
        return { met: true, value: 1 };
      },
    });
    const s = parseScenario({
      name: "rep-fail",
      steps: [{ repeat: { times: 3, steps: [{ input: { key: "Right" } }, { assert: { node: "P", property: "x", op: ">", value: 0 } }] } }],
    });
    const report = await runScenario(s, call);
    expect(report.passed).toBe(false);
    expect(report.steps[0]!.status).toBe("fail");
    expect(report.steps[0]!.message).toContain("iteration 2/3, step 2 (assert P.x > 0)");
    expect(report.steps[0]!.message).toContain("Actual value: 0");
  });

  it("rejects repeat blocks that are empty or too large", () => {
    expect(() => parseScenario({ name: "x", steps: [{ repeat: { times: 2, steps: [] } }] })).toThrowError(BridgeError);
    expect(() => parseScenario({ name: "x", steps: [{ repeat: { times: 0, steps: [{ wait_ms: 1 }] } }] })).toThrowError(BridgeError);
    expect(() =>
      parseScenario({ name: "x", steps: [{ repeat: { times: 1000, steps: [{ repeat: { times: 1000, steps: [{ wait_ms: 1 }] } }] } }] }),
    ).toThrowError(/too many/);
  });

  it("input steps support frames, inline steps and record expectations, sent to the game in one call", async () => {
    const { call, calls } = fakeBridge({ "game.input": () => ({ steps: 3, record: { summary: {} } }) });
    const s = parseScenario({
      name: "atomic",
      steps: [
        {
          input: {
            steps: [
              { set: { node: "Player", properties: { "position:y": 230 } } },
              { action: "up", hold_frames: 30 },
              { assert: { node: "Player", property: "position:y", op: "<", value: 230 } },
            ],
            record: { node: "Player", properties: ["position:y"], expect: [{ property: "position:y", stat: "min", op: ">=", value: 24 }] },
          },
        },
        { wait_for: { node: "Player", property: "position:y", op: "changed", timeout_ms: 500 } },
      ],
    });
    const report = await runScenario(s, call);
    const sent = calls.find(([m]) => m === "game.input")![1] as { steps: unknown[]; record: { expect: Array<{ stat: string }> } };
    expect(sent.steps).toHaveLength(3);
    expect(sent.record.expect[0]!.stat).toBe("min");
    expect(report.steps[0]!.target).toBe(
      'set Player: position:y = 230, up (hold 30 frames), assert Player.position:y < 230; record Player [position:y] expect min position:y >= 24',
    );
    expect(report.steps[1]!.target).toBe("Player.position:y changed");
  });

  it("pause / step steps and assert tolerance + message are forwarded", async () => {
    const { call, calls } = fakeBridge({
      "game.pause": () => ({ paused: true }),
      "game.step": () => ({ frames: 10 }),
      "game.wait_for": () => ({ met: true, value: 20 }),
    });
    const s = parseScenario({
      name: "stepping",
      steps: [
        { pause: true },
        { step: 10 },
        { assert: { node: "Player", property: "position:x", op: "==", value: 20, tolerance: 0.5, message: "moved 10 frames" } },
        { pause: false },
      ],
    });
    const report = await runScenario(s, call);
    expect(report.passed).toBe(true);
    expect(calls.filter(([m]) => m === "game.pause").map(([, p]) => p)).toEqual([{ paused: true }, { paused: false }]);
    expect(calls.find(([m]) => m === "game.step")![1]).toEqual({ frames: 10 });
    const assertCall = calls.find(([m, p]) => m === "game.wait_for" && (p as { timeout_ms?: number }).timeout_ms === 0)![1];
    expect(assertCall).toMatchObject({ tolerance: 0.5, message: "moved 10 frames" });
    expect(report.steps.map((x) => x.target)).toEqual(["pause", "step 10 frames", "Player.position:x == 20 (±0.5)", "resume"]);
  });

  it("step may carry input, and conditions may read a method's return value (#6, #7)", async () => {
    const { call, calls } = fakeBridge({
      "game.pause": () => ({ paused: true }),
      "game.step": () => ({ frames: 8 }),
      "game.wait_for": () => ({ met: true, value: "field" }),
    });
    const s = parseScenario({
      name: "stepping input",
      steps: [
        { pause: true },
        { step: { frames: 8, tap: ["rpg_right"] } },
        { assert: { node: ".", method: "summary", property: "state", op: "==", value: "field" } },
        { wait_for: { node: ".", method: "turn", op: "increased", timeout_ms: 500 } },
      ],
    });
    const report = await runScenario(s, call);
    expect(report.passed).toBe(true);
    expect(calls.find(([m]) => m === "game.step")![1]).toEqual({ frames: 8, tap: ["rpg_right"] });
    expect(calls.filter(([m]) => m === "game.wait_for")[0]![1]).toMatchObject({ method: "summary", property: "state" });
    expect(report.steps.map((x) => x.target)).toEqual([
      "pause",
      "step 8 frames (tap rpg_right)",
      '.summary():state == "field"',
      ".turn() increased",
    ]);
  });

  it("rejects conditions with neither property nor method, and bad step input", () => {
    expect(() => parseScenario({ name: "x", steps: [{ assert: { node: "P", op: "==", value: 1 } }] })).toThrow(/property/);
    expect(() => parseScenario({ name: "x", steps: [{ step: { frames: 0 } }] })).toThrow();
    expect(() => parseScenario({ name: "x", steps: [{ step: { frames: 2, hold: ["a"] } }] })).toThrow();
    expect(parseScenario({ name: "x", steps: [{ input: { steps: [{ wait_frames: 2 }], record: { node: "P", properties: ["x"], per: "physics" } } }] })).toBeTruthy();
  });

  it("keep_running leaves the game up", async () => {
    const { call, calls } = fakeBridge({});
    await runScenario(parseScenario({ name: "s", keep_running: true, steps: [{ wait_ms: 1 }] }), call);
    expect(calls.map(([m]) => m)).not.toContain("game.stop");
  });
});

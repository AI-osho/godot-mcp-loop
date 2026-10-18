import { describe, expect, it } from "vitest";
import { stepsDurationMs } from "../src/input-steps.js";

describe("stepsDurationMs (used for call timeouts)", () => {
  it("counts holds, waits, frames (with headroom) and inline waits", () => {
    expect(stepsDurationMs([{ action: "a" }])).toBe(100);
    expect(stepsDurationMs([{ action: "a", hold_ms: 500, wait_ms: 200 }])).toBe(700);
    // frames are counted at 60 Hz with 2x headroom for slow frames
    expect(stepsDurationMs([{ wait_frames: 60 }])).toBe(2000);
    expect(stepsDurationMs([{ action: "a", hold_frames: 30 }])).toBe(1000);
    expect(stepsDurationMs([{ wait_for: { node: "P", property: "x", op: ">", value: 1, timeout_ms: 3000 } }])).toBe(3000);
    expect(stepsDurationMs([{ wait_for: { node: "P", property: "x", op: ">", value: 1 } }])).toBe(5000);
    expect(stepsDurationMs([{ call: { node: "G", method: "m" } }])).toBe(10_000);
    expect(stepsDurationMs([{ set: { node: "G", properties: { a: 1 } } }, { assert: { node: "G", property: "a", op: "==", value: 1 } }])).toBe(0);
  });
});

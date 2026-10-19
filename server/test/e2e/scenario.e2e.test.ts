import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectClient } from "../helpers.js";
import { PLATFORMER_PROJECT, startHeadlessEditor, WINDOWED, type GodotHarness } from "./godot-harness.js";

describe("e2e: scenario_run against the platformer", () => {
  let h: GodotHarness;
  let client: Client;

  async function run(args: Record<string, unknown>): Promise<{ summary: string; report: any; images: number }> {
    const res = await client.callTool({ name: "scenario_run", arguments: { report: "full", ...args } });
    const content = res.content as Array<{ type: string; text?: string }>;
    if (res.isError) throw new Error(content[0]?.text);
    return {
      summary: content[0]!.text!,
      report: JSON.parse(content[1]!.text!),
      images: content.filter((c) => c.type === "image").length,
    };
  }

  beforeAll(async () => {
    h = await startHeadlessEditor(PLATFORMER_PROJECT);
    client = await connectClient(h.conn);
  }, 120_000);
  afterAll(async () => {
    await client?.close();
    await h?.stop();
  });

  it("move_right.yaml passes", async () => {
    const { summary, report, images } = await run({ path: "res://examples/platformer/scenarios/move_right.yaml" });
    expect(summary, summary).toMatch(/PASSED/);
    expect(report.steps.map((s: any) => s.status)).toEqual(["pass", "pass", "pass", "pass", "pass", WINDOWED ? "pass" : "skip", "pass"]);
    expect(images).toBe(WINDOWED ? 1 : 0);
    expect((await h.conn.call("editor.status")) as any).toMatchObject({ playing: false });
  }, 60_000);

  it.skipIf(!WINDOWED)("match_screenshot creates a baseline and fails when the screen changes", async () => {
    const scenario = {
      name: "match",
      scene: "main",
      steps: [
        { match_screenshot: { baseline: "res://qa/baselines/start.png" } },
        { set: { node: "Player", properties: { "position:x": 640 } } },
        { match_screenshot: { baseline: "res://qa/baselines/start.png", tolerance: 0 } },
      ],
    };
    const { summary, report } = await run({ scenario });
    expect(summary).toMatch(/FAILED/);
    expect(report.steps[0].status).toBe("pass");
    expect(report.steps[0].detail.created).toBe(true);
    expect(report.steps[2].status).toBe("fail");
    expect(report.steps[2].message).toContain("Screenshot differs");
    expect(report.screenshots.some((s: any) => s.label.startsWith("diff "))).toBe(true);
    expect(existsSync(join(h.projectPath, "qa/baselines/start.png"))).toBe(true);
  }, 120_000);

  it("a folder runs every scenario in name order with one summary (#8)", async () => {
    const res = await client.callTool({ name: "scenario_run", arguments: { path: "res://examples/platformer/scenarios" } });
    const content = res.content as Array<{ type: string; text?: string }>;
    expect(res.isError).toBeFalsy();
    const text = content[0]!.text!;
    expect(text.split("\n")[0], text).toMatch(/^Scenarios: 1\/2 passed/);
    expect(text.indexOf("intentional_failure.yaml")).toBeLessThan(text.indexOf("move_right.yaml"));
    expect(text).toMatch(/Condition position:x > 600(\.0)? is false/);
    expect(content.filter((c) => c.type === "image").length).toBe(WINDOWED ? 1 : 0); // only the failure screenshot
    expect((await h.conn.call("editor.status")) as any).toMatchObject({ playing: false });
  }, 120_000);

  it("intentional_failure.yaml fails at the assert with the observed value", async () => {
    const { summary, report } = await run({ path: "res://examples/platformer/scenarios/intentional_failure.yaml" });
    expect(summary).toMatch(/FAILED/);
    expect(report.steps.map((s: any) => s.status)).toEqual(["pass", "pass", "fail", "skipped"]);
    expect(report.steps[2].message).toMatch(/^ASSERTION_FAILED: Condition position:x > 600(\.0)? is false\. Actual value: \d+/);
    expect(report.steps[2].target).toBe("Player.position:x > 600");
    expect(report.failure_screenshot?.label ?? "failure at step 3 (assert)").toBe("failure at step 3 (assert)");
  }, 60_000);

  it("assert_no_errors catches a runtime script error", async () => {
    const { summary, report } = await run({
      scenario: {
        name: "error scene is clean",
        scene: "res://examples/fixtures/error_scene.tscn",
        steps: [{ wait_ms: 800 }, { assert_no_errors: true }],
      },
    });
    expect(summary).toMatch(/FAILED/);
    expect(report.steps[1].message).toMatch(/error/i);
    expect(report.errors.length).toBeGreaterThan(0);
  }, 60_000);

  it("set, call and repeat steps work against the real game", async () => {
    const { summary, report } = await run({
      scenario: {
        name: "setup and repeat",
        steps: [
          { wait_for: { node: "Player", property: "position:y", op: ">=", value: 370, timeout_ms: 5000 } },
          { set: { node: "Player", properties: { "position:x": 500 } } },
          { assert: { node: "Player", property: "position:x", op: ">=", value: 499 } },
          {
            repeat: {
              times: 2,
              steps: [
                { input: { action: "jump", hold_ms: 50 } },
                { wait_for: { node: "Player", property: "position:y", op: "<", value: 360, timeout_ms: 2000 } },
                { wait_for: { node: "Player", property: "position:y", op: ">=", value: 370, timeout_ms: 3000 } },
              ],
            },
          },
          { assert: { node: "Player", property: "jumps", op: "==", value: 2 } },
          { call: { node: "Player", method: "get_position" } },
        ],
      },
      include_screenshots: false,
    });
    expect(summary, summary).toMatch(/PASSED/);
    expect(report.steps).toHaveLength(6);
    expect(report.steps[3].detail).toEqual({ iterations: 2, steps_per_iteration: 3 });
    expect(report.steps[5].detail.returned[0]).toBeGreaterThan(499);
  }, 90_000);
});

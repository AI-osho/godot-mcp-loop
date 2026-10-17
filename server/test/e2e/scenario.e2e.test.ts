import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectClient } from "../helpers.js";
import { PLATFORMER_PROJECT, startHeadlessEditor, WINDOWED, type GodotHarness } from "./godot-harness.js";

describe("e2e: scenario_run against the platformer", () => {
  let h: GodotHarness;
  let client: Client;

  async function run(args: Record<string, unknown>): Promise<{ summary: string; report: any; images: number }> {
    const res = await client.callTool({ name: "scenario_run", arguments: args });
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
});

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectClient, jsonOf } from "../helpers.js";
import { startHeadlessEditor, type GodotHarness } from "./godot-harness.js";

/** A scene with the four layout problems the audit exists for; it needs no renderer, so this runs headless. */
const UI_SCENE = `[gd_scene format=3]

[node name="Ui" type="Control"]
anchor_right = 1.0
anchor_bottom = 1.0

[node name="Zero" type="Control" parent="."]

[node name="Far" type="Label" parent="."]
offset_left = 2000.0
offset_top = 2000.0
offset_right = 2100.0
offset_bottom = 2040.0
text = "far away"

[node name="Panel" type="Panel" parent="."]
offset_left = 80.0
offset_top = 200.0
offset_right = 180.0
offset_bottom = 220.0

[node name="Tight" type="Label" parent="Panel"]
text = "a rather long label that cannot fit"

[node name="A" type="Label" parent="."]
offset_left = 100.0
offset_top = 100.0
offset_right = 300.0
offset_bottom = 140.0
text = "AAAA"

[node name="B" type="Label" parent="."]
offset_left = 150.0
offset_top = 110.0
offset_right = 350.0
offset_bottom = 150.0
text = "BBBB"
`;

describe("e2e: game_ui_audit", () => {
  let h: GodotHarness;
  let client: Client;

  beforeAll(async () => {
    h = await startHeadlessEditor({
      extraFiles: { "ui.tscn": UI_SCENE },
      applicationExtra: ['run/main_scene="res://ui.tscn"'],
      projectGodotExtra: ["[editor]", "", 'run/main_run_args="--headless"', ""].join("\n"),
    });
    client = await connectClient(h.conn);
  }, 120_000);
  afterAll(async () => {
    await client?.close();
    await h?.stop();
  });

  it("reports zero size, out-of-viewport, clipped text and overlapping labels", async () => {
    const run = await client.callTool({ name: "game_run", arguments: {} });
    expect(run.isError).toBeFalsy();
    const audit = jsonOf(await client.callTool({ name: "game_ui_audit", arguments: {} })) as {
      viewport: number[];
      controls: number;
      issues: Array<{ path: string; issue: string }>;
      overlaps: Array<{ a: string; b: string }>;
      tree: Array<{ path: string; rect: number[] }>;
    };
    const found = audit.issues.map((i) => `${i.path}:${i.issue}`);
    expect(found).toContain("Zero:zero_size");
    expect(found).toContain("Far:outside");
    expect(found).toContain("Panel/Tight:escapes_parent");
    expect(audit.viewport).toEqual([1152, 648]);
    expect(audit.controls).toBeGreaterThanOrEqual(5);
    expect(audit.overlaps.map((o) => [o.a, o.b].sort().join("+"))).toContain("A+B");
    expect(audit.tree.some((c) => c.path === "Panel/Tight" && (c.rect[2] ?? 0) > 200)).toBe(true); // wider than its panel
    await client.callTool({ name: "game_stop", arguments: {} });
  }, 60_000);

  it("can list hidden Controls on request", async () => {
    await client.callTool({ name: "game_run", arguments: {} });
    await client.callTool({ name: "game_set", arguments: { node: "B", properties: { visible: false } } });
    const withHidden = jsonOf(await client.callTool({ name: "game_ui_audit", arguments: { include_hidden: true } })) as {
      tree: Array<{ path: string }>;
    };
    const without = jsonOf(await client.callTool({ name: "game_ui_audit", arguments: {} })) as { tree: Array<{ path: string }> };
    expect(withHidden.tree.some((c) => c.path === "B")).toBe(true);
    expect(without.tree.some((c) => c.path === "B")).toBe(false);
    await client.callTool({ name: "game_stop", arguments: {} });
  }, 60_000);
});

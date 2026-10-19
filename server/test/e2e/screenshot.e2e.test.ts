import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectClient, textOf } from "../helpers.js";
import { startHeadlessEditor, WINDOWED, type GodotHarness } from "./godot-harness.js";

/**
 * A game window that is smaller than the project viewport (960×540 window, 1152×648 viewport, stretch
 * canvas_items) is the case that made repeated screenshots differ in size. With a window, the capture must come
 * back at the viewport size and say where it came from; headless has nothing to capture, so this file is skipped.
 */
describe.skipIf(!WINDOWED)("e2e: screenshot size", () => {
  let h: GodotHarness;
  let client: Client;

  beforeAll(async () => {
    h = await startHeadlessEditor({
      extraFiles: {
        "main.tscn": '[gd_scene format=3]\n\n[node name="Main" type="Node2D"]\n',
      },
      applicationExtra: ['run/main_scene="res://main.tscn"'],
      projectGodotExtra: [
        "[display]",
        "",
        "window/size/viewport_width=1152",
        "window/size/viewport_height=648",
        "window/size/window_width_override=960",
        "window/size/window_height_override=540",
        'window/stretch/mode="canvas_items"',
        "",
      ].join("\n"),
    });
    client = await connectClient(h.conn);
  }, 120_000);

  afterAll(async () => {
    await client?.close();
    await h?.stop();
  });

  it("captures at the project viewport size and reports the window it came from", async () => {
    await client.callTool({ name: "game_run", arguments: {} });
    const res = await client.callTool({ name: "screenshot", arguments: {} });
    expect(res.isError).toBeFalsy();
    const text = textOf(res);
    expect(text).toContain("game screenshot 1152x648");
    expect(text).toContain("window 960x540");
    await client.callTool({ name: "game_stop", arguments: {} });
  }, 60_000);
});

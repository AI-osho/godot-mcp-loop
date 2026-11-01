import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectClient, jsonOf, textOf } from "../helpers.js";
import { startHeadlessEditor, type GodotHarness } from "./godot-harness.js";

// Controlled native scheduling, not evidence of a historical OS schedule.
// The extra replacement method performs the same native stop/play as an editor user;
// it deliberately bypasses the MCP lifecycle entrypoints under test.
describe("e2e: native game lifecycle ownership", () => {
  let h: GodotHarness, client: Client;
  async function ok(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
    expect(r.isError, `${name}: ${textOf(r)}`).toBeFalsy();
    return jsonOf(r);
  }
  async function marker(value: string, start: number): Promise<void> {
    const deadline = Date.now() + 15000;
    while (!h.output.slice(start).some(x => x.includes(value)) && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
    expect(h.output.slice(start).some(x => x.includes(value)), value).toBe(true);
  }
  beforeAll(async () => {
    let source = readFileSync(new URL("../../../addons/mcp_loop/commands/play_commands.gd", import.meta.url), "utf8");
    const run = "\tvar started_at := Time.get_ticks_msec()\n";
    const stop = '\t\tvar r: Dictionary = await dbg.call_runtime(tree, "quit", {}, 3000)\n';
    const registration = '\trouter.register("game.run", _run)\n';
    for (const signature of [run, stop, registration]) expect(source.split(signature)).toHaveLength(2);
    source = source.replace(run, '\tprint("CONTROLLED_LIFECYCLE_RUN_WAIT")\n\tawait tree.create_timer(1.0, true).timeout\n' + run)
      .replace(stop, stop + '\t\tprint("CONTROLLED_LIFECYCLE_STOP_WAIT")\n\t\tawait tree.create_timer(1.0, true).timeout\n')
      .replace(registration, registration + '\trouter.register("test.lifecycle_replace", _fixture_replace)\n');
    source += `
func _fixture_replace(_p: Dictionary) -> Dictionary:
\tif EditorInterface.is_playing_scene():
\t\tEditorInterface.stop_playing_scene()
\tawait _wait_until(func() -> bool: return not EditorInterface.is_playing_scene(), 5000)
\tEditorInterface.play_custom_scene("res://lifecycle-second.tscn")
\tawait _wait_until(func() -> bool: return dbg.ready, 5000)
\treturn Protocol.ok({"ready": dbg.ready, "scene": dbg.runtime_info.get("scene")})
`;
    h = await startHeadlessEditor({ projectGodotExtra: '[editor]\nrun/main_run_args="--headless"\n', extraFiles: {
      "addons/mcp_loop/commands/play_commands.gd": source,
      "lifecycle-first.tscn": '[gd_scene format=3]\n[node name="First" type="Node2D"]\n',
      "lifecycle-second.tscn": '[gd_scene format=3]\n[node name="Second" type="Node2D"]\n',
    } });
    client = await connectClient(h.conn);
  });
  afterAll(async () => { await client?.close(); await h?.stop(); });

  it("refuses a competing restart without attributing its game to the first run", async () => {
    try {
      const start = h.output.length;
      const first = client.callTool({ name: "game_run", arguments: { scene: "res://lifecycle-first.tscn" } }, undefined, { timeout: 180000 });
      await marker("CONTROLLED_LIFECYCLE_RUN_WAIT", start);
      const second = await client.callTool({ name: "game_run", arguments: { scene: "res://lifecycle-second.tscn", restart: true } }, undefined, { timeout: 180000 });
      const own = await first;
      expect(own.isError, textOf(own)).toBeFalsy();
      expect(jsonOf(own).scene).toBe("res://lifecycle-first.tscn");
      expect(second.isError, textOf(second)).toBe(true);
      expect(textOf(second)).toContain("BUSY");
      const later = await ok("game_run", { scene: "res://lifecycle-second.tscn", restart: true });
      expect(later.scene).toBe("res://lifecycle-second.tscn");
    } finally { await ok("game_stop"); }
  });

  it("does not return a replacement editor-launched game as its own launch", async () => {
    try {
      const start = h.output.length;
      const first = client.callTool({ name: "game_run", arguments: { scene: "res://lifecycle-first.tscn" } }, undefined, { timeout: 180000 });
      await marker("CONTROLLED_LIFECYCLE_RUN_WAIT", start);
      expect(((await h.conn.call("test.lifecycle_replace", {}, { timeoutMs: 15000 })) as { ready: boolean }).ready).toBe(true);
      const response = await first;
      expect(response.isError, textOf(response)).toBe(true);
      expect(textOf(response)).toMatch(/BUSY|changed|replaced/i);
      const current = await ok("godot_status");
      expect(current.playing).toBe(true);
      expect(current.game.scene).toBe("res://lifecycle-second.tscn");
    } finally { await ok("game_stop"); }
  });

  it("does not force-stop a successor started during graceful-stop continuation", async () => {
    try {
      await ok("game_run", { scene: "res://lifecycle-first.tscn" });
      const start = h.output.length;
      // Graceful shutdown is an internal native path used by recording, not a public game_stop argument.
      const stopping = h.conn.call("game.stop", { graceful: true }, { timeoutMs: 20000 }).then(
        value => ({ value, error: undefined }), error => ({ value: undefined, error }));
      await marker("CONTROLLED_LIFECYCLE_STOP_WAIT", start);
      expect(((await h.conn.call("test.lifecycle_replace", {}, { timeoutMs: 15000 })) as { ready: boolean }).ready).toBe(true);
      const response = await stopping;
      expect(response.error, JSON.stringify(response.value)).toBeDefined();
      expect(String(response.error)).toMatch(/BUSY|changed|replaced/i);
      const current = await ok("godot_status");
      expect(current.playing).toBe(true);
      expect(current.game.scene).toBe("res://lifecycle-second.tscn");
    } finally { await ok("game_stop"); }
  });
});

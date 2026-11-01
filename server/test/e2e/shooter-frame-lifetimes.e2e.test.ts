import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectClient, jsonOf, textOf } from "../helpers.js";
import { startHeadlessEditor, type GodotHarness } from "./godot-harness.js";

// Independent frame oracles for the sample's documented rules. Scenario-call latency
// must not masquerade as an early explosion removal or invulnerability expiry.
// These use the real runtime recorder, unchanged sample script and physics ticks.
describe.skipIf(process.env.E2E_SAMPLES !== "1")("e2e: shooter native frame lifetimes", () => {
  let h: GodotHarness, client: Awaited<ReturnType<typeof connectClient>>;
  beforeAll(async () => {
    h = await startHeadlessEditor({ copyDirs: ["examples"], repoProjectGodot: true, projectGodotExtra: '[editor]\nrun/main_run_args="--headless"\n' });
    client = await connectClient(h.conn);
  });
  afterAll(async () => { await client?.close(); await h?.stop(); });
  async function ok(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 });
    expect(response.isError, textOf(response)).toBeFalsy();
    return jsonOf(response);
  }
  const start = () => ok("game_run", { scene: "res://examples/shooter/shooter.tscn", restart: true });

  it("keeps an explosion for exactly20 physics ticks", async () => {
    await start();
    try {
      const result = await ok("game_input", { steps: [
        { set: { node: ".", properties: { waves_enabled: false, rng_seed: 1 } } },
        { action: "shooter_start", hold_ms: 100, wait_ms: 50 },
        { call: { node: ".", method: "spawn_enemy", args: ["a",128,110] } },
        { action: "shooter_fire", hold_ms: 60 }, { wait_frames: 90 },
      ], record: { node: ".", per: "physics", mode: "changes", properties: ["kills","explosions_spawned","explosion_count"] }, pause_at_end: true });
      expect(result.record.summary.kills.max).toBe(1);
      expect(result.record.summary.explosion_count.max).toBe(1);
      expect(result.record.summary.explosion_count.last).toBe(0);
      const appeared = result.record.samples.find((s: any) => s.explosion_count === 1);
      const gone = result.record.samples.find((s: any) => appeared && s.frame > appeared.frame && s.explosion_count === 0);
      expect(appeared).toBeDefined(); expect(gone).toBeDefined();
      expect(gone.frame - appeared.frame).toBe(20);
    } finally { await ok("game_stop"); }
  },180_000);

  it("prevents a second hit for exactly120 physics ticks", async () => {
    await start();
    try {
      const result = await ok("game_input", { steps: [
        { set: { node: ".", properties: { waves_enabled: false } } },
        { action: "shooter_start", hold_ms: 100, wait_ms: 50 },
        { set: { node: "Player", properties: { position: [60,120] } } },
        { call: { node: ".", method: "spawn_enemy_bullet", args: [60,120,0,0] } },
        { call: { node: ".", method: "spawn_enemy_bullet", args: [60,120,0,0] } },
        { wait_frames: 150 },
      ], record: { node: ".", per: "physics", mode: "changes", properties: ["lives","hits_taken","enemy_bullet_count"] }, pause_at_end: true });
      const first = result.record.samples.find((s: any) => s.hits_taken === 1);
      const second = result.record.samples.find((s: any) => s.hits_taken === 2);
      expect(first).toBeDefined(); expect(second).toBeDefined();
      expect(second.frame - first.frame).toBe(120);
    } finally { await ok("game_stop"); }
  },180_000);
});

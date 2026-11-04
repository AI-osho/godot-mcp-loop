import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectClient, textOf } from "../helpers.js";
import { startHeadlessEditor, windowedGameSettings, type GodotHarness } from "./godot-harness.js";

const ENABLED = process.env.E2E_SAMPLES === "1" && (process.platform === "darwin" || process.env.E2E_GAME_WINDOW === "1");
type State = { state: string; paused: boolean; wave: number; coins: number; kills: number; base_health: number; tower_count: number; ticks: number; active_ticks: number; selected_tower: string; enemies: number; projectiles: number };

describe.skipIf(!ENABLED)("e2e: tower-defense ordinary mouse route", () => {
  let h: GodotHarness;
  beforeAll(async () => {
    h = await startHeadlessEditor({ copyDirs: ["examples"], repoProjectGodot: true, projectGodotExtra: windowedGameSettings() });
  });
  afterAll(async () => { await h?.stop(); });

  it("wins, pauses, retries, loses without towers and quits through ordinary Controls", async () => {
    const client = await connectClient(h.conn);
    const evidence = process.env.E2E_SAMPLES_OUT ? join(process.env.E2E_SAMPLES_OUT, "tower-defense-route") : undefined;
    if (evidence) mkdirSync(evidence, { recursive: true });
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 });
      expect(result.isError, `${name}: tool refusal`).toBeFalsy();
      return JSON.parse(textOf(result));
    };
    const summary = async (): Promise<State> => (await call("game_call", { node: ".", method: "summary" })).returned as State;
    const click = async (x: number, y: number) => { await call("game_input", { steps: [{ mouse_click: [x, y] }] }); };
    const until = async (predicate: (state: State) => boolean, label: string, timeout = 45_000): Promise<State> => {
      const deadline = performance.now() + timeout;
      do {
        const state = await summary();
        if (predicate(state)) return state;
        await new Promise((resolve) => setTimeout(resolve, 150));
      } while (performance.now() < deadline);
      throw new Error(`Ordinary input checkpoint not reached: ${label}`);
    };
    const capture = async (label: string) => {
      if (!evidence) return;
      const result = CallToolResultSchema.parse(await client.callTool({ name: "screenshot", arguments: { target: "game", max_width: 960, normalize: "none" } }));
      // This sample owns a960x640 Window; the repository's1152x648 project normalization would stretch it.
      expect(textOf(result)).toContain("960x640");
      expect(result.isError).toBeFalsy();
      const image = result.content.find((item) => item.type === "image");
      expect(image?.type).toBe("image");
      if (image?.type === "image") writeFileSync(join(evidence, label + ".png"), Buffer.from(image.data, "base64"));
    };
    const reset = (state: State) => {
      expect({ wave: state.wave, coins: state.coins, hp: state.base_health, towers: state.tower_count, kills: state.kills, selected: state.selected_tower, paused: state.paused })
        .toEqual({ wave: 0, coins: 140, hp: 8, towers: 0, kills: 0, selected: "none", paused: false });
    };
    try {
      await call("game_run", { scene: "res://examples/tower-defense/scenes/title.tscn" });
      await until((state) => state.state === "title", "title");
      await capture("title");
      await click(735, 478);
      reset(await until((state) => state.state === "ready", "start"));
      await click(844, 177); await click(162, 248); await click(328, 360);
      await click(844, 307); await click(328, 260);
      expect((await summary()).tower_count).toBe(3);
      await click(844, 477);
      await call("game_input", { steps: [{ wait_ms: 1500 }] });
      await click(880, 37);
      const paused = await summary();
      expect(paused.paused).toBe(true);
      await capture("paused");
      await click(844, 477);
      await call("game_input", { steps: [{ wait_ms: 400 }] });
      const frozen = await summary();
      for (const key of ["ticks", "active_ticks", "coins", "tower_count", "kills", "base_health", "projectiles", "enemies"] as const) expect(frozen[key], key).toBe(paused[key]);
      await click(364, 390);
      expect((await summary()).paused).toBe(false);
      const first = await until((state) => state.state === "ready" && state.wave === 1, "first wave");
      expect(first.coins).toBe(85); expect(first.base_health).toBe(8);
      await click(844, 177); await click(546, 360); await click(844, 477);
      const second = await until((state) => state.state === "ready" && state.wave === 2, "second wave");
      expect(second.kills).toBe(14); expect(second.base_health).toBe(8);
      await click(580, 200); await click(584, 478); await click(844, 477);
      await call("game_input", { steps: [{ wait_ms: 2000 }] }); await capture("third-wave");
      const victory = await until((state) => state.state === "victory", "victory", 60_000);
      expect({ wave: victory.wave, hp: victory.base_health, kills: victory.kills, towers: victory.tower_count }).toEqual({ wave: 3, hp: 8, kills: 24, towers: 6 });
      await capture("victory");
      await click(341, 483); reset(await until((state) => state.state === "ready", "victory retry"));
      await click(844, 477);
      const unbuilt = await until((state) => state.state === "ready" && state.wave === 1, "unbuilt first wave");
      expect(unbuilt.base_health).toBe(2); expect(unbuilt.kills).toBe(0);
      await click(844, 477);
      const defeat = await until((state) => state.state === "defeat", "defeat");
      expect(defeat.base_health).toBe(0); expect(defeat.tower_count).toBe(0);
      await capture("defeat");
      await click(341, 483); reset(await until((state) => state.state === "ready", "defeat retry"));
      await click(880, 37); await click(596, 390); await until((state) => state.state === "title", "return title");
      await click(735, 541);
      const deadline = performance.now() + 8000;
      let stopped = false;
      do {
        if (!(await call("godot_status")).playing) { stopped = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 100));
      } while (performance.now() < deadline);
      expect(stopped).toBe(true);
      const logs = await call("logs_read", { source: "game", min_level: "warning", limit: 2000 });
      expect(logs.entries).toEqual([]);
      if (evidence) writeFileSync(join(evidence, "result.json"), JSON.stringify({ passed: true, ordinary_mouse_victory: true, ordinary_mouse_defeat: true, pause_frozen: true, retry_reset: true, normal_quit: true, direct_game_state_writes: 0, human_acceptance: false }, null, 2) + "\n");
    } finally { await client.close(); }
  }, 200_000);
});

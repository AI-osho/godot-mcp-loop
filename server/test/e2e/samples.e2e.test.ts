import { cpSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectClient, textOf } from "../helpers.js";
import { startHeadlessEditor, windowedGameSettings, type GodotHarness } from "./godot-harness.js";

/**
 * The sample games' regression scenarios (examples/*\/scenarios) against a real editor. They take screenshots, so the
 * games need a window: run with E2E_SAMPLES=1 on macOS, or with E2E_GAME_WINDOW=1 under xvfb (CI job "samples").
 * E2E_SAMPLES_OUT=<folder> keeps the evidence (CI uploads it as an artifact).
 */
const ENABLED = process.env.E2E_SAMPLES === "1" && (process.platform === "darwin" || process.env.E2E_GAME_WINDOW === "1");

const SAMPLES: Array<{ name: string; path: string; count: number }> = [
  { name: "platformer", path: "res://examples/platformer/scenarios/move_right.yaml", count: 1 },
  { name: "blocks", path: "res://examples/blocks/scenarios", count: 4 },
  { name: "shooter", path: "res://examples/shooter/scenarios", count: 4 },
  { name: "action", path: "res://examples/action/scenarios", count: 4 },
  { name: "rpg", path: "res://examples/rpg/scenarios", count: 6 },
];

describe.skipIf(!ENABLED)("e2e: sample games' scenarios", () => {
  let h: GodotHarness;

  beforeAll(async () => {
    h = await startHeadlessEditor({ copyDirs: ["examples"], repoProjectGodot: true, projectGodotExtra: windowedGameSettings() });
  });
  afterAll(async () => {
    await h?.stop();
  });

  const keep = (name: string) => {
    if (process.env.E2E_SAMPLES_OUT) cpSync(join(h.projectPath, "qa", name), join(process.env.E2E_SAMPLES_OUT, name), { recursive: true });
  };

  it.each(SAMPLES)("$name: all $count scenarios pass", async ({ name, path, count }) => {
    const client = await connectClient(h.conn);
    try {
      const res = await client.callTool(
        { name: "scenario_run", arguments: { path, save_to: `res://qa/${name}` } },
        undefined,
        { timeout: 600_000 },
      );
      const text = textOf(res);
      expect(res.isError, text).toBeFalsy();
      if (count === 1) expect(text, text).toMatch(/: PASSED/);
      else expect(text.split("\n")[0], text).toMatch(new RegExp(`^Scenarios: ${count}/${count} passed`));
      keep(name);
    } finally {
      await client.close();
    }
  }, 600_000);

  it("shooter boss fight as a movie", async () => {
    const client = await connectClient(h.conn);
    try {
      const res = await client.callTool(
        {
          name: "scenario_run",
          arguments: { path: "res://examples/shooter/scenarios/4_boss_clear.yaml", save_to: "res://qa/shooter-movie", movie: { fps: 30 } },
        },
        undefined,
        { timeout: 600_000 },
      );
      const text = textOf(res);
      expect(text, text).toMatch(/: PASSED/);
      expect(text).toMatch(/Movie: \d+ frames at 30 fps .*movie\.gif/);
      keep("shooter-movie");
    } finally {
      await client.close();
    }
  }, 600_000);
});

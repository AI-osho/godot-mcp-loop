import { cpSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodePng } from "../../src/media/png.js";
import { connectClient, textOf } from "../helpers.js";
import { PLATFORMER_PROJECT, startHeadlessEditor, windowedGameSettings, type GodotHarness } from "./godot-harness.js";

/** Movie Maker needs a game window: runs on macOS, or elsewhere with E2E_GAME_WINDOW=1 (e.g. under xvfb). */
const CAN_RECORD = process.platform === "darwin" || process.env.E2E_GAME_WINDOW === "1";

describe.skipIf(!CAN_RECORD)("e2e: scenario_run movie (Movie Maker → GIF + contact sheet)", () => {
  let h: GodotHarness;

  beforeAll(async () => {
    // The platformer, with its games in a window (no --headless in Main Run Args).
    h = await startHeadlessEditor({
      ...PLATFORMER_PROJECT,
      projectGodotExtra: PLATFORMER_PROJECT.projectGodotExtra!.replace(/\[editor\][\s\S]*$/, "") + windowedGameSettings(),
    });
  });
  afterAll(async () => {
    await h?.stop();
  });

  it("records a run, saves movie.gif and contact.png, and leaves the project's settings alone", async () => {
    const client = await connectClient(h.conn);
    const scenario = {
      name: "walk and jump",
      steps: [
        { wait_for: { node: "Player", property: "position:y", op: ">=", value: 370, timeout_ms: 5000 } },
        { input: { action: "move_right", hold_frames: 40 } },
        { input: [{ action: "jump", press: true }, { wait_frames: 12 }, { action: "jump", release: true }, { wait_frames: 30 }] },
      ],
    };
    const res = await client.callTool(
      { name: "scenario_run", arguments: { scenario, save_to: "res://qa/movie", movie: { fps: 30, contact_sheet: 8 } } },
      undefined,
      { timeout: 120_000 },
    );
    const text = textOf(res);
    expect(res.isError, text).toBeFalsy();
    expect(text, text).toMatch(/Scenario "walk and jump": PASSED/);
    expect(text).toMatch(/Movie: \d+ frames at 30 fps .*→ movie\.gif \d+×\d+, \d+ frames at 15 fps .*contact\.png \(8 frames\)/);
    const frames = Number(/Movie: (\d+) frames/.exec(text)![1]);
    expect(frames).toBeGreaterThan(30); // 82 physics frames of input at 60 Hz alone are ~41 frames at 30 fps

    const gif = readFileSync(join(h.projectPath, "qa/movie/movie.gif"));
    expect(gif.subarray(0, 6).toString("latin1")).toBe("GIF89a");
    const sheet = decodePng(readFileSync(join(h.projectPath, "qa/movie/contact.png")));
    // Not blank: the frames have more than a couple of colours.
    const colours = new Set<number>();
    for (let i = 0; i < sheet.data.length; i += 4 * 7) colours.add((sheet.data[i]! << 16) | (sheet.data[i + 1]! << 8) | sheet.data[i + 2]!);
    expect(colours.size).toBeGreaterThan(4);
    const image = (res.content as Array<{ type: string }>).filter((c) => c.type === "image");
    expect(image).toHaveLength(1);

    // The Movie Maker settings were only set for this run.
    const godot = readFileSync(join(h.projectPath, "project.godot"), "utf8");
    expect(godot).not.toContain("movie_writer");
    const status = JSON.parse(textOf(await client.callTool({ name: "godot_status", arguments: {} })));
    expect(status.playing).toBe(false);
    expect(existsSync(join(h.projectPath, "qa/movie/report.md"))).toBe(true);
    // E2E_MOVIE_OUT=<folder> keeps the evidence for a look (CI uploads it as an artifact).
    if (process.env.E2E_MOVIE_OUT) cpSync(join(h.projectPath, "qa/movie"), process.env.E2E_MOVIE_OUT, { recursive: true });
    await client.close();
  }, 150_000);
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodePng, encodePng, type RgbaImage } from "../src/media/png.js";
import { contactIndices, gifPlan, listFrames, makeMovie } from "../src/media/movie.js";
import { readGif } from "./gif-reader.js";

/** A 64×32 frame: dark background with a 8×8 yellow square at x = 4 * n. */
function frame(n: number): RgbaImage {
  const w = 64, h = 32;
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([20, 20, 40, 255], i * 4);
  for (let y = 12; y < 20; y++) for (let x = 4 * n; x < 4 * n + 8 && x < w; x++) data.set([255, 220, 0, 255], (y * w + x) * 4);
  return { width: w, height: h, data };
}

describe("movie frames → GIF and contact sheet", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gml-movie-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (count: number, truncatedLast = false) => {
    for (let n = 0; n < count; n++) writeFileSync(join(dir, `frame${String(n).padStart(8, "0")}.png`), encodePng(frame(n)));
    if (truncatedLast) writeFileSync(join(dir, `frame${String(count).padStart(8, "0")}.png`), encodePng(frame(count)).subarray(0, 40));
    writeFileSync(join(dir, "frame.wav"), "RIFF");
    writeFileSync(join(dir, "notes.txt"), "not a frame");
  };

  it("lists frame files in number order and ignores everything else", () => {
    write(12);
    const files = listFrames(dir);
    expect(files).toHaveLength(12);
    expect(files[0]).toMatch(/frame00000000\.png$/);
    expect(files[11]).toMatch(/frame00000011\.png$/);
  });

  it("plans GIF frames at the requested rate with delays that keep real time", () => {
    // 30 fps recording, 15 fps GIF: every second frame, ~6.67 cs each (7, 7, 6, ...).
    const p = gifPlan(10, 30, 15);
    expect(p.indices).toEqual([0, 2, 4, 6, 8]);
    expect(p.delaysCs.reduce((a, b) => a + b, 0)).toBe(33);
    expect(p.fps).toBe(15);
    // Too many frames: thinned to the cap.
    const long = gifPlan(3000, 60, 30, 300);
    expect(long.indices.length).toBeLessThanOrEqual(300);
    expect(long.delaysCs.reduce((a, b) => a + b, 0)).toBe(5000);
    // A GIF rate above the recording rate uses every frame.
    expect(gifPlan(4, 10, 50).indices).toEqual([0, 1, 2, 3]);
  });

  it("spreads contact sheet frames evenly from the first to the last", () => {
    expect(contactIndices(100, 5)).toEqual([0, 25, 50, 74, 99]);
    expect(contactIndices(3, 12)).toEqual([0, 1, 2]);
    expect(contactIndices(1, 4)).toEqual([0]);
  });

  it("makes a looping GIF and a labelled contact sheet; a cut-off last frame is skipped", () => {
    write(16, true);
    const m = makeMovie(dir, { fps: 30, gifFps: 15, maxWidth: 32, contactFrames: 4 });
    expect(m).toMatchObject({ total: 17, unreadable: 1, fps: 30 });
    expect(m.seconds).toBeCloseTo(16 / 30, 2);
    const gif = readGif(m.gif!.data);
    expect([gif.width, gif.height, gif.loop]).toEqual([32, 16, 0]);
    expect(m.gif).toMatchObject({ width: 32, height: 16, frames: 8, fps: 15 });
    expect(gif.frames).toHaveLength(8);
    // The square moved: frame 0 has it at the left edge, the last frame further right.
    const yellow = (f: number, x: number) => {
      const c = gif.palette[gif.frames[f]!.indices[8 * 32 + x]!]!;
      return c[0]! > 200 && c[1]! > 150 && c[2]! < 80;
    };
    expect(yellow(0, 1)).toBe(true);
    expect(yellow(7, 1)).toBe(false);
    const sheet = decodePng(m.contact!.data);
    expect(m.contact).toMatchObject({ frames: 4, width: sheet.width, height: sheet.height });
  });

  it("can skip the GIF or the contact sheet", () => {
    write(4);
    const m = makeMovie(dir, { fps: 30, gif: false, contactFrames: 0 });
    expect(m.gif).toBeUndefined();
    expect(m.contact).toBeUndefined();
    expect(m.total).toBe(4);
  });

  it("says so when there are no frames", () => {
    expect(() => makeMovie(dir, { fps: 30 })).toThrow(expect.objectContaining({ code: "NO_FRAMES" }));
  });
});

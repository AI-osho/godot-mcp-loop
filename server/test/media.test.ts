import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodeGif, quantize } from "../src/media/gif.js";
import { decodePng, encodePng, type RgbaImage } from "../src/media/png.js";
import { contactSheet, resize } from "../src/media/image.js";
import { readGif } from "./gif-reader.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function solid(width: number, height: number, rgba: [number, number, number, number]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { width, height, data };
}

function pixel(img: RgbaImage, x: number, y: number): number[] {
  const i = (y * img.width + x) * 4;
  return [...img.data.subarray(i, i + 4)];
}

describe("PNG", () => {
  it("round-trips RGBA through encodePng / decodePng", () => {
    const img = solid(5, 3, [10, 20, 30, 255]);
    img.data.set([200, 100, 50, 128], (1 * 5 + 2) * 4);
    const back = decodePng(encodePng(img));
    expect(back.width).toBe(5);
    expect(back.height).toBe(3);
    expect([...back.data]).toEqual([...img.data]);
  });

  it("decodes the PNGs Godot wrote for the samples (every filter type, RGB and RGBA)", () => {
    const dir = join(repo, "examples", "shooter", "sprites");
    const files = readdirSync(dir).filter((f) => f.endsWith(".png"));
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) {
      const buf = readFileSync(join(dir, f));
      const img = decodePng(buf);
      expect(img.width).toBe(buf.readUInt32BE(16));
      expect(img.height).toBe(buf.readUInt32BE(20));
      expect(img.data.length).toBe(img.width * img.height * 4);
    }
  });

  it("rejects what it cannot read", () => {
    expect(() => decodePng(Buffer.from("not a png"))).toThrow(/PNG/);
  });

  it("writes valid zlib data with the right row filter bytes", () => {
    const png = encodePng(solid(2, 2, [1, 2, 3, 4]));
    const idat = png.indexOf("IDAT");
    const len = png.readUInt32BE(idat - 4);
    const raw = inflateSync(png.subarray(idat + 4, idat + 4 + len));
    expect(raw.length).toBe(2 * (1 + 2 * 4));
  });
});

describe("image helpers", () => {
  it("resize averages blocks when shrinking and keeps exact colours for 2x pixel art", () => {
    const img = solid(4, 2, [0, 0, 0, 255]);
    for (const x of [2, 3]) for (const y of [0, 1]) img.data.set([255, 255, 255, 255], (y * 4 + x) * 4);
    const half = resize(img, 2);
    expect(half.width).toBe(2);
    expect(half.height).toBe(1);
    expect(pixel(half, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(half, 1, 0)).toEqual([255, 255, 255, 255]);
    expect(resize(img, 8)).toBe(img); // never enlarges
  });

  it("contactSheet lays frames out in a grid with a label strip", () => {
    const frames = [0, 1, 2, 3, 4].map((i) => ({ image: solid(20, 10, [i * 50, 0, 0, 255]), label: `#${i}` }));
    const sheet = contactSheet(frames, { columns: 3, tileWidth: 20 });
    expect(sheet.width).toBe(3 * 20 + 4 * 2);
    expect(sheet.height).toBeGreaterThan(2 * 10);
    // The first tile's image area keeps its colour (below the label strip).
    expect(pixel(sheet, 2 + 10, sheet.height / 2 - 1)[3]).toBe(255);
  });
});

describe("GIF", () => {
  it("keeps up to 256 colours exactly", () => {
    const a = solid(4, 4, [255, 0, 0, 255]);
    const b = solid(4, 4, [0, 0, 255, 255]);
    const q = quantize([a, b]);
    expect(q.palette.length).toBeLessThanOrEqual(256);
    expect(q.palette).toContainEqual([255, 0, 0]);
    expect(q.palette).toContainEqual([0, 0, 255]);
  });

  it("reduces many colours to at most 256 with a small error", () => {
    const img: RgbaImage = { width: 64, height: 64, data: new Uint8Array(64 * 64 * 4) };
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) img.data.set([x * 4, y * 4, (x + y) * 2, 255], (y * 64 + x) * 4);
    const q = quantize([img]);
    expect(q.palette.length).toBeLessThanOrEqual(256);
    let worst = 0;
    for (let i = 0; i < 64 * 64; i++) {
      const c = q.palette[q.map(img.data[i * 4]!, img.data[i * 4 + 1]!, img.data[i * 4 + 2]!)]!;
      worst = Math.max(worst, Math.abs(c[0]! - img.data[i * 4]!), Math.abs(c[1]! - img.data[i * 4 + 1]!), Math.abs(c[2]! - img.data[i * 4 + 2]!));
    }
    expect(worst).toBeLessThan(24);
  });

  it("encodes an endless animation whose frames decode back to the input, storing only what changed", () => {
    const f1 = solid(8, 6, [0, 0, 0, 255]);
    const f2 = solid(8, 6, [0, 0, 0, 255]);
    f2.data.set([255, 255, 0, 255], (3 * 8 + 5) * 4); // one pixel changes
    const f3 = solid(8, 6, [0, 128, 255, 255]);
    const gif = readGif(encodeGif([f1, f2, f3], { delaysCs: [7, 7, 6] }));
    expect([gif.width, gif.height, gif.loop]).toEqual([8, 6, 0]);
    expect(gif.frames.map((f) => f.delay)).toEqual([7, 7, 6]);
    expect(gif.frames[1]!.rect).toEqual([5, 3, 1, 1]);
    const rgbAt = (frame: number, x: number, y: number) => gif.palette[gif.frames[frame]!.indices[y * 8 + x]!];
    expect(rgbAt(0, 5, 3)).toEqual([0, 0, 0]);
    expect(rgbAt(1, 5, 3)).toEqual([255, 255, 0]);
    expect(rgbAt(1, 0, 0)).toEqual([0, 0, 0]);
    expect(rgbAt(2, 7, 5)).toEqual([0, 128, 255]);
  });

  it("encodes long, noisy frames (dictionary resets past 4096 codes)", () => {
    const img: RgbaImage = { width: 200, height: 120, data: new Uint8Array(200 * 120 * 4) };
    let seed = 1;
    for (let i = 0; i < 200 * 120; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      img.data.set([(seed >> 3) & 0xe0, (seed >> 9) & 0xe0, (seed >> 15) & 0xc0, 255], i * 4);
    }
    const gif = readGif(encodeGif([img], { delaysCs: [10] }));
    for (const [x, y] of [[0, 0], [199, 119], [57, 33]] as const) {
      const i = (y * 200 + x) * 4;
      expect(gif.palette[gif.frames[0]!.indices[y * 200 + x]!]).toEqual([img.data[i], img.data[i + 1], img.data[i + 2]]);
    }
  });
});

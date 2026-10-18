import type { RgbaImage } from "./png.js";

/** Shrinks to at most maxWidth (box filter: each target pixel averages the source pixels it covers). */
export function resize(img: RgbaImage, maxWidth: number): RgbaImage {
  if (img.width <= maxWidth) return img;
  const w = Math.max(1, Math.round(maxWidth));
  const h = Math.max(1, Math.round((img.height * w) / img.width));
  const data = new Uint8Array(w * h * 4);
  const fx = img.width / w;
  const fy = img.height / h;
  for (let ty = 0; ty < h; ty++) {
    const y0 = Math.floor(ty * fy);
    const y1 = Math.max(y0 + 1, Math.floor((ty + 1) * fy));
    for (let tx = 0; tx < w; tx++) {
      const x0 = Math.floor(tx * fx);
      const x1 = Math.max(x0 + 1, Math.floor((tx + 1) * fx));
      let r = 0, g = 0, b = 0, a = 0;
      for (let y = y0; y < y1; y++) {
        let i = (y * img.width + x0) * 4;
        for (let x = x0; x < x1; x++, i += 4) {
          r += img.data[i]!;
          g += img.data[i + 1]!;
          b += img.data[i + 2]!;
          a += img.data[i + 3]!;
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (ty * w + tx) * 4;
      data[o] = Math.round(r / n);
      data[o + 1] = Math.round(g / n);
      data[o + 2] = Math.round(b / n);
      data[o + 3] = Math.round(a / n);
    }
  }
  return { width: w, height: h, data };
}

/** 3×5 glyphs for frame labels ("1.20s (36)"). */
const GLYPHS: Record<string, string> = {
  "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111", "4": "101101111001001",
  "5": "111100111001111", "6": "111100111101111", "7": "111001010010010", "8": "111101111101111", "9": "111101111001111",
  ".": "000000000000010", s: "000111100001111", " ": "000000000000000", "-": "000000111000000", "(": "010100100100010",
  ")": "010001001001010",
};

function drawText(img: RgbaImage, text: string, x: number, y: number, scale: number): void {
  let cx = x;
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS[" "]!;
    for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
      if (g[gy * 3 + gx] !== "1") continue;
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const px = cx + gx * scale + sx;
        const py = y + gy * scale + sy;
        if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
        img.data.set([255, 255, 255, 255], (py * img.width + px) * 4);
      }
    }
    cx += 4 * scale;
  }
}

function blit(dst: RgbaImage, src: RgbaImage, x: number, y: number): void {
  for (let j = 0; j < src.height; j++) {
    const row = src.data.subarray(j * src.width * 4, (j + 1) * src.width * 4);
    dst.data.set(row, ((y + j) * dst.width + x) * 4);
  }
}

/** Frames side by side in a grid (row by row), each under a label strip; opaque dark background. */
export function contactSheet(frames: Array<{ image: RgbaImage; label: string }>, opts: { columns: number; tileWidth: number }): RgbaImage {
  const gap = 2;
  const scale = 2;
  const labelH = 5 * scale + 4;
  const tiles = frames.map((f) => ({ image: resize(f.image, opts.tileWidth), label: f.label }));
  const tileW = Math.max(...tiles.map((t) => t.image.width));
  const tileH = Math.max(...tiles.map((t) => t.image.height));
  const cols = Math.max(1, Math.min(opts.columns, tiles.length));
  const rows = Math.ceil(tiles.length / cols);
  const width = cols * tileW + (cols + 1) * gap;
  const height = rows * (labelH + tileH) + (rows + 1) * gap;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([32, 32, 32, 255], i * 4);
  const sheet = { width, height, data };
  tiles.forEach((t, i) => {
    const x = gap + (i % cols) * (tileW + gap);
    const y = gap + Math.floor(i / cols) * (labelH + tileH + gap);
    drawText(sheet, t.label, x + 2, y + 2, scale);
    blit(sheet, t.image, x, y + labelH);
  });
  return sheet;
}

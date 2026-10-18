import type { RgbaImage } from "./png.js";

/**
 * Animated GIF without dependencies: one global palette (exact when the frames use at most 256 colours — typical for
 * pixel art — otherwise median cut on a 15-bit histogram), each later frame stored as the rectangle that changed.
 */

export interface Palette {
  palette: number[][];
  /** Index of the palette colour for an RGB value. */
  map: (r: number, g: number, b: number) => number;
}

export function quantize(frames: RgbaImage[]): Palette {
  const exact = new Map<number, number>();
  outer: for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4) {
      const key = (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!;
      if (!exact.has(key)) {
        if (exact.size === 256) {
          exact.clear();
          break outer;
        }
        exact.set(key, exact.size);
      }
    }
  }
  if (exact.size > 0) {
    const palette = [...exact.keys()].map((k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]);
    // Colours missing from the frames the palette was built from (a sample) get the nearest entry.
    const near = nearestMapper(palette);
    return { palette, map: (r, g, b) => exact.get((r << 16) | (g << 8) | b) ?? near(r, g, b) };
  }
  return medianCut(frames, 256);
}

/** Nearest palette entry by 15-bit colour, cached. */
function nearestMapper(palette: number[][]): Palette["map"] {
  const cache = new Int16Array(32768).fill(-1);
  return (r, g, b) => {
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let idx = cache[k]!;
    if (idx < 0) {
      let best = Infinity;
      const cr = (k >> 10) * 8 + 4, cg = ((k >> 5) & 31) * 8 + 4, cb = (k & 31) * 8 + 4;
      for (let i = 0; i < palette.length; i++) {
        const p = palette[i]!;
        const d = (p[0]! - cr) ** 2 + (p[1]! - cg) ** 2 + (p[2]! - cb) ** 2;
        if (d < best) {
          best = d;
          idx = i;
        }
      }
      cache[k] = idx;
    }
    return idx;
  };
}

function medianCut(frames: RgbaImage[], colours: number): Palette {
  const count = new Float64Array(32768);
  const sum = new Float64Array(32768 * 3);
  for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4) {
      const k = ((d[i]! >> 3) << 10) | ((d[i + 1]! >> 3) << 5) | (d[i + 2]! >> 3);
      count[k]! += 1;
      sum[k * 3]! += d[i]!;
      sum[k * 3 + 1]! += d[i + 1]!;
      sum[k * 3 + 2]! += d[i + 2]!;
    }
  }
  const keys: number[] = [];
  for (let k = 0; k < 32768; k++) if (count[k]! > 0) keys.push(k);
  const chan = (k: number, c: number) => (c === 0 ? k >> 10 : c === 1 ? (k >> 5) & 31 : k & 31);
  type Box = { keys: number[]; n: number };
  const weight = (ks: number[]) => ks.reduce((s, k) => s + count[k]!, 0);
  const boxes: Box[] = [{ keys, n: weight(keys) }];
  const spread = (b: Box): [number, number] => {
    let best = -1;
    let ch = 0;
    for (let c = 0; c < 3; c++) {
      let lo = 31;
      let hi = 0;
      for (const k of b.keys) {
        const v = chan(k, c);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > best) {
        best = hi - lo;
        ch = c;
      }
    }
    return [best, ch];
  };
  while (boxes.length < colours) {
    // Split the box with the most pixels × widest range.
    let pick = -1;
    let score = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]!;
      if (b.keys.length < 2) continue;
      const s = spread(b)[0] * b.n;
      if (s > score) {
        score = s;
        pick = i;
      }
    }
    if (pick < 0) break;
    const b = boxes[pick]!;
    const c = spread(b)[1];
    b.keys.sort((x, y) => chan(x, c) - chan(y, c));
    let acc = 0;
    let cut = 1;
    for (; cut < b.keys.length; cut++) {
      acc += count[b.keys[cut - 1]!]!;
      if (acc >= b.n / 2) break;
    }
    const left = b.keys.slice(0, cut);
    const right = b.keys.slice(cut);
    boxes.splice(pick, 1, { keys: left, n: weight(left) }, { keys: right, n: weight(right) });
  }
  const palette = boxes.map((b) => {
    let r = 0, g = 0, bl = 0;
    for (const k of b.keys) {
      r += sum[k * 3]!;
      g += sum[k * 3 + 1]!;
      bl += sum[k * 3 + 2]!;
    }
    return [Math.round(r / b.n), Math.round(g / b.n), Math.round(bl / b.n)];
  });
  return { palette, map: nearestMapper(palette) };
}

class Bytes {
  private buf = Buffer.alloc(1 << 16);
  length = 0;
  push(...bytes: number[]): void {
    for (const b of bytes) this.byte(b);
  }
  byte(b: number): void {
    if (this.length === this.buf.length) {
      const next = Buffer.alloc(this.buf.length * 2);
      this.buf.copy(next);
      this.buf = next;
    }
    this.buf[this.length++] = b & 255;
  }
  u16(v: number): void {
    this.byte(v & 255);
    this.byte(v >> 8);
  }
  result(): Buffer {
    return this.buf.subarray(0, this.length);
  }
}

function lzw(out: Bytes, indices: Uint8Array, minCode: number): void {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let size = minCode + 1;
  let next = eoi + 1;
  let table = new Map<number, number>();
  const data: number[] = [];
  let acc = 0;
  let bits = 0;
  const emit = (code: number) => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) {
      data.push(acc & 255);
      acc >>>= 8;
      bits -= 8;
    }
  };
  emit(clear);
  let prefix = indices[0]!;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]!;
    const key = (prefix << 8) | k;
    const hit = table.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      table = new Map();
      next = eoi + 1;
      size = minCode + 1;
    } else {
      if (next >= 1 << size) size++;
      table.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) data.push(acc & 255);
  out.byte(minCode);
  for (let i = 0; i < data.length; i += 255) {
    const n = Math.min(255, data.length - i);
    out.byte(n);
    for (let j = 0; j < n; j++) out.byte(data[i + j]!);
  }
  out.byte(0);
}

/**
 * Frames must share one size. delaysCs: per-frame delay in 1/100 s (unchanged frames add theirs to the previous one).
 * With a palette (e.g. built from a sample of the frames) the frames may be any iterable and are encoded one at a time,
 * so a long recording never sits in memory as a whole.
 */
export function encodeGif(frames: Iterable<RgbaImage>, opts: { delaysCs: number[]; loop?: number; palette?: Palette }): Buffer {
  const source = opts.palette ? frames : [...frames];
  const q = opts.palette ?? quantize(source as RgbaImage[]);
  let tableBits = 1;
  while (1 << tableBits < q.palette.length) tableBits++;
  const out = new Bytes();
  let width = 0;
  let height = 0;
  let prev: Uint8Array | undefined;
  // The newest image is held back until the next change, which fixes its delay.
  let pending: { delay: number; image: Bytes } | undefined;
  const flush = () => {
    if (!pending) return;
    out.push(0x21, 0xf9, 4, 1 << 2); // graphic control: keep the previous image under this one
    out.u16(Math.min(pending.delay, 65535));
    out.push(0, 0);
    const img = pending.image.result();
    for (let i = 0; i < img.length; i++) out.byte(img[i]!);
    pending = undefined;
  };
  let n = 0;
  for (const f of source) {
    if (n === 0) {
      ({ width, height } = f);
      out.push(...Buffer.from("GIF89a", "latin1"));
      out.u16(width);
      out.u16(height);
      out.push(0x80 | (7 << 4) | (tableBits - 1), 0, 0);
      for (let i = 0; i < 1 << tableBits; i++) {
        const c = q.palette[i] ?? [0, 0, 0];
        out.push(c[0]!, c[1]!, c[2]!);
      }
      out.push(0x21, 0xff, 11, ...Buffer.from("NETSCAPE2.0", "latin1"), 3, 1);
      out.u16(opts.loop ?? 0);
      out.byte(0);
    } else if (f.width !== width || f.height !== height) {
      throw new Error(`Frame ${n + 1} is ${f.width}×${f.height}, the first one ${width}×${height}.`);
    }
    const delay = Math.max(2, Math.round(opts.delaysCs[n] ?? 10));
    n++;
    const idx = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) idx[i] = q.map(f.data[i * 4]!, f.data[i * 4 + 1]!, f.data[i * 4 + 2]!);
    // Only the rectangle that changed since the previous frame is stored.
    let x0 = 0, y0 = 0, x1 = width - 1, y1 = height - 1;
    if (prev) {
      x0 = width; y0 = height; x1 = -1; y1 = -1;
      for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
          if (idx[row + x] !== prev[row + x]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
    }
    prev = idx;
    if (x1 < 0) {
      pending!.delay += delay;
      continue;
    }
    flush();
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const sub = w === width && h === height ? idx : new Uint8Array(w * h);
    if (sub !== idx) for (let y = 0; y < h; y++) sub.set(idx.subarray((y0 + y) * width + x0, (y0 + y) * width + x0 + w), y * w);
    const image = new Bytes();
    image.byte(0x2c);
    image.u16(x0);
    image.u16(y0);
    image.u16(w);
    image.u16(h);
    image.byte(0);
    lzw(image, sub, Math.max(2, tableBits));
    pending = { delay, image };
  }
  if (n === 0) throw new Error("No frames.");
  flush();
  out.byte(0x3b);
  return out.result();
}

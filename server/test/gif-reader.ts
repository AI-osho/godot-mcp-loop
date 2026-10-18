import { expect } from "vitest";

/** Minimal GIF reader for the tests: global palette, frames with their rectangles and delays, LZW decoded. */
export function readGif(buf: Buffer) {
  expect(buf.subarray(0, 6).toString("latin1")).toBe("GIF89a");
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  const flags = buf[10]!;
  let pos = 13;
  const palette: number[][] = [];
  if (flags & 0x80) {
    const n = 2 << (flags & 7);
    for (let i = 0; i < n; i++) palette.push([buf[pos + i * 3]!, buf[pos + i * 3 + 1]!, buf[pos + i * 3 + 2]!]);
    pos += n * 3;
  }
  let loop: number | undefined;
  let delay = 0;
  let transparent: number | undefined;
  const canvas = new Array<number>(width * height).fill(0);
  const frames: Array<{ delay: number; rect: number[]; indices: number[] }> = [];
  for (;;) {
    const b = buf[pos++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = buf[pos++];
      if (label === 0xf9) {
        const packed = buf[pos + 1]!;
        delay = buf.readUInt16LE(pos + 2);
        transparent = packed & 1 ? buf[pos + 4] : undefined;
      } else if (label === 0xff && buf.subarray(pos + 1, pos + 12).toString("latin1") === "NETSCAPE2.0") {
        loop = buf.readUInt16LE(pos + 12 + 2);
      }
      while (buf[pos] !== 0) pos += buf[pos]! + 1;
      pos++;
      continue;
    }
    expect(b).toBe(0x2c);
    const [x, y, w, h] = [buf.readUInt16LE(pos), buf.readUInt16LE(pos + 2), buf.readUInt16LE(pos + 4), buf.readUInt16LE(pos + 6)];
    pos += 9;
    const minCode = buf[pos++]!;
    const chunks: number[] = [];
    while (buf[pos] !== 0) {
      chunks.push(...buf.subarray(pos + 1, pos + 1 + buf[pos]!));
      pos += buf[pos]! + 1;
    }
    pos++;
    // LZW decode
    const clear = 1 << minCode;
    let size = minCode + 1;
    let dict: number[][] = [];
    const reset = () => {
      dict = [];
      for (let i = 0; i < clear; i++) dict.push([i]);
      dict.push([], []);
      size = minCode + 1;
    };
    reset();
    const out: number[] = [];
    let bit = 0;
    let prev: number[] | undefined;
    const read = () => {
      let v = 0;
      for (let i = 0; i < size; i++, bit++) v |= ((chunks[bit >> 3]! >> (bit & 7)) & 1) << i;
      return v;
    };
    for (;;) {
      const code = read();
      if (code === clear) {
        reset();
        prev = undefined;
        continue;
      }
      if (code === clear + 1) break;
      let entry: number[];
      if (code < dict.length) entry = dict[code]!;
      else entry = [...prev!, prev![0]!];
      out.push(...entry);
      if (prev) dict.push([...prev, entry[0]!]);
      prev = entry;
      if (dict.length === 1 << size && size < 12) size++;
    }
    expect(out.length).toBe(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const v = out[j * w + i]!;
      if (v !== transparent) canvas[(y + j) * width + x + i] = v;
    }
    frames.push({ delay, rect: [x, y, w, h], indices: [...canvas] });
  }
  return { width, height, palette, loop, frames };
}


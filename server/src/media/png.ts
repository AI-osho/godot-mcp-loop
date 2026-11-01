import { deflateSync, inflateSync } from "node:zlib";

/** 8-bit RGBA pixels, row by row. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** PNG (RGBA, 8 bit, filter "up" per row — good for screenshots and pixel art). */
export function encodePng(img: RgbaImage): Buffer {
  const stride = img.width * 4;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    const row = y * (stride + 1);
    raw[row] = y === 0 ? 0 : 2;
    for (let i = 0; i < stride; i++) {
      const v = img.data[y * stride + i]!;
      raw[row + 1 + i] = y === 0 ? v : (v - img.data[(y - 1) * stride + i]!) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", new Uint8Array())]);
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Reads an 8-bit, non-interlaced PNG (grey, RGB, palette, grey+alpha or RGBA) into RGBA. */
export function decodePng(buf: Buffer): RgbaImage {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("Not a PNG file.");
  if (buf.length > 32 * 1024 * 1024) throw new Error("PNG exceeds the 32 MiB input limit.");
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let palette: Uint8Array | undefined;
  let trns: Uint8Array | undefined;
  let ended = false;
  const idat: Buffer[] = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    if (pos + 12 + len > buf.length) throw new Error("Truncated PNG chunk.");
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (crc32(buf.subarray(pos + 4, pos + 8 + len)) !== buf.readUInt32BE(pos + 8 + len)) {
      throw new Error("Invalid PNG chunk CRC.");
    }
    pos += 12 + len;
    if (width === 0 && type !== "IHDR") throw new Error("PNG header must be the first chunk.");
    if (type === "IHDR") {
      if (len !== 13 || width !== 0) throw new Error("Invalid PNG header.");
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 16_777_216) {
        throw new Error("PNG dimensions exceed the 8192 px / 16 megapixel limit.");
      }
      const depth = data[8]!;
      colorType = data[9]!;
      if (depth !== 8 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0 || CHANNELS[colorType] === undefined) {
        throw new Error(`Unsupported PNG (bit depth ${depth}, colour type ${colorType}, compression ${data[10]}, filter ${data[11]}, interlace ${data[12]}).`);
      }
    } else if (type === "PLTE") {
      if (palette || idat.length > 0 || len < 3 || len > 768 || len % 3 !== 0) throw new Error("Invalid PNG palette.");
      palette = data;
    } else if (type === "tRNS") {
      const validLength = (colorType === 0 && len === 2) || (colorType === 2 && len === 6) ||
        (colorType === 3 && palette !== undefined && len > 0 && len <= palette.length / 3);
      if (trns || idat.length > 0 || !validLength) throw new Error("Invalid PNG transparency chunk.");
      trns = data;
    }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") {
      if (len !== 0) throw new Error("Invalid PNG end chunk.");
      ended = true;
      break;
    } else if (!/^[a-z][A-Za-z]{3}$/.test(type)) throw new Error("Unsupported PNG critical chunk.");
  }
  if (width === 0 || idat.length === 0 || !ended || pos !== buf.length) throw new Error("Truncated PNG file or trailing data.");
  if (colorType === 3 && !palette) throw new Error("Indexed PNG is missing its palette.");
  const ch = CHANNELS[colorType]!;
  const stride = width * ch;
  const expected = (stride + 1) * height;
  // Tiny compressed streams can expand enormously. Bound inflation before allocating or traversing pixels.
  const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected });
  if (raw.length !== expected) throw new Error("Truncated or oversized PNG data.");
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]!;
      const a = i >= ch ? px[dst + i - ch]! : 0;
      const b = y > 0 ? px[dst - stride + i]! : 0;
      const c = i >= ch && y > 0 ? px[dst - stride + i - ch]! : 0;
      let v: number;
      switch (f) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error(`Bad PNG filter ${f}.`);
      }
      px[dst + i] = v & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * ch;
    const d = i * 4;
    switch (colorType) {
      case 0:
        data[d] = data[d + 1] = data[d + 2] = px[s]!;
        data[d + 3] = trns && trns[0] === 0 && trns[1] === px[s] ? 0 : 255;
        break;
      case 2:
        data[d] = px[s]!; data[d + 1] = px[s + 1]!; data[d + 2] = px[s + 2]!;
        data[d + 3] = trns && trns[0] === 0 && trns[2] === 0 && trns[4] === 0 && trns[1] === px[s] && trns[3] === px[s + 1] && trns[5] === px[s + 2] ? 0 : 255;
        break;
      case 3: {
        const k = px[s]!;
        if (k * 3 + 2 >= palette!.length) throw new Error("PNG pixel index is outside its palette.");
        data[d] = palette![k * 3]!;
        data[d + 1] = palette![k * 3 + 1]!;
        data[d + 2] = palette![k * 3 + 2]!;
        data[d + 3] = trns?.[k] ?? 255;
        break;
      }
      case 4: data[d] = data[d + 1] = data[d + 2] = px[s]!; data[d + 3] = px[s + 1]!; break;
      default: data[d] = px[s]!; data[d + 1] = px[s + 1]!; data[d + 2] = px[s + 2]!; data[d + 3] = px[s + 3]!;
    }
  }
  return { width, height, data };
}

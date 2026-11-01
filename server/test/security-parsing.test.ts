import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodePng, encodePng } from "../src/media/png.js";
import { parseScenario } from "../src/scenario/schema.js";

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, "ascii"); data.copy(out, 8);
  let crc = 0xffffffff;
  for (const b of out.subarray(4, 8 + data.length)) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4);
  return out;
}

describe("bounded input parsing", () => {
  it("rejects a PNG chunk whose CRC does not match its bytes", () => {
    const bad = encodePng({ width: 1, height: 1, data: new Uint8Array([1, 2, 3, 255]) });
    bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
    expect(() => decodePng(bad)).toThrow(/CRC/i);
  });

  it.each(["missing IEND", "compression", "filter", "non-empty IEND", "trailing data", "chunk before IHDR", "unknown critical chunk"])("rejects invalid PNG structure: %s", (kind) => {
    const good = encodePng({ width: 1, height: 1, data: new Uint8Array([1, 2, 3, 255]) });
    let bad: Buffer;
    if (kind === "missing IEND") bad = good.subarray(0, good.length - 12);
    else if (kind === "trailing data") bad = Buffer.concat([good, Buffer.from([0])]);
    else if (kind === "non-empty IEND") bad = Buffer.concat([good.subarray(0, good.length - 12), chunk("IEND", Buffer.from([0]))]);
    else if (kind === "chunk before IHDR") bad = Buffer.concat([good.subarray(0, 8), chunk("tEXt", Buffer.from("a")), good.subarray(8)]);
    else if (kind === "unknown critical chunk") bad = Buffer.concat([good.subarray(0, good.length - 12), chunk("ABCD", Buffer.alloc(0)), good.subarray(good.length - 12)]);
    else {
      const header = Buffer.from(good.subarray(16, 29));
      header[kind === "compression" ? 10 : 11] = 1;
      bad = Buffer.concat([good.subarray(0, 8), chunk("IHDR", header), good.subarray(33)]);
    }
    expect(() => decodePng(bad)).toThrow();
  });

  it.each(["missing", "empty", "bad length", "too large", "out-of-range index", "after IDAT", "oversized alpha"])("rejects an invalid indexed PNG palette: %s", (kind) => {
    const good = encodePng({ width: 1, height: 1, data: new Uint8Array([1, 2, 3, 255]) });
    const header = Buffer.from(good.subarray(16, 29)); header[9] = 3;
    const palette = kind === "empty" ? Buffer.alloc(0) : kind === "bad length" ? Buffer.alloc(4) : kind === "too large" ? Buffer.alloc(771) : Buffer.from([10, 20, 30]);
    const plte = chunk("PLTE", palette);
    const image = chunk("IDAT", deflateSync(Buffer.from([0, kind === "out-of-range index" ? 1 : 0])));
    const chunks = kind === "missing" ? [image] : kind === "after IDAT" ? [image, plte] : [plte, ...(kind === "oversized alpha" ? [chunk("tRNS", Buffer.from([0, 0]))] : []), image];
    expect(() => decodePng(Buffer.concat([good.subarray(0, 8), chunk("IHDR", header), ...chunks, chunk("IEND", Buffer.alloc(0))]))).toThrow();
  });

  it("keeps a valid indexed palette and its transparency", () => {
    const good = encodePng({ width: 1, height: 1, data: new Uint8Array([1, 2, 3, 255]) });
    const header = Buffer.from(good.subarray(16, 29)); header[9] = 3;
    const indexed = Buffer.concat([good.subarray(0, 8), chunk("IHDR", header), chunk("PLTE", Buffer.from([10, 20, 30])), chunk("tRNS", Buffer.from([0])), chunk("IDAT", deflateSync(Buffer.from([0, 0]))), chunk("IEND", Buffer.alloc(0))]);
    expect([...decodePng(indexed).data]).toEqual([10, 20, 30, 0]);
  });

  it.each([
    { color: 0, pixel: [10], key: [0, 10], expected: [10, 10, 10, 0] },
    { color: 2, pixel: [10, 20, 30], key: [0, 10, 0, 20, 0, 30], expected: [10, 20, 30, 0] },
  ])("applies the transparent sample key for 8-bit PNG colour type $color", ({ color, pixel, key, expected }) => {
    const good = encodePng({ width: 1, height: 1, data: new Uint8Array([1, 2, 3, 255]) });
    const header = Buffer.from(good.subarray(16, 29)); header[9] = color;
    const image = Buffer.concat([good.subarray(0, 8), chunk("IHDR", header), chunk("tRNS", Buffer.from(key)), chunk("IDAT", deflateSync(Buffer.from([0, ...pixel]))), chunk("IEND", Buffer.alloc(0))]);
    expect([...decodePng(image).data]).toEqual(expected);
  });

  it("bounds PNG inflation by the declared image size", () => {
    const good = encodePng({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) });
    const bomb = Buffer.concat([good.subarray(0, 33), chunk("IDAT", deflateSync(Buffer.alloc(2 * 1024 * 1024))), chunk("IEND", Buffer.alloc(0))]);
    expect(() => decodePng(bomb)).toThrow();
  });

  it("rejects an RGB tRNS chunk with valid CRC but seven bytes rather than six", () => {
    const good = encodePng({ width: 1, height: 1, data: new Uint8Array([10, 20, 30, 255]) });
    const header = Buffer.from(good.subarray(16, 29)); header[9] = 2;
    const malformed = Buffer.concat([good.subarray(0, 8), chunk("IHDR", header), chunk("tRNS", Buffer.from([0, 10, 0, 20, 0, 30, 0])), chunk("IDAT", deflateSync(Buffer.from([0, 10, 20, 30]))), chunk("IEND", Buffer.alloc(0))]);
    expect(() => decodePng(malformed)).toThrow(/transparency|tRNS/i);
  });

  it.each([
    [0, 0], [0, 1], [0, 3], [2, 0], [2, 5], [3, 0], [3, 3], [4, 0], [4, 2], [6, 0], [6, 6],
  ])("enforces colour-specific transparency rules for type %i, length %i", (color, length) => {
    const good = encodePng({ width: 1, height: 1, data: new Uint8Array([10, 20, 30, 255]) });
    const header = Buffer.from(good.subarray(16, 29)); header[9] = color;
    const pixel: Record<number, number[]> = { 0: [10], 2: [10, 20, 30], 3: [0], 4: [10, 255], 6: [10, 20, 30, 255] };
    const palette = color === 3 ? [chunk("PLTE", Buffer.from([10, 20, 30, 40, 50, 60]))] : [];
    const start = [good.subarray(0, 8), chunk("IHDR", header), ...palette];
    const end = [chunk("IDAT", deflateSync(Buffer.from([0, ...pixel[color]!]))), chunk("IEND", Buffer.alloc(0))];
    expect(decodePng(Buffer.concat([...start, ...end])).width).toBe(1);
    expect(() => decodePng(Buffer.concat([...start, chunk("tRNS", Buffer.alloc(length)), ...end]))).toThrow(/transparency|tRNS/i);
  });

  it.each([1, 2])("keeps a valid indexed tRNS with %i alpha entries", (length) => {
    const good = encodePng({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) });
    const header = Buffer.from(good.subarray(16, 29)); header[9] = 3;
    const png = Buffer.concat([good.subarray(0, 8), chunk("IHDR", header), chunk("PLTE", Buffer.from([10, 20, 30, 40, 50, 60])), chunk("tRNS", Buffer.from([0, 128]).subarray(0, length)), chunk("IDAT", deflateSync(Buffer.from([0, 1]))), chunk("IEND", Buffer.alloc(0))]);
    expect([...decodePng(png).data]).toEqual([40, 50, 60, length === 1 ? 255 : 128]);
  });

  it.each(["duplicate", "after IDAT"])("still rejects a tRNS chunk that is %s", (kind) => {
    const good = encodePng({ width: 1, height: 1, data: new Uint8Array([10, 10, 10, 255]) });
    const header = Buffer.from(good.subarray(16, 29)); header[9] = 0;
    const trns = chunk("tRNS", Buffer.from([0, 10]));
    const image = chunk("IDAT", deflateSync(Buffer.from([0, 10])));
    const body = kind === "duplicate" ? [trns, trns, image] : [image, trns];
    expect(() => decodePng(Buffer.concat([good.subarray(0, 8), chunk("IHDR", header), ...body, chunk("IEND", Buffer.alloc(0))]))).toThrow(/transparency|tRNS/i);
  });

  it("rejects recursive YAML aliases with INVALID_PARAMS rather than overflowing the stack", () => {
    const yaml = "name: cycle\nsteps: &steps\n  - repeat:\n      times: 1\n      steps: *steps\n";
    expect(() => parseScenario(yaml)).toThrowError(expect.objectContaining({ code: "INVALID_PARAMS" }));
  });

  it("bounds scenario document size before parsing", () => {
    const yaml = `name: huge\ndescription: ${"x".repeat(1024 * 1024)}\nsteps:\n  - wait_ms: 0\n`;
    expect(() => parseScenario(yaml)).toThrowError(expect.objectContaining({ code: "INVALID_PARAMS" }));
  });

  it.each(["object", "json"] as const)("charges a 2 MiB property key to the scenario budget for %s input", (format) => {
    const scenario = { name: "key-budget", steps: [{ set: { node: ".", properties: { ["k".repeat(2 * 1024 * 1024)]: 0 } } }] };
    expect(() => parseScenario(format === "json" ? JSON.stringify(scenario) : scenario)).toThrowError(expect.objectContaining({ code: "INVALID_PARAMS" }));
  });

  it("counts UTF-8 object-key bytes exactly without charging synthetic array index keys", () => {
    const overhead = Buffer.byteLength(["name", "utf8", "steps", "set", "node", ".", "properties"].join(""), "utf8");
    const remaining = 1024 * 1024 - overhead;
    const key = "界".repeat(Math.floor(remaining / 3)) + "x".repeat(remaining % 3);
    const make = (property: string) => ({ name: "utf8", steps: [{ set: { node: ".", properties: { [property]: 0 } } }] });
    expect(parseScenario(make(key)).name).toBe("utf8");
    expect(() => parseScenario(make(key + "界"))).toThrowError(expect.objectContaining({ code: "INVALID_PARAMS" }));
    const small = make("日本語キー");
    expect(parseScenario(small)).toEqual(parseScenario(JSON.stringify(small)));
  });
});

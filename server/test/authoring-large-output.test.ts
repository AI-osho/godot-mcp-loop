import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { GodotConnection } from "../src/connection.js";
import { encodePng } from "../src/media/png.js";
import { connectClient, textOf } from "./helpers.js";

// Deterministic high-entropy RGB with opaque alpha: valid <32 MB source PNGs,
// but a 16 MP two-frame atlas encodes to substantially more than 32 MB.
function source(seed: number): Buffer {
  const data = new Uint8Array(4000 * 2000 * 4);
  let state = seed;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      data[i + c] = state & 255;
    }
    data[i + 3] = 255;
  }
  return encodePng({ width: 4000, height: 2000, data });
}

it("refuses an encoded atlas over 32 MB before publishing a successful build", async () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "gml-art-encoded-limit-")));
  const conn = new GodotConnection({ projectPath: project });
  const client = await connectClient(conn);
  try {
    for (const [name, seed] of [["one", 123456789], ["two", 987654321]] as const) {
      const png = source(seed);
      expect(png.length).toBeLessThanOrEqual(32_000_000);
      writeFileSync(join(project, name + ".png"), png);
    }
    const r = await client.callTool({ name: "asset_build", arguments: {
      output_root: "res://assets/generated/oversize",
      recipe: { version: 1, assets: ["one", "two"].map(id => ({ id, source: `res://${id}.png`, key: "none", fit: "copy", export: false })),
        atlases: [{ id: "atlas", frames: ["one", "two"] }] },
    } }, undefined, { timeout: 180000 });
    expect(r.isError, textOf(r)).toBe(true);
    expect(textOf(r)).toMatch(/32 MB|encoded.*byte/i);
    expect(existsSync(join(project, "assets"))).toBe(false);
  } finally { await client.close(); conn.close(); rmSync(project, { recursive: true, force: true }); }
}, 180000);

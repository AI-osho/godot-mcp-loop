import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GodotConnection } from "../src/connection.js";
import { encodePng, decodePng } from "../src/media/png.js";
import { connectClient, jsonOf, textOf } from "./helpers.js";

const pose = { id: "actor", source: "res://source.png", fit: "pose", key: "none", frame_size: [12, 16], foot_anchor: [6, 14], target_height: 8 };

describe("declarative artwork build through MCP", () => {
  let project: string, conn: GodotConnection, client: Client;
  beforeEach(async () => {
    project = realpathSync(mkdtempSync(join(tmpdir(), "gml-asset-build-")));
    writeFileSync(join(project, "source.png"), encodePng({ width: 8, height: 12, data: new Uint8Array(8 * 12 * 4).fill(255) }));
    conn = new GodotConnection({ projectPath: project }); client = await connectClient(conn);
  });
  afterEach(async () => { await client?.close(); conn?.close(); rmSync(project, { recursive: true, force: true }); });

  it("detects coordinated recipe and output-anchor edits against the original build checksum", async () => {
    const built = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/coordinated", recipe: { version: 1, assets: [pose] } } });
    expect(built.isError, textOf(built)).toBeFalsy();
    const path = join(project, "assets/generated/coordinated/manifest.json");
    const doc = JSON.parse(readFileSync(path, "utf8"));
    doc.recipe.assets[0].foot_anchor = [5, 14]; doc.outputs[0].anchor = [5, 14];
    writeFileSync(path, JSON.stringify(doc));
    const verified = await client.callTool({ name: "asset_verify", arguments: { manifest: jsonOf(built).manifest } });
    expect(verified.isError, textOf(verified)).toBeFalsy();
    expect(jsonOf(verified).passed).toBe(false);
    expect(jsonOf(verified).failures.join(" ")).toMatch(/manifest|checksum/i);
    const placed = await client.callTool({ name: "asset_scene_add", arguments: { manifest: jsonOf(built).manifest, placements: [{ asset_id: "actor", name: "Actor", position: [0, 0] }] } });
    expect(placed.isError).toBe(true); expect(textOf(placed)).toMatch(/ARTIFACT_CHANGED/);
  });

  it("builds a real foot-aligned PNG in a new managed folder", async () => {
    const original = readFileSync(join(project, "source.png"));
    const res = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/first", recipe: { version: 1, assets: [pose] } } });
    expect(res.isError, textOf(res)).toBeFalsy();
    const report = jsonOf(res);
    expect(report.manifest).toBe("res://assets/generated/first/manifest.json");
    expect(report.outputs[0]).toMatchObject({ id: "actor", width: 12, height: 16, frames: 1, anchor: [6, 14] });
    const image = decodePng(readFileSync(join(project, "assets/generated/first/actor.png")));
    expect([image.width, image.height]).toEqual([12, 16]);
    expect(readFileSync(join(project, "source.png"))).toEqual(original);
    expect(existsSync(join(project, "assets/generated/first/manifest.json"))).toBe(true);
  });
  it("dry-run leaves no parent directories or output files", async () => {
    const res = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/dry", recipe: { version: 1, assets: [pose] }, dry_run: true } });
    expect(res.isError, textOf(res)).toBeFalsy();
    expect(jsonOf(res).dry_run).toBe(true);
    expect(existsSync(join(project, "assets"))).toBe(false);
  });
  it("centres inventory artwork by its visible extent rather than a foot anchor", async () => {
    const res = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/icon", recipe: { version: 1,
      assets: [{ id: "icon", source: "res://source.png", fit: "icon", key: "none", frame_size: [16, 16], target_extent: 10 }],
    } } });
    expect(res.isError, textOf(res)).toBeFalsy();
    expect(jsonOf(res).outputs[0]).toMatchObject({ anchor: [8, 8], width: 16, height: 16 });
    const { data } = decodePng(readFileSync(join(project, "assets/generated/icon/icon.png")));
    const ys = Array.from({ length: 16 }, (_, y) => y).filter((y) => Array.from({ length: 16 }, (_, x) => data[(y * 16 + x) * 4 + 3]).some(Boolean));
    expect(ys.length).toBe(10);
  });
  it("preserves an explicit pixel scale and bottom anchor", async () => {
    const res = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/scaled", recipe: { version: 1,
      assets: [{ id: "rigid", source: "res://source.png", fit: "scaled", key: "none", frame_size: [12, 16], scale: 0.5, foot_y: 14 }],
    } } });
    expect(res.isError, textOf(res)).toBeFalsy();
    expect(jsonOf(res).outputs[0].anchor).toEqual([6, 14]);
    const { width, data } = decodePng(readFileSync(join(project, "assets/generated/scaled/rigid.png")));
    const pixels = Array.from(data).map((v, i) => ({ v, i })).filter(({ v, i }) => i % 4 === 3 && v > 0);
    expect(pixels.length).toBe(8 * 12 * 0.5 * 0.5);
    expect(Math.max(...pixels.map(({ i }) => Math.floor(i / 4 / width))) + 1).toBe(14);
  });
  it("copies an unprocessed background without changing any stored bytes", async () => {
    const original = readFileSync(join(project, "source.png"));
    const res = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/background", recipe: { version: 1,
      assets: [{ id: "background", source: "res://source.png", fit: "copy", key: "none" }],
    } } });
    expect(res.isError, textOf(res)).toBeFalsy();
    expect(readFileSync(join(project, "assets/generated/background/background.png"))).toEqual(original);
    expect(jsonOf(res).outputs[0].anchor).toEqual([0, 0]);
  });
  it("uses one scale for differently sized states instead of normalising their heights", async () => {
    writeFileSync(join(project, "short.png"), encodePng({ width: 8, height: 6, data: new Uint8Array(8 * 6 * 4).fill(255) }));
    const asset = { fit: "scaled", key: "none", frame_size: [24, 32], foot_y: 30, scale_group: "machine" };
    const res = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/group", recipe: { version: 1,
      scale_groups: [{ id: "machine", target_height: 12 }], assets: [{ ...asset, id: "tall", source: "res://source.png" }, { ...asset, id: "short", source: "res://short.png" }],
    } } });
    expect(res.isError, textOf(res)).toBeFalsy();
    const visibleRows = (id: string) => {
      const im = decodePng(readFileSync(join(project, `assets/generated/group/${id}.png`)));
      return Array.from({ length: im.height }, (_, y) => y).filter((y) => Array.from({ length: im.width }, (_, x) => im.data[(y * im.width + x) * 4 + 3]).some(Boolean)).length;
    };
    expect(visibleRows("tall")).toBe(12); expect(visibleRows("short")).toBe(6);
    expect(jsonOf(res).outputs.map((o: any) => o.anchor)).toEqual([[12, 30], [12, 30]]);
  });
  it("packs ordered equal-size frames without alpha compositing and can keep intermediate frames private", async () => {
    const half = new Uint8Array(8 * 12 * 4).fill(255);
    for (let i = 3; i < half.length; i += 4) half[i] = 128;
    writeFileSync(join(project, "half.png"), encodePng({ width: 8, height: 12, data: half }));
    const res = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/atlas", recipe: { version: 1,
      assets: [{ id: "opaque", source: "res://source.png", fit: "copy", key: "none", export: false }, { id: "half", source: "res://half.png", fit: "copy", key: "none", export: false }],
      atlases: [{ id: "poses", frames: ["opaque", "half"], fps: 4, loop: false }],
    } } });
    expect(res.isError, textOf(res)).toBeFalsy();
    expect(jsonOf(res).outputs).toHaveLength(1);
    expect(jsonOf(res).outputs[0]).toMatchObject({ id: "poses", frames: 2, frame_width: 8, frame_height: 12, width: 16, animation: { fps: 4, loop: false } });
    const im = decodePng(readFileSync(join(project, "assets/generated/atlas/poses.png")));
    expect(Array.from(im.data.slice(8 * 4, 8 * 4 + 4))).toEqual([255, 255, 255, 128]);
    expect(existsSync(join(project, "assets/generated/atlas/opaque.png"))).toBe(false);
  });
  it("verifies originals and outputs then reports real byte tampering as a failed domain report", async () => {
    const built = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/verify", recipe: { version: 1, assets: [pose] } } });
    expect(built.isError, textOf(built)).toBeFalsy();
    const manifest = jsonOf(built).manifest;
    const good = await client.callTool({ name: "asset_verify", arguments: { manifest } });
    expect(good.isError, textOf(good)).toBeFalsy(); expect(jsonOf(good).passed).toBe(true);
    const { appendFileSync } = await import("node:fs");
    appendFileSync(join(project, "assets/generated/verify/actor.png"), Buffer.from([0]));
    const changed = await client.callTool({ name: "asset_verify", arguments: { manifest } });
    expect(changed.isError, textOf(changed)).toBeFalsy(); expect(jsonOf(changed).passed).toBe(false);
    expect(jsonOf(changed).failures.join(" ")).toMatch(/actor.png.*changed/);
  });
  it("returns processed artwork as an MCP image, not a fake engine screenshot or base64 text dump", async () => {
    const built = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/preview", recipe: { version: 1, assets: [pose] } } });
    expect(built.isError, textOf(built)).toBeFalsy();
    const result = await client.callTool({ name: "asset_preview", arguments: { manifest: jsonOf(built).manifest, asset_id: "actor" } });
    expect(result.isError, textOf(result)).toBeFalsy();
    const blocks = result.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    const image = blocks.find((c) => c.type === "image")!;
    expect(image.mimeType).toBe("image/png");
    const decoded = decodePng(Buffer.from(image.data!, "base64"));
    expect([decoded.width, decoded.height]).toEqual([12, 16]);
    expect(textOf(result)).toMatch(/not a Godot.*screenshot/i);
    expect(textOf(result)).not.toContain(image.data);
  });
  it("carries real artwork request and reported-quality provenance into a build and detects later request edits", async () => {
    const brief = { title: "Fixture", goal: "Provenance", controls: "Arrows", art_direction: "Separate artwork", scenes: [{ id: "room", description: "Room", assets: ["actor"] }],
      assets: [{ id: "actor", role: "character", description: "Actor", references: [] }] };
    const calls = [
      ["production_plan", { path: "res://plan.json", brief }],
      ["art_request", { plan: "res://plan.json", asset_id: "actor", path: "res://request.json" }],
      ["art_register", { request: "res://request.json", png: "res://source.png", path: "res://accepted.json", reported_quality: "low", decision: "accepted" }],
    ] as const;
    for (const [name, args] of calls) { const r = await client.callTool({ name, arguments: args }); expect(r.isError, textOf(r)).toBeFalsy(); }
    const built = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/provenance", recipe: { version: 1, assets: [{ ...pose, art_record: "res://accepted.json" }] } } });
    expect(built.isError, textOf(built)).toBeFalsy();
    const doc = JSON.parse(readFileSync(join(project, "assets/generated/provenance/manifest.json"), "utf8"));
    expect(doc.generation_records[0].generation.requested.quality).toBe("medium");
    expect(doc.generation_records[0].generation.reported.quality).toBe("low");
    const originalVerification = await client.callTool({ name: "asset_verify", arguments: { manifest: jsonOf(built).manifest } });
    expect(originalVerification.isError, textOf(originalVerification)).toBeFalsy();
    expect(jsonOf(originalVerification).passed).toBe(true);
    expect(jsonOf(originalVerification).manifest_sha256).toBe(jsonOf(built).manifest_sha256);
    const { appendFileSync } = await import("node:fs"); appendFileSync(join(project, "request.json"), "\n");
    const checked = await client.callTool({ name: "asset_verify", arguments: { manifest: jsonOf(built).manifest } });
    expect(checked.isError, textOf(checked)).toBeFalsy(); expect(jsonOf(checked).passed).toBe(false);
    expect(jsonOf(checked).failures.join(" ")).toMatch(/request.json.*changed/);
  });
  it("rejects missing pose fields at the MCP schema before starting a dependency", async () => {
    const previous = process.env.GODOT_LOOP_PYTHON;
    process.env.GODOT_LOOP_PYTHON = "/not-a-real-python";
    try {
      const { target_height: _height, ...missing } = pose;
      const res = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/invalid", recipe: { version: 1, assets: [missing] } } });
      expect(res.isError).toBe(true); expect(textOf(res)).toMatch(/validation.*target_height|target_height.*validation/is);
      expect(existsSync(join(project, "assets"))).toBe(false);
    } finally { if (previous === undefined) delete process.env.GODOT_LOOP_PYTHON; else process.env.GODOT_LOOP_PYTHON = previous; }
  });
  it("refuses a copy anchor outside the real PNG rather than producing an unverifiable build", async () => {
    const r = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/anchor", recipe: { version: 1,
      assets: [{ id: "copy", source: "res://source.png", fit: "copy", key: "none", foot_anchor: [10, 10] }],
    } } });
    expect(r.isError).toBe(true); expect(textOf(r)).toMatch(/anchor/i); expect(existsSync(join(project, "assets"))).toBe(false);
  });
  it.each(["frame_count", "anchor", "extent", "source_dimension"])("rejects internally inconsistent manifest metadata: %s", async (change) => {
    const made = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/layout", recipe: { version: 1, assets: [pose] } } });
    expect(made.isError, textOf(made)).toBeFalsy();
    const path = join(project, "assets/generated/layout/manifest.json");
    const doc = JSON.parse(readFileSync(path, "utf8"));
    if (change === "frame_count") { doc.outputs[0].frames = 2; doc.outputs[0].frame_width /= 2; }
    if (change === "anchor") doc.outputs[0].anchor[1] -= 1;
    if (change === "extent") { doc.outputs[0].width += 1; doc.outputs[0].frame_width += 1; }
    if (change === "source_dimension") doc.sources[0].width += 1;
    writeFileSync(path, JSON.stringify(doc));
    const checked = await client.callTool({ name: "asset_verify", arguments: { manifest: jsonOf(made).manifest } });
    expect(checked.isError, textOf(checked)).toBeFalsy(); expect(jsonOf(checked).passed).toBe(false);
  });
  it.each(["omit_metadata", "alter_reported_quality"])("checks the provenance inventory against the original receipts: %s", async (change) => {
    const brief = { title: "Fixture", goal: "Provenance", controls: "Keys", art_direction: "Separate art", scenes: [{ id: "room", description: "Room", assets: ["actor"] }],
      assets: [{ id: "actor", role: "character", description: "Actor", references: [] }] };
    for (const [name, args] of [
      ["production_plan", { path: "res://plan.json", brief }], ["art_request", { plan: "res://plan.json", asset_id: "actor", path: "res://request.json" }],
      ["art_register", { request: "res://request.json", png: "res://source.png", path: "res://record.json", reported_quality: "low", decision: "accepted" }],
    ] as const) { const r = await client.callTool({ name, arguments: args }); expect(r.isError, textOf(r)).toBeFalsy(); }
    const built = await client.callTool({ name: "asset_build", arguments: { output_root: "res://assets/generated/receipts", recipe: { version: 1, assets: [{ ...pose, art_record: "res://record.json" }] } } });
    expect(built.isError, textOf(built)).toBeFalsy();
    const file = join(project, "assets/generated/receipts/manifest.json"); const doc = JSON.parse(readFileSync(file, "utf8"));
    if (change === "omit_metadata") doc.metadata = []; else doc.generation_records[0].generation.reported.quality = "high";
    writeFileSync(file, JSON.stringify(doc));
    const r = await client.callTool({ name: "asset_verify", arguments: { manifest: jsonOf(built).manifest } });
    expect(r.isError, textOf(r)).toBeFalsy(); expect(jsonOf(r).passed).toBe(false);
  });
});

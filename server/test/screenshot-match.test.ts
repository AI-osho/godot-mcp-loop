import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodePng, encodePng, type RgbaImage } from "../src/media/png.js";
import { matchScreenshot, resolveInProject } from "../src/scenario/screenshot-match.js";

function image(width: number, height: number, rgba: [number, number, number, number] = [30, 40, 60, 255]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { width, height, data };
}

const png = (img: RgbaImage): Buffer => encodePng(img);

describe("match_screenshot baselines", () => {
  let project: string;
  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "gml-match-"));
  });
  afterEach(() => rmSync(project, { recursive: true, force: true }));

  it("creates a missing baseline and matches it afterwards", () => {
    const shot = png(image(20, 10));
    const first = matchScreenshot(project, shot, { baseline: "res://qa/baselines/a.png" });
    expect(first.created).toBe(true);
    expect(first.updated).toBeUndefined();
    expect(first.passed).toBe(true);
    expect(existsSync(join(project, "qa/baselines/a.png"))).toBe(true);
    const second = matchScreenshot(project, shot, { baseline: "res://qa/baselines/a.png" });
    expect(second.created).toBeUndefined();
    expect(second.passed).toBe(true);
    expect(second.diff_ratio).toBe(0);
    expect(second.compared_pixels).toBe(200);
  });

  it("fails when a pixel changes beyond the pixel tolerance and returns a red diff image", () => {
    matchScreenshot(project, png(image(20, 10)), { baseline: "res://qa/b.png" });
    const changed = image(20, 10);
    changed.data.set([255, 255, 255, 255], (3 * 20 + 4) * 4);
    const r = matchScreenshot(project, png(changed), { baseline: "res://qa/b.png", tolerance: 0 });
    expect(r.passed).toBe(false);
    expect(r.changed_pixels).toBe(1);
    expect(r.diff_ratio).toBeCloseTo(1 / 200, 5);
    const diff = decodePng(r.diff_png!);
    expect(diff.width).toBe(20);
    const i = (3 * 20 + 4) * 4;
    expect([diff.data[i], diff.data[i + 1], diff.data[i + 2]]).toEqual([255, 0, 0]);
  });

  it("compares only the requested region and skips ignored areas", () => {
    matchScreenshot(project, png(image(20, 10)), { baseline: "res://qa/c.png" });
    const changed = image(20, 10);
    changed.data.set([255, 0, 0, 255], 0); // top-left, ignored
    changed.data.set([255, 0, 0, 255], (9 * 20 + 19) * 4); // bottom-right, outside the region
    const r = matchScreenshot(project, png(changed), {
      baseline: "res://qa/c.png",
      tolerance: 0,
      region: [5, 5, 10, 4],
      ignore: [[0, 0, 20, 5]],
    });
    expect(r.compared_pixels).toBe(40);
    expect(r.changed_pixels).toBe(0);
    expect(r.passed).toBe(true);
  });

  it("rescales a capture that came back at another size", () => {
    matchScreenshot(project, png(image(20, 10)), { baseline: "res://qa/d.png" });
    const r = matchScreenshot(project, png(image(40, 20)), { baseline: "res://qa/d.png", tolerance: 0.01 });
    expect(r.rescaled_from).toEqual({ width: 40, height: 20 });
    expect(r.passed).toBe(true); // a flat colour survives the rescale
  });

  it("updates an existing baseline on request", () => {
    matchScreenshot(project, png(image(20, 10)), { baseline: "res://qa/e.png" });
    const r = matchScreenshot(project, png(image(20, 10, [200, 0, 0, 255])), { baseline: "res://qa/e.png", update: true });
    expect(r.updated).toBe(true);
    expect(r.passed).toBe(true);
  });

  it("refuses paths outside the project and protected folders", () => {
    expect(() => resolveInProject(project, "res://../evil.png")).toThrow(/relative path/);
    expect(() => resolveInProject(project, "res://.godot/x.png")).toThrow(/tools do not write/);
    expect(() => resolveInProject(project, "/tmp/x.png")).toThrow(/res:\/\//);
  });
});

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { BridgeError } from "../errors.js";
import { decodePng, encodePng, type RgbaImage } from "../media/png.js";

/**
 * Baseline comparison for the `match_screenshot` scenario step: a capture is compared against a PNG kept in the
 * project, so a visual regression fails a scenario instead of waiting for someone to look at an image.
 */

export interface MatchOptions {
  /** res:// path of the baseline; written from this capture when missing (or with update: true). */
  baseline: string;
  /** Allowed fraction of differing pixels (0..1), default 0.005. */
  tolerance?: number;
  /** Compare only this [x, y, w, h] area of the image (baseline coordinates). */
  region?: [number, number, number, number];
  /** Areas to skip, e.g. a timer that always changes. */
  ignore?: Array<[number, number, number, number]>;
  /** Per-channel difference (0..255) that counts as a change, default 12. */
  pixelTolerance?: number;
  /** Rewrite the baseline from this capture instead of comparing. */
  update?: boolean;
}

export interface MatchResult {
  baseline: string;
  /** True when the baseline was written (missing or update). */
  created?: boolean;
  updated?: boolean;
  passed: boolean;
  /** Fraction of compared pixels that differ (0..1). */
  diff_ratio: number;
  changed_pixels: number;
  compared_pixels: number;
  size: { width: number; height: number };
  /** The capture had another size and was rescaled to the baseline before comparing. */
  rescaled_from?: { width: number; height: number };
  /** Red-where-it-differs image, only when the comparison failed. */
  diff_png?: Buffer;
}

const DEFAULT_TOLERANCE = 0.005;
const DEFAULT_PIXEL_TOLERANCE = 12;
const PROTECTED = [".godot", ".git", "addons"];

/** res:// path → absolute path inside the project (refuses escapes and protected folders). */
export function resolveInProject(projectPath: string, resPath: string): string {
  if (!resPath.startsWith("res://")) {
    throw new BridgeError("INVALID_PARAMS", `'${resPath}' must start with res://.`);
  }
  const rel = resPath.slice("res://".length);
  const segments = rel.split("/");
  if (segments.some((s) => s === ".." || s === ".")) {
    throw new BridgeError("PATH_FORBIDDEN", `'${resPath}' contains a relative path segment.`);
  }
  if (segments.length === 0 || segments[0] === "") {
    throw new BridgeError("INVALID_PARAMS", `'${resPath}' is not a file path.`);
  }
  if (PROTECTED.includes(segments[0]!)) {
    throw new BridgeError("PATH_FORBIDDEN", `'${resPath}' is inside ${segments[0]}/, which tools do not write.`);
  }
  const full = resolve(projectPath, rel);
  const root = resolve(projectPath);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new BridgeError("PATH_FORBIDDEN", `'${resPath}' resolves outside the project.`);
  }
  return full;
}

/** Bilinear scale to an exact size (the baseline decides the size). */
export function scaleTo(img: RgbaImage, width: number, height: number): RgbaImage {
  if (img.width === width && img.height === height) return img;
  const data = new Uint8Array(width * height * 4);
  const fx = img.width / width;
  const fy = img.height / height;
  for (let y = 0; y < height; y++) {
    const sy = Math.min(img.height - 1, Math.max(0, (y + 0.5) * fy - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(img.height - 1, y0 + 1);
    const wy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.min(img.width - 1, Math.max(0, (x + 0.5) * fx - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(img.width - 1, x0 + 1);
      const wx = sx - x0;
      const out = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = img.data[(y0 * img.width + x0) * 4 + c]!;
        const p10 = img.data[(y0 * img.width + x1) * 4 + c]!;
        const p01 = img.data[(y1 * img.width + x0) * 4 + c]!;
        const p11 = img.data[(y1 * img.width + x1) * 4 + c]!;
        data[out + c] = Math.round((p00 * (1 - wx) + p10 * wx) * (1 - wy) + (p01 * (1 - wx) + p11 * wx) * wy);
      }
    }
  }
  return { width, height, data };
}

function clampArea(
  area: [number, number, number, number] | undefined,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  const [ax, ay, aw, ah] = area ?? [0, 0, width, height];
  const x = Math.min(Math.max(0, Math.floor(ax)), Math.max(0, width - 1));
  const y = Math.min(Math.max(0, Math.floor(ay)), Math.max(0, height - 1));
  const w = Math.min(Math.max(1, Math.floor(aw)), width - x);
  const h = Math.min(Math.max(1, Math.floor(ah)), height - y);
  return { x, y, w, h };
}

function inside(x: number, y: number, area: { x: number; y: number; w: number; h: number }): boolean {
  return x >= area.x && x < area.x + area.w && y >= area.y && y < area.y + area.h;
}

/**
 * Compares `shotPng` with the baseline. Writes the baseline when it is missing (or `update`), so the first run
 * creates it and later runs check it.
 */
export function matchScreenshot(projectPath: string, shotPng: Buffer, opts: MatchOptions): MatchResult {
  const file = resolveInProject(projectPath, opts.baseline);
  const existed = existsSync(file);
  if (!existed || opts.update === true) {
    const img = decodePng(shotPng); // refuse to store a broken capture as a baseline
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, shotPng);
    return {
      baseline: opts.baseline,
      passed: true,
      ...(existed ? { updated: true } : { created: true }),
      diff_ratio: 0,
      changed_pixels: 0,
      compared_pixels: 0,
      size: { width: img.width, height: img.height },
    };
  }

  const baseline = decodePng(readFileSync(file));
  let shot = decodePng(shotPng);
  const rescaled_from = shot.width !== baseline.width || shot.height !== baseline.height
    ? { width: shot.width, height: shot.height }
    : undefined;
  if (rescaled_from) shot = scaleTo(shot, baseline.width, baseline.height);

  const region = clampArea(opts.region, baseline.width, baseline.height);
  const ignores = (opts.ignore ?? []).map((a) => clampArea(a, baseline.width, baseline.height));
  const pixelTolerance = opts.pixelTolerance ?? DEFAULT_PIXEL_TOLERANCE;
  const diff = new Uint8Array(baseline.width * baseline.height * 4);
  let changed = 0;
  let compared = 0;
  for (let y = 0; y < baseline.height; y++) {
    for (let x = 0; x < baseline.width; x++) {
      const i = (y * baseline.width + x) * 4;
      const inRegion = inside(x, y, region);
      const skipped = ignores.some((a) => inside(x, y, a));
      if (inRegion && !skipped) compared += 1;
      let differs = false;
      if (inRegion && !skipped) {
        differs =
          Math.abs(baseline.data[i]! - shot.data[i]!) > pixelTolerance ||
          Math.abs(baseline.data[i + 1]! - shot.data[i + 1]!) > pixelTolerance ||
          Math.abs(baseline.data[i + 2]! - shot.data[i + 2]!) > pixelTolerance ||
          Math.abs(baseline.data[i + 3]! - shot.data[i + 3]!) > pixelTolerance;
        if (differs) changed += 1;
      }
      if (differs) {
        diff.set([255, 0, 0, 255], i);
      } else {
        // Keep a dim grey copy so the shape of the screen is visible behind the red marks.
        const grey = Math.round((shot.data[i]! + shot.data[i + 1]! + shot.data[i + 2]!) / 12);
        diff.set([grey, grey, grey, 255], i);
      }
    }
  }
  const ratio = compared === 0 ? 0 : changed / compared;
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
  const passed = ratio <= tolerance;
  const result: MatchResult = {
    baseline: opts.baseline,
    passed,
    diff_ratio: Math.round(ratio * 100000) / 100000,
    changed_pixels: changed,
    compared_pixels: compared,
    size: { width: baseline.width, height: baseline.height },
    ...(rescaled_from ? { rescaled_from } : {}),
  };
  if (!passed) result.diff_png = encodePng({ width: baseline.width, height: baseline.height, data: diff });
  return result;
}

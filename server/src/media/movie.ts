import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BridgeError } from "../errors.js";
import { encodeGif, quantize } from "./gif.js";
import { contactSheet, resize } from "./image.js";
import { decodePng, encodePng, type RgbaImage } from "./png.js";

/**
 * Turns a Movie Maker recording (frameNNNNNNNN.png at a fixed rate) into an animated GIF and a contact sheet — one
 * image with evenly spaced, labelled frames that an agent can look at to see motion.
 */

const FRAME = /^frame(\d{8})\.png$/;
export const MAX_GIF_FRAMES = 300;

/** Frame files of a recording, in order. */
export function listFrames(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => FRAME.test(n))
    .sort()
    .map((n) => join(dir, n));
}

/** Which recorded frames go into the GIF, and their delays (1/100 s) so the animation keeps real time. */
export function gifPlan(total: number, fps: number, gifFps: number, max = MAX_GIF_FRAMES): { indices: number[]; delaysCs: number[]; fps: number } {
  let step = Math.max(1, fps / gifFps);
  if (total / step > max) step = total / max;
  const indices: number[] = [];
  for (let t = 0; Math.round(t) < total; t += step) {
    const i = Math.round(t);
    if (indices[indices.length - 1] !== i) indices.push(i);
  }
  const cs = (frameTime: number) => Math.round((frameTime * 100) / fps);
  const delaysCs = indices.map((i, k) => cs(k + 1 < indices.length ? indices[k + 1]! : i + step) - cs(i));
  return { indices, delaysCs, fps: Math.round((fps / step) * 100) / 100 };
}

/** n frame numbers spread evenly from the first to the last. */
export function contactIndices(total: number, n: number): number[] {
  if (total <= n) return Array.from({ length: total }, (_, i) => i);
  if (n === 1) return [0];
  return Array.from({ length: n }, (_, i) => Math.round((i * (total - 1)) / (n - 1)));
}

export interface MovieOptions {
  fps: number;
  /** Make movie.gif (default true). */
  gif?: boolean;
  /** GIF frame rate (default 15, at most the recording rate). */
  gifFps?: number;
  /** Width of the GIF in pixels (default 480; never enlarged). */
  maxWidth?: number;
  /** Frames in the contact sheet (default 12; 0 = none). */
  contactFrames?: number;
  /** Keep only frames [first, last) of the recording (frame indices in the full recording). */
  range?: { first: number; last: number };
}

export interface MovieOutput {
  /** Frame files found (all of them, including an unreadable last one). */
  total: number;
  /** Frames that could not be read (usually a last frame cut off when the game ended). */
  unreadable: number;
  fps: number;
  /** Length of the recording in game time. */
  seconds: number;
  files: string[];
  gif?: { data: Buffer; width: number; height: number; frames: number; fps: number };
  contact?: { data: Buffer; width: number; height: number; frames: number };
}

export function makeMovie(dir: string, opts: MovieOptions): MovieOutput {
  const all = listFrames(dir);
  if (all.length === 0) {
    throw new BridgeError("NO_FRAMES", `The recording has no frames (${dir}).`, "The game may have ended at once or failed to start; check logs_read.");
  }
  // A step range keeps only its frames; labels still show the frame's time in the whole recording.
  const first = Math.max(0, Math.min(opts.range?.first ?? 0, all.length));
  const last = Math.max(first, Math.min(opts.range?.last ?? all.length, all.length));
  const kept = all.slice(first, last);
  if (kept.length === 0) {
    throw new BridgeError(
      "NO_FRAMES",
      `The recording has no frames between ${first} and ${last} (${all.length} frames in total).`,
      "Check the step numbers: from_step is 1-based and to_step must not be before it.",
    );
  }
  const load = (file: string): RgbaImage | undefined => {
    try {
      return decodePng(readFileSync(file));
    } catch {
      return undefined;
    }
  };
  // A game that is stopped mid-frame can leave the last file cut off.
  let usable = kept.length;
  let unreadable = 0;
  if (!load(kept[usable - 1]!)) {
    usable -= 1;
    unreadable += 1;
  }
  if (usable === 0) throw new BridgeError("NO_FRAMES", `No readable frames in ${dir}.`);
  const fps = opts.fps;
  const maxWidth = opts.maxWidth ?? 480;
  const out: MovieOutput = { total: all.length, unreadable, fps, seconds: usable / fps, files: kept.slice(0, usable) };

  const contactN = opts.contactFrames ?? 12;
  if (contactN > 0) {
    const picks = contactIndices(usable, contactN)
      .map((i) => ({ i, image: load(kept[i]!) }))
      .filter((p): p is { i: number; image: RgbaImage } => p.image !== undefined);
    if (picks.length > 0) {
      const sheet = contactSheet(
        picks.map((p) => ({ image: p.image, label: `${((first + p.i) / fps).toFixed(2)}s (${first + p.i})` })),
        { columns: 4, tileWidth: Math.min(320, maxWidth) },
      );
      out.contact = { data: encodePng(sheet), width: sheet.width, height: sheet.height, frames: picks.length };
    }
  }

  if (opts.gif !== false) {
    const plan = gifPlan(usable, fps, Math.min(opts.gifFps ?? 15, fps));
    // Palette from a sample of the frames, then every frame is decoded, scaled and encoded one at a time.
    const sample = contactIndices(plan.indices.length, 24)
      .map((k) => load(kept[plan.indices[k]!]!))
      .filter((f): f is RgbaImage => f !== undefined)
      .map((f) => resize(f, maxWidth));
    const palette = quantize(sample);
    const delays: number[] = [];
    let carried = 0;
    let size = { width: 0, height: 0 };
    let count = 0;
    function* frames(): Generator<RgbaImage> {
      for (let k = 0; k < plan.indices.length; k++) {
        const f = load(kept[plan.indices[k]!]!);
        if (!f) {
          // Skip it; its time goes to the next frame.
          carried += plan.delaysCs[k]!;
          out.unreadable += 1;
          continue;
        }
        const img = resize(f, maxWidth);
        size = { width: img.width, height: img.height };
        delays.push(plan.delaysCs[k]! + carried);
        carried = 0;
        count += 1;
        yield img;
      }
    }
    // encodeGif reads delays by frame number as it goes; the array is filled just before each frame is used.
    const data = encodeGif(frames(), { delaysCs: delays, palette });
    out.gif = { data, ...size, frames: count, fps: plan.fps };
  }
  return out;
}

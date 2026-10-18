import { BridgeError } from "../errors.js";
import { stepsDurationMs } from "../input-steps.js";
import type { Scenario, ScenarioStep } from "./schema.js";

export type BridgeCall = (method: string, params?: Record<string, unknown>, opt?: { timeoutMs?: number }) => Promise<unknown>;

export type StepStatus = "pass" | "fail" | "skip" | "skipped" | "error";

export interface StepResult {
  index: number;
  kind: string;
  status: StepStatus;
  /** What the step checked or did, e.g. "Player.position:y >= 370". */
  target?: string;
  duration_ms: number;
  message?: string;
  detail?: unknown;
}

export interface Shot {
  label: string;
  png_base64: string;
  width: number;
  height: number;
}

export interface ScenarioReport {
  name: string;
  passed: boolean;
  duration_ms: number;
  steps: StepResult[];
  errors: unknown[];
  screenshots: Shot[];
  setup_error?: string;
  failure_screenshot?: Shot;
  /** Movie Maker recording (scenario_run movie): the frame folder (dropped from saved evidence) and the rate. */
  movie?: { dir?: string; fps: number; frames?: number; seconds?: number; files?: string[] };
}

export interface RunOptions {
  /** Record every frame with Movie Maker at this fixed rate; the game is ended gracefully afterwards. */
  movie?: { fps: number };
}

const GRACE_MS = 10_000;
/** While recording a movie the game counts waits in game time and can run much slower than real time (software
 * rendering, PNG encoding per frame), so the server's own safety timeouts get this much more room. */
const MOVIE_SLOWDOWN = 10;

function kindOf(step: ScenarioStep): string {
  return Object.keys(step)[0] ?? "unknown";
}

function describeCondition(c: { node: string; property?: string; method?: string; args?: unknown[]; op: string; value?: unknown; tolerance?: number }): string {
  const tol = c.tolerance === undefined ? "" : ` (±${c.tolerance})`;
  const owner = c.node === "." ? "" : c.node;
  let subject = `${owner}.${c.property ?? ""}`;
  if (c.method !== undefined) {
    const call = `${c.method}(${(c.args ?? []).map((a) => JSON.stringify(a)).join(", ")})`;
    subject = `${owner}.${call}${c.property !== undefined ? `:${c.property}` : ""}`;
  }
  return `${subject} ${c.op}${c.value === undefined ? "" : ` ${JSON.stringify(c.value)}`}${tol}`;
}

type StepArg = number | { frames: number; press?: string[]; release?: string[]; tap?: string[] };

function stepParams(s: StepArg): Record<string, unknown> {
  return typeof s === "number" ? { frames: s } : { ...s };
}

function describeStep(s: StepArg): string {
  if (typeof s === "number") return `step ${s} frames`;
  const parts = (["press", "release", "tap"] as const).filter((k) => s[k]?.length).map((k) => `${k} ${s[k]!.join(", ")}`);
  return `step ${s.frames} frames${parts.length ? ` (${parts.join("; ")})` : ""}`;
}

function describeInput(x: Record<string, unknown>): string {
  if (x.set) {
    const st = x.set as { node?: string; properties: Record<string, unknown> };
    return `set ${st.node ?? "."}: ${Object.entries(st.properties).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(", ")}`;
  }
  if (x.call) {
    const c = x.call as { node?: string; method: string; args?: unknown[] };
    return `call ${c.node ?? "."}.${c.method}(${(c.args ?? []).map((a) => JSON.stringify(a)).join(", ")})`;
  }
  if (x.assert) return `assert ${describeCondition(x.assert as never)}`;
  if (x.wait_for) return `wait_for ${describeCondition(x.wait_for as never)}`;
  const hold = x.hold_frames !== undefined ? `${x.hold_frames} frames` : `${x.hold_ms ?? 100} ms`;
  if (typeof x.action === "string") {
    if (x.press) return `${x.action} press`;
    if (x.release) return `${x.action} release`;
    return `${x.action} (hold ${hold})`;
  }
  if (typeof x.key === "string") return `key ${x.key}`;
  if (x.mouse_click !== undefined) return `click ${JSON.stringify(x.mouse_click)}`;
  if (x.mouse_move !== undefined) return `move ${JSON.stringify(x.mouse_move)}`;
  if (x.wait_frames !== undefined) return `wait ${x.wait_frames} frames`;
  if (x.wait_ms !== undefined) return `wait ${x.wait_ms} ms`;
  return JSON.stringify(x);
}

type InputSpec = { steps: Array<Record<string, unknown>>; record?: Record<string, unknown> };

/** Normalises the three accepted input forms to {steps, record?}. */
export function normalizeInput(input: unknown): InputSpec {
  if (Array.isArray(input)) return { steps: input as Array<Record<string, unknown>> };
  const obj = input as Record<string, unknown>;
  if (Array.isArray(obj.steps)) {
    const spec: InputSpec = { steps: obj.steps as Array<Record<string, unknown>> };
    if (obj.record !== undefined) spec.record = obj.record as Record<string, unknown>;
    return spec;
  }
  return { steps: [obj] };
}

/** One-line description of what a step checks or does, shown next to its result. */
export function describeTarget(step: ScenarioStep): string | undefined {
  if ("wait_for" in step || "assert" in step) {
    return describeCondition("wait_for" in step ? step.wait_for : step.assert);
  }
  if ("pause" in step) return step.pause ? "pause" : "resume";
  if ("step" in step) return describeStep(step.step);
  if ("input" in step) {
    const spec = normalizeInput(step.input);
    let text = spec.steps.map(describeInput).join(", ");
    if (spec.record) {
      const rec = spec.record as { node: string; properties: string[]; expect?: Array<{ property: string; stat: string; op: string; value: unknown }> };
      text += `; record ${rec.node} [${rec.properties.join(", ")}]`;
      if (rec.expect?.length) text += ` expect ${rec.expect.map((e) => `${e.stat} ${e.property} ${e.op} ${JSON.stringify(e.value)}`).join(", ")}`;
    }
    return text;
  }
  if ("query" in step) {
    const props = step.query.properties;
    return props && props.length > 0 ? `${step.query.node} [${props.join(", ")}]` : step.query.node;
  }
  if ("screenshot" in step) return `"${step.screenshot}"`;
  if ("wait_ms" in step) return `${step.wait_ms} ms`;
  if ("set" in step) {
    const props = Object.entries(step.set.properties).map(([k, v]) => `${k} = ${JSON.stringify(v)}`);
    return `${step.set.node}: ${props.join(", ")}`;
  }
  if ("call" in step) {
    return `${step.call.node}.${step.call.method}(${(step.call.args ?? []).map((a) => JSON.stringify(a)).join(", ")})`;
  }
  if ("repeat" in step) {
    const inner = step.repeat.steps.map((x) => describeTarget(x) ?? kindOf(x)).join(", ");
    const text = `${step.repeat.times}× [${inner}]`;
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  }
  return undefined;
}

function describeError(e: unknown): string {
  if (e instanceof BridgeError) return `${e.code}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

async function tryShot(call: BridgeCall, label: string): Promise<Shot | undefined> {
  try {
    const r = (await call("screenshot", { max_width: 640 }, { timeoutMs: 20_000 })) as Omit<Shot, "label">;
    return { label, png_base64: r.png_base64, width: r.width, height: r.height };
  } catch {
    return undefined;
  }
}

/**
 * Runs a scenario against the editor bridge: (re)starts the game, executes
 * steps in order, stops at the first failure, always stops the game at the
 * end (unless keep_running). Never throws for test failures — they are in the report.
 */
export async function runScenario(s: Scenario, call: BridgeCall, opts: RunOptions = {}): Promise<ScenarioReport> {
  const started = Date.now();
  const report: ScenarioReport = { name: s.name, passed: false, duration_ms: 0, steps: [], errors: [], screenshots: [] };
  const skipAll = (from: number) => {
    for (let i = from; i < s.steps.length; i++) {
      const target = describeTarget(s.steps[i]!);
      report.steps.push({
        index: i,
        kind: kindOf(s.steps[i]!),
        status: "skipped",
        ...(target !== undefined ? { target } : {}),
        duration_ms: 0,
      });
    }
  };

  try {
    const run = (await call(
      "game.run",
      { scene: s.scene ?? "main", restart: true, ...(opts.movie ? { movie: { fps: opts.movie.fps } } : {}) },
      { timeoutMs: 30_000 },
    )) as { movie?: { dir: string; fps: number } } | undefined;
    if (opts.movie && run?.movie) report.movie = { dir: run.movie.dir, fps: run.movie.fps };
  } catch (e) {
    report.setup_error = describeError(e);
    skipAll(0);
    report.duration_ms = Date.now() - started;
    return report;
  }

  let failed = false;
  const slow = opts.movie ? MOVIE_SLOWDOWN : 1;
  try {
    for (let i = 0; i < s.steps.length; i++) {
      const step = s.steps[i]!;
      const t0 = Date.now();
      const res: StepResult = { index: i, kind: kindOf(step), status: "pass", duration_ms: 0 };
      const target = describeTarget(step);
      if (target !== undefined) res.target = target;
      try {
        await runStep(step, call, res, report, slow);
      } catch (e) {
        const timeoutLike = e instanceof BridgeError && (e.code === "TIMEOUT" || e.code === "ASSERTION_FAILED");
        res.status = timeoutLike ? "fail" : "error";
        res.message = describeError(e);
      }
      res.duration_ms = Date.now() - t0;
      report.steps.push(res);
      if (res.status === "fail" || res.status === "error") {
        failed = true;
        report.failure_screenshot = await tryShot(call, `failure at step ${i + 1} (${res.kind})`);
        skipAll(i + 1);
        break;
      }
    }
    report.errors = await readErrors(call);
  } finally {
    if (opts.movie) {
      // Let the game quit by itself so the recording is complete (killing it can cut the last frame).
      await call("game.stop", { graceful: true }, { timeoutMs: 30_000 }).catch(() => undefined);
    } else if (!s.keep_running) {
      await call("game.stop", {}).catch(() => undefined);
    }
  }
  report.passed = !failed;
  report.duration_ms = Date.now() - started;
  return report;
}

async function readErrors(call: BridgeCall): Promise<unknown[]> {
  try {
    const r = (await call("logs.read", { source: "game", min_level: "error", limit: 50 })) as { entries: unknown[] };
    return r.entries;
  } catch {
    return [];
  }
}

/** `slow` > 1 while recording a movie: waits then happen in the game (game time) and timeouts get more room. */
async function runStep(step: ScenarioStep, call: BridgeCall, res: StepResult, report: ScenarioReport, slow: number): Promise<void> {
  if ("wait_for" in step) {
    const t = step.wait_for.timeout_ms ?? 5000;
    res.detail = await call("game.wait_for", { ...step.wait_for, timeout_ms: t }, { timeoutMs: t * slow + GRACE_MS });
  } else if ("assert" in step) {
    res.detail = await call("game.wait_for", { ...step.assert, timeout_ms: 0 }, { timeoutMs: GRACE_MS });
  } else if ("input" in step) {
    const spec = normalizeInput(step.input);
    res.detail = await call("game.input", spec, { timeoutMs: stepsDurationMs(spec.steps) * slow + GRACE_MS });
  } else if ("query" in step) {
    res.detail = await call("game.query", step.query);
  } else if ("screenshot" in step) {
    try {
      const r = (await call("screenshot", { max_width: 960 }, { timeoutMs: 20_000 })) as Omit<Shot, "label">;
      report.screenshots.push({ label: step.screenshot, png_base64: r.png_base64, width: r.width, height: r.height });
    } catch (e) {
      if (e instanceof BridgeError && e.code === "RENDERING_UNAVAILABLE") {
        res.status = "skip";
        res.message = "No renderer (headless); screenshot skipped.";
        return;
      }
      throw e;
    }
  } else if ("wait_ms" in step) {
    if (slow > 1) {
      // Game time, like the movie: the game may render slower or faster than real time.
      await call("game.input", { steps: [{ wait_ms: step.wait_ms }] }, { timeoutMs: step.wait_ms * slow + GRACE_MS });
    } else {
      await new Promise((r) => setTimeout(r, step.wait_ms));
    }
  } else if ("pause" in step) {
    res.detail = await call("game.pause", { paused: step.pause });
  } else if ("step" in step) {
    const p = stepParams(step.step);
    res.detail = await call("game.step", p, { timeoutMs: Math.ceil((Number(p.frames) * 2000 * slow) / 60) + GRACE_MS });
  } else if ("set" in step) {
    res.detail = await call("game.set", step.set);
  } else if ("call" in step) {
    const t = step.call.timeout_ms ?? 10_000;
    res.detail = await call("game.call", step.call, { timeoutMs: t * slow + GRACE_MS });
  } else if ("repeat" in step) {
    const { times, steps } = step.repeat;
    for (let it = 1; it <= times; it++) {
      for (let j = 0; j < steps.length; j++) {
        const inner = steps[j]!;
        const innerRes: StepResult = { index: j, kind: kindOf(inner), status: "pass", duration_ms: 0 };
        try {
          await runStep(inner, call, innerRes, report, slow);
        } catch (e) {
          const target = describeTarget(inner);
          const where = `iteration ${it}/${times}, step ${j + 1} (${kindOf(inner)}${target ? ` ${target}` : ""})`;
          if (e instanceof BridgeError) throw new BridgeError(e.code, `${where}: ${e.message}`, e.hint);
          throw new Error(`${where}: ${describeError(e)}`, { cause: e });
        }
      }
    }
    res.detail = { iterations: times, steps_per_iteration: steps.length };
  } else if ("assert_no_errors" in step) {
    const errors = await readErrors(call);
    if (errors.length > 0) {
      const first = errors.slice(0, 3).map((e) => (e as { message?: string }).message ?? JSON.stringify(e));
      throw new BridgeError("ASSERTION_FAILED", `The game logged ${errors.length} error(s): ${first.join(" | ")}`);
    }
  }
}

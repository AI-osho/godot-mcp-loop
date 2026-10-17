import { BridgeError } from "../errors.js";
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
}

const GRACE_MS = 10_000;

function kindOf(step: ScenarioStep): string {
  return Object.keys(step)[0] ?? "unknown";
}

function describeInput(x: Record<string, unknown>): string {
  if (typeof x.action === "string") {
    if (x.press) return `${x.action} press`;
    if (x.release) return `${x.action} release`;
    return `${x.action} (hold ${x.hold_ms ?? 100} ms)`;
  }
  if (typeof x.key === "string") return `key ${x.key}`;
  if (x.mouse_click !== undefined) return `click ${JSON.stringify(x.mouse_click)}`;
  if (x.mouse_move !== undefined) return `move ${JSON.stringify(x.mouse_move)}`;
  if (x.wait_ms !== undefined) return `wait ${x.wait_ms} ms`;
  return JSON.stringify(x);
}

/** One-line description of what a step checks or does, shown next to its result. */
export function describeTarget(step: ScenarioStep): string | undefined {
  if ("wait_for" in step || "assert" in step) {
    const c = "wait_for" in step ? step.wait_for : step.assert;
    return `${c.node}.${c.property} ${c.op} ${JSON.stringify(c.value)}`;
  }
  if ("input" in step) {
    const list = (Array.isArray(step.input) ? step.input : [step.input]) as Array<Record<string, unknown>>;
    return list.map(describeInput).join(", ");
  }
  if ("query" in step) {
    const props = step.query.properties;
    return props && props.length > 0 ? `${step.query.node} [${props.join(", ")}]` : step.query.node;
  }
  if ("screenshot" in step) return `"${step.screenshot}"`;
  if ("wait_ms" in step) return `${step.wait_ms} ms`;
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
export async function runScenario(s: Scenario, call: BridgeCall): Promise<ScenarioReport> {
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
    await call("game.run", { scene: s.scene ?? "main", restart: true }, { timeoutMs: 30_000 });
  } catch (e) {
    report.setup_error = describeError(e);
    skipAll(0);
    report.duration_ms = Date.now() - started;
    return report;
  }

  let failed = false;
  try {
    for (let i = 0; i < s.steps.length; i++) {
      const step = s.steps[i]!;
      const t0 = Date.now();
      const res: StepResult = { index: i, kind: kindOf(step), status: "pass", duration_ms: 0 };
      const target = describeTarget(step);
      if (target !== undefined) res.target = target;
      try {
        await runStep(step, call, res, report);
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
    if (!s.keep_running) {
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

async function runStep(step: ScenarioStep, call: BridgeCall, res: StepResult, report: ScenarioReport): Promise<void> {
  if ("wait_for" in step) {
    const t = step.wait_for.timeout_ms ?? 5000;
    res.detail = await call("game.wait_for", { ...step.wait_for, timeout_ms: t }, { timeoutMs: t + GRACE_MS });
  } else if ("assert" in step) {
    res.detail = await call("game.wait_for", { ...step.assert, timeout_ms: 0 }, { timeoutMs: GRACE_MS });
  } else if ("input" in step) {
    const steps = Array.isArray(step.input) ? step.input : [step.input];
    const total = steps.reduce((n, x) => n + (x.hold_ms ?? 100) + (x.wait_ms ?? 0), 0);
    res.detail = await call("game.input", { steps }, { timeoutMs: total + GRACE_MS });
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
    await new Promise((r) => setTimeout(r, step.wait_ms));
  } else if ("assert_no_errors" in step) {
    const errors = await readErrors(call);
    if (errors.length > 0) {
      const first = errors.slice(0, 3).map((e) => (e as { message?: string }).message ?? JSON.stringify(e));
      throw new BridgeError("ASSERTION_FAILED", `The game logged ${errors.length} error(s): ${first.join(" | ")}`);
    }
  }
}

import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { BridgeError } from "../errors.js";
import { COMPARE_OPS, InputStepSchema, RecordSchema, RELATIVE_OPS } from "../input-steps.js";

const Condition = z.object({
  node: z.string(),
  property: z.string().optional(),
  method: z.string().min(1).optional(),
  args: z.array(z.unknown()).max(16).optional(),
  op: z.enum([...COMPARE_OPS, ...RELATIVE_OPS]),
  value: z.unknown().optional(),
  timeout_ms: z.number().int().min(0).max(120_000).optional(),
  tolerance: z.number().min(0).optional(),
  message: z.string().max(200).optional(),
});

const hasTarget = (c: { property?: string; method?: string }) => c.property !== undefined || c.method !== undefined;
const NEEDS_TARGET = { message: "a condition needs 'property' (or 'method' to check a method's return value)" };

const ACTIONS = z.array(z.string().min(1)).max(16).optional();
/** step: N, or {frames, press?, release?, tap?} to send input just before the first stepped frame. */
const StepSpec = z.object({ frames: z.number().int().min(1).max(3600), press: ACTIONS, release: ACTIONS, tap: ACTIONS }).strict();

const InputStep = InputStepSchema.strict();

/** input: a step, a list of steps, or {steps, record} (all run inside the game in one call). */
const InputSpec = z.union([
  InputStep,
  z.array(InputStep).min(1),
  z.object({ steps: z.array(InputStep).min(1), record: RecordSchema.optional() }).strict(),
]);

const SetStep = z
  .object({
    set: z
      .object({
        node: z.string(),
        properties: z.record(z.string(), z.unknown()).refine((p) => Object.keys(p).length > 0, "properties must not be empty"),
      })
      .strict(),
  })
  .strict();

const CallStep = z
  .object({
    call: z
      .object({
        node: z.string(),
        method: z.string().min(1),
        args: z.array(z.unknown()).max(16).optional(),
        timeout_ms: z.number().int().min(100).max(60_000).optional(),
      })
      .strict(),
  })
  .strict();

const RectArea = z.tuple([
  z.number().int().min(0),
  z.number().int().min(0),
  z.number().int().min(1),
  z.number().int().min(1),
]);

const MatchScreenshotStep = z
  .object({
    match_screenshot: z
      .object({
        baseline: z.string().min(1).regex(/\.png$/i, "Screenshot baselines must use .png").describe("res:// path of the baseline PNG; written from this capture when missing"),
        tolerance: z.number().min(0).max(1).optional().describe("Allowed fraction of differing pixels (default 0.005)"),
        pixel_tolerance: z
          .number()
          .int()
          .min(0)
          .max(255)
          .optional()
          .describe("Per-channel difference that counts as a change (default 12)"),
        region: RectArea.optional().describe("[x, y, w, h] to compare (default the whole image)"),
        ignore: z.array(RectArea).max(16).optional().describe("Areas to skip, e.g. a timer that always changes"),
        update: z.boolean().optional().describe("Rewrite the baseline from this capture instead of comparing"),
      })
      .strict(),
  })
  .strict();

const BaseStep = z.union([
  z.object({ wait_for: Condition.refine(hasTarget, NEEDS_TARGET) }).strict(),
  z.object({ assert: Condition.omit({ timeout_ms: true }).refine(hasTarget, NEEDS_TARGET) }).strict(),
  z.object({ input: InputSpec }).strict(),
  z.object({ query: z.object({ node: z.string(), properties: z.array(z.string()).optional() }) }).strict(),
  z.object({ screenshot: z.string().min(1) }).strict(),
  MatchScreenshotStep,
  z.object({ pause: z.boolean() }).strict(),
  z.object({ step: z.union([z.number().int().min(1).max(3600), StepSpec]) }).strict(),
  z.object({ wait_ms: z.number().int().min(0).max(60_000) }).strict(),
  z.object({ assert_no_errors: z.literal(true) }).strict(),
  SetStep,
  CallStep,
]);

type BaseStepT = z.infer<typeof BaseStep>;
export type RepeatStep = { repeat: { times: number; steps: ScenarioStep[] } };
export type ScenarioStep = BaseStepT | RepeatStep;

const Step: z.ZodType<ScenarioStep> = z.lazy(() =>
  z.union([
    BaseStep,
    z
      .object({
        repeat: z.object({ times: z.number().int().min(1).max(1000), steps: z.array(Step).min(1) }).strict(),
      })
      .strict(),
  ]),
);

/** Steps that will actually run, with repeats multiplied out. */
export function countSteps(steps: ScenarioStep[]): number {
  return steps.reduce((n, s) => n + ("repeat" in s ? s.repeat.times * countSteps(s.repeat.steps) : 1), 0);
}

export const MAX_EXPANDED_STEPS = 10_000;

export const ScenarioSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    scene: z.string().optional().describe("'main' (default), 'current' or a res:// path"),
    keep_running: z.boolean().optional(),
    steps: z.array(Step).min(1),
  })
  .strict();

export type Scenario = z.infer<typeof ScenarioSchema>;

/** Reject cycles and excessive nesting before Zod's recursive schema can overflow its stack. */
function checkScenarioStructure(data: unknown): void {
  const pending: Array<{ value: unknown; depth: number; exit?: boolean }> = [{ value: data, depth: 0 }];
  const active = new WeakSet<object>();
  let nodes = 0;
  let textBytes = 0;
  while (pending.length > 0) {
    const { value, depth, exit } = pending.pop()!;
    if (exit) { active.delete(value as object); continue; }
    if (++nodes > 100_000 || depth > 64) throw new BridgeError("INVALID_PARAMS", "Scenario is too large or nested too deeply.");
    if (typeof value === "string") {
      textBytes += Buffer.byteLength(value, "utf8");
      if (textBytes > 1024 * 1024) throw new BridgeError("INVALID_PARAMS", "Scenario exceeds the 1 MiB text limit.");
    }
    if (value === null || typeof value !== "object") continue;
    if (active.has(value)) throw new BridgeError("INVALID_PARAMS", "Recursive scenario aliases are not allowed.");
    active.add(value);
    pending.push({ value, depth, exit: true });
    const keyed = !Array.isArray(value);
    for (const [key, child] of Object.entries(value)) {
      if (keyed) {
        textBytes += Buffer.byteLength(key, "utf8");
        if (textBytes > 1024 * 1024) throw new BridgeError("INVALID_PARAMS", "Scenario exceeds the 1 MiB text limit.");
      }
      pending.push({ value: child, depth: depth + 1 });
    }
  }
}

/** Parses a scenario from YAML/JSON text or an already-parsed object. */
export function parseScenario(input: unknown): Scenario {
  let data = input;
  if (typeof input === "string") {
    if (Buffer.byteLength(input, "utf8") > 1024 * 1024) {
      throw new BridgeError("INVALID_PARAMS", "Scenario exceeds the 1 MiB document limit.");
    }
    try {
      data = parseYaml(input);
    } catch (e) {
      throw new BridgeError("INVALID_PARAMS", `Scenario is not valid YAML/JSON: ${(e as Error).message}`);
    }
  }
  checkScenarioStructure(data);
  const r = ScenarioSchema.safeParse(data);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new BridgeError(
      "INVALID_PARAMS",
      `Invalid scenario: ${issues.join("; ")}`,
      "Each step must be exactly one of: wait_for, assert, input, query, screenshot, match_screenshot, pause, step, wait_ms, assert_no_errors, set, call, repeat. See docs/scenarios.md.",
    );
  }
  const total = countSteps(r.data.steps);
  if (total > MAX_EXPANDED_STEPS) {
    throw new BridgeError(
      "INVALID_PARAMS",
      `Invalid scenario: too many steps after expanding repeats (${total} > ${MAX_EXPANDED_STEPS}).`,
    );
  }
  return r.data;
}

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

const BaseStep = z.union([
  z.object({ wait_for: Condition.refine(hasTarget, NEEDS_TARGET) }).strict(),
  z.object({ assert: Condition.omit({ timeout_ms: true }).refine(hasTarget, NEEDS_TARGET) }).strict(),
  z.object({ input: InputSpec }).strict(),
  z.object({ query: z.object({ node: z.string(), properties: z.array(z.string()).optional() }) }).strict(),
  z.object({ screenshot: z.string().min(1) }).strict(),
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

/** Parses a scenario from YAML/JSON text or an already-parsed object. */
export function parseScenario(input: unknown): Scenario {
  let data = input;
  if (typeof input === "string") {
    try {
      data = parseYaml(input);
    } catch (e) {
      throw new BridgeError("INVALID_PARAMS", `Scenario is not valid YAML/JSON: ${(e as Error).message}`);
    }
  }
  const r = ScenarioSchema.safeParse(data);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new BridgeError(
      "INVALID_PARAMS",
      `Invalid scenario: ${issues.join("; ")}`,
      "Each step must be exactly one of: wait_for, assert, input, query, screenshot, wait_ms, assert_no_errors, set, call, repeat. See docs/scenarios.md.",
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

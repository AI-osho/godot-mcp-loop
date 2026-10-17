import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { BridgeError } from "../errors.js";

const Op = z.enum(["==", "!=", ">", ">=", "<", "<=", "contains"]);

const Condition = z.object({
  node: z.string(),
  property: z.string(),
  op: Op,
  value: z.unknown(),
  timeout_ms: z.number().int().min(0).max(120_000).optional(),
});

const InputStep = z
  .object({
    action: z.string().optional(),
    hold_ms: z.number().int().min(0).optional(),
    press: z.boolean().optional(),
    release: z.boolean().optional(),
    strength: z.number().min(0).max(1).optional(),
    key: z.string().optional(),
    mouse_move: z.tuple([z.number(), z.number()]).optional(),
    mouse_click: z.tuple([z.number(), z.number()]).optional(),
    button: z.enum(["left", "right"]).optional(),
    wait_ms: z.number().int().min(0).optional(),
  })
  .strict();

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
  z.object({ wait_for: Condition }).strict(),
  z.object({ assert: Condition.omit({ timeout_ms: true }) }).strict(),
  z.object({ input: z.union([InputStep, z.array(InputStep).min(1)]) }).strict(),
  z.object({ query: z.object({ node: z.string(), properties: z.array(z.string()).optional() }) }).strict(),
  z.object({ screenshot: z.string().min(1) }).strict(),
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

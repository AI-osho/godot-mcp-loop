import { z } from "zod";
import { BridgeError } from "./errors.js";
import { JsonValue, PropertyMap } from "./tools/schemas.js";

/** Shared by game_input / game_wait_for and scenario files. */
export const COMPARE_OPS = ["==", "!=", ">", ">=", "<", "<=", "contains"] as const;
/** Compared with the value when waiting starts; need a timeout. */
export const RELATIVE_OPS = ["changed", "increased", "decreased"] as const;
export const RECORD_STATS = ["min", "max", "first", "last", "min_at_ms", "max_at_ms"] as const;

const MAX_FRAMES = 3600;
const GAME_NODE = "Node in the running game, relative to the running scene (e.g. 'Player') or absolute.";

export const ConditionSchema = z.object({
  node: z.string().describe(GAME_NODE),
  property: z
    .string()
    .optional()
    .describe("Property path, e.g. 'position:x', 'items:2', or a script variable. With 'method': a path inside its return value (e.g. 'message')."),
  method: z
    .string()
    .min(1)
    .optional()
    .describe("Check this method's return value instead of a property, e.g. a summary() test hook. Called on every check, so it should only read state."),
  args: z.array(JsonValue).max(16).optional().describe("Arguments for 'method'."),
  op: z.enum([...COMPARE_OPS, ...RELATIVE_OPS]).describe("Comparison; changed/increased/decreased compare with the value when waiting starts."),
  value: JsonValue.optional().describe("Expected value (not used by changed/increased/decreased)."),
  timeout_ms: z.number().int().min(0).max(120_000).optional(),
  tolerance: z.number().min(0).optional().describe("Allowed difference for numbers with ==, !=, >=, <= (default 0.0001)."),
  message: z.string().max(200).optional().describe("Explains a failure in the test's words; prefixed to the error."),
});

export const InputStepShape = {
  action: z.string().optional().describe("Input action name from the project's Input Map, e.g. 'move_right'."),
  hold_ms: z.number().int().min(0).max(60_000).optional().describe("How long to hold the action/key/button (default 100 ms for actions)."),
  hold_frames: z
    .number()
    .int()
    .min(0)
    .max(MAX_FRAMES)
    .optional()
    .describe("Hold for this many physics frames instead of hold_ms — deterministic for logic in _physics_process."),
  press: z.boolean().optional().describe("With 'action': press and keep it held (no release)."),
  release: z.boolean().optional().describe("With 'action': release a previously pressed action."),
  strength: z.number().min(0).max(1).optional().describe("Analog strength for actions (default 1)."),
  key: z.string().optional().describe("Physical key name, e.g. 'Space', 'A', 'Escape', 'Left'."),
  mouse_move: z.tuple([z.number(), z.number()]).optional().describe("Move the mouse to [x, y] (viewport pixels)."),
  mouse_click: z.tuple([z.number(), z.number()]).optional().describe("Click at [x, y] (viewport pixels)."),
  button: z.enum(["left", "right"]).optional().describe("Mouse button for mouse_click (default left)."),
  wait_ms: z.number().int().min(0).max(60_000).optional().describe("Wait after this step (or alone: just wait)."),
  wait_frames: z.number().int().min(0).max(MAX_FRAMES).optional().describe("Wait this many physics frames instead of wait_ms."),
  set: z
    .object({ node: z.string().optional(), properties: PropertyMap })
    .optional()
    .describe("Inline: change values in the game at this point (like game_set), with no time passing."),
  call: z
    .object({
      node: z.string().optional(),
      method: z.string().min(1),
      args: z.array(JsonValue).max(16).optional(),
      timeout_ms: z.number().int().min(100).max(60_000).optional(),
    })
    .optional()
    .describe("Inline: call a game method at this point (like game_call)."),
  assert: ConditionSchema.omit({ timeout_ms: true })
    .optional()
    .describe("Inline: check a condition right now; a failure aborts the sequence and releases held input."),
  wait_for: ConditionSchema.optional().describe("Inline: wait for a condition (default timeout 5000 ms)."),
};

export const InputStepSchema = z
  .object(InputStepShape)
  .describe(
    "One step: exactly one of action, key, mouse_move, mouse_click, set, call, assert, wait_for — or only wait_ms / wait_frames.",
  );

export const RecordSchema = z
  .object({
    node: z.string().describe(GAME_NODE),
    properties: z.array(z.string()).min(1).max(8).describe("Properties to sample, e.g. ['position:y']."),
    interval_ms: z
      .number()
      .int()
      .min(0)
      .max(1000)
      .optional()
      .describe("Minimum time between samples. Default 0 (every frame) — keep it for exact min/max; only raise it for very long recordings."),
    per: z
      .enum(["process", "physics"])
      .optional()
      .describe("'process' (default) samples every rendered frame; 'physics' samples once per physics frame and adds the frame index — use it for logic in _physics_process."),
    mode: z
      .enum(["all", "changes"])
      .optional()
      .describe("'all' (default) keeps every frame; 'changes' keeps a sample only when a value differs from the previous one."),
    expect: z
      .array(
        z.object({
          property: z.string().describe("One of the recorded properties."),
          stat: z.enum(RECORD_STATS),
          op: z.enum(COMPARE_OPS),
          value: JsonValue,
        }),
      )
      .max(16)
      .optional()
      .describe("Checks on the summary after the sequence, e.g. {property: 'position:y', stat: 'min', op: '>=', value: 24}; a failure is ASSERTION_FAILED."),
  })
  .describe(
    "Sample node properties during the sequence. Returns summary {min, max, min_at_ms, max_at_ms, first, last} over every recorded frame, " +
      "samples_total, and an evenly thinned list of at most 50 samples.",
  );

/** A condition names what it reads: a property, or a method (optionally with a path into its result). */
export function checkConditionTarget(c: { property?: unknown; method?: unknown }): void {
  if (c.property === undefined && c.method === undefined) {
    throw new BridgeError("INVALID_PARAMS", "A condition needs 'property' (or 'method' to check a method's return value).");
  }
}

const framesMs = (n: unknown): number => Math.ceil((Number(n) * 1000 * 2) / 60);

/** Upper bound for how long a step sequence takes, for call timeouts (frames get 2x headroom). */
export function stepsDurationMs(steps: Array<Record<string, unknown>>): number {
  let total = 0;
  for (const s of steps) {
    const holds = ("action" in s && !s.press && !s.release) || "key" in s || "mouse_click" in s;
    if (holds) total += s.hold_frames !== undefined ? framesMs(s.hold_frames) : Number(s.hold_ms ?? 100);
    if (s.wait_frames !== undefined) total += framesMs(s.wait_frames);
    else if (s.wait_ms !== undefined) total += Number(s.wait_ms);
    const wf = s.wait_for as { timeout_ms?: number } | undefined;
    if (wf) total += Number(wf.timeout_ms ?? 5000);
    const call = s.call as { timeout_ms?: number } | undefined;
    if (call) total += Number(call.timeout_ms ?? 10_000);
  }
  return total;
}

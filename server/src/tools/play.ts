import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GodotConnection } from "../connection.js";
import { dropUndefined, registerForwardTool, type ForwardToolDef } from "./forward.js";
import { safe } from "./helpers.js";
import { checkConditionTarget, ConditionSchema, InputStepSchema, RecordSchema, stepsDurationMs } from "../input-steps.js";
import { JsonValue, PropertyMap } from "./schemas.js";

const GRACE_MS = 10_000;

const GAME_NODE =
  "Node in the running game: relative to the running scene (e.g. 'Player') or absolute (e.g. '/root/Main/Player').";

export function inputTimeoutMs(args: Record<string, unknown>): number {
  const steps = Array.isArray(args.steps) ? (args.steps as Array<Record<string, unknown>>) : [];
  return stepsDurationMs(steps) + GRACE_MS;
}

const ACTION_LIST = z.array(z.string().min(1)).max(16).optional();

export const PLAY_TOOLS: ForwardToolDef[] = [
  {
    name: "game_run",
    method: "game.run",
    title: "Run game",
    description:
      "Launch the game from the editor and wait until the MCP runtime inside it is connected. " +
      "Script errors in the game are logged and auto-continued unless pause_on_error=true.",
    input: {
      scene: z.string().optional().describe("'main' (default), 'current' (the edited scene), or a res:// scene path."),
      restart: z.boolean().optional().describe("Stop a running game first instead of failing."),
      pause_on_error: z.boolean().optional().describe("Leave the game paused in the debugger on script errors (default false)."),
      timeout_ms: z.number().int().min(1000).max(120_000).optional().describe("How long to wait for the game to connect (default 20000)."),
    },
    timeoutFor: (a) => Number(a.timeout_ms ?? 20_000) + GRACE_MS,
  },
  {
    name: "game_stop",
    method: "game.stop",
    title: "Stop game",
    description: "Stop the running game. Its logs stay readable with logs_read(source='game').",
    input: {},
  },
  {
    name: "game_query",
    method: "game.query",
    title: "Query running game",
    description:
      "Read live state from the running game. With 'properties' returns those values (supports 'position:x'); " +
      "without, returns the node's class, children and common properties plus script variables. " +
      "It only reads properties: to call a method use game_call.",
    input: {
      node: z.string().optional().describe(`${GAME_NODE} Default: the running scene root.`),
      properties: z.array(z.string()).optional(),
    },
    readOnly: true,
  },
  {
    name: "game_input",
    method: "game.input",
    title: "Send input to game",
    description:
      "Play a sequence of input steps in the running game (actions, keys, mouse), in order and with real timing; " +
      "hold_frames/wait_frames count physics frames for deterministic timing. Inline set/call/assert/wait_for steps run inside the game " +
      "between inputs with no time passing, so one call can set up, act and check (a failing step aborts and releases held input). " +
      "Returns when the whole sequence has finished. To observe something brief (e.g. the top of a jump), pass " +
      "'record': the properties are sampled every frame while the steps run, and min/max (with times) are returned. " +
      "min/max are computed from every recorded frame (up to 3000 frames); only the returned sample list is thinned " +
      "to 50 entries, so interval_ms is not needed for accuracy. Add a final {wait_ms} step to keep recording after the input ends. " +
      "Set pause_at_end to leave the game paused when the sequence finishes, so the next call measures the state the input " +
      "left behind instead of a later one.",
    input: {
      steps: z.array(InputStepSchema).min(1).max(200),
      record: RecordSchema.optional(),
      pause_at_end: z
        .boolean()
        .optional()
        .describe("Pause the game when the sequence finishes (default false). The response says paused: true."),
    },
    timeoutFor: inputTimeoutMs,
  },
  {
    name: "game_ui_audit",
    method: "game.ui_audit",
    title: "Audit UI layout",
    description:
      "Walk the Control nodes of the running game and report layout problems: Controls with no size, Controls outside " +
      "the viewport or beyond their parent panel, text that needs more room than its rect (clipped) and overlapping " +
      "labels. Returns the tree (path, class, rect, size, anchors, text) plus the issues, so a HUD can be checked " +
      "without reading a screenshot.",
    input: {
      node: z.string().optional().describe(`${GAME_NODE} Default: the running scene root.`),
      include_hidden: z.boolean().optional().describe("Also list hidden Controls (default false)."),
    },
    readOnly: true,
  },
  {
    name: "game_in_view",
    method: "game.in_view",
    title: "Is a node on screen",
    description:
      "Check whether a Node3D is inside the camera's view (not behind it, projected inside the viewport) and where it lands on screen — the 3D judgement that otherwise needs a screenshot.",
    input: {
      node: z.string().optional().describe(`${GAME_NODE} Default: the running scene root (must be a Node3D).`),
      camera: z.string().optional().describe("Camera3D to use; default the active 3D camera."),
    },
    readOnly: true,
  },
  {
    name: "game_ray",
    method: "game.ray",
    title: "Cast a ray in the running game",
    description:
      "Cast a ray between two world-space points and return the hit position, normal, distance and collider (or hit: false). World axes do not follow a body's rotation, unlike a child RayCast3D.",
    input: {
      from: JsonValue.describe("World start point [x, y, z]."),
      to: JsonValue.describe("World end point [x, y, z]."),
      exclude: z.string().optional().describe("CollisionObject3D to ignore (e.g. the body casting the ray)."),
      collision_mask: z.number().int().min(0).max(0xffffffff).optional().describe("Physics layers to hit (default all)."),
      collide_with_areas: z.boolean().optional().describe("Include Area3D (default false)."),
      collide_with_bodies: z.boolean().optional().describe("Include bodies (default true)."),
    },
    readOnly: true,
  },
  {
    name: "game_contacts",
    method: "game.contacts",
    title: "Contact points of a rigid body",
    description:
      "List a RigidBody3D's contact points, normals and the bodies they touch (contact_monitor must be on), so grounding can be read instead of inferred from a picture.",
    input: { node: z.string().describe(`${GAME_NODE} A RigidBody3D.`) },
    readOnly: true,
  },
  {
    name: "game_set",
    method: "game.set",
    title: "Set values in running game",
    description:
      "Change state in the running game, e.g. to set up a test: {\"score\": 300, \"position:x\": 40, \"items:2\": 5}. " +
      "Paths may address members, array elements and dictionary keys. Values are converted to the existing type; " +
      "all of them are validated first and nothing changes if one is invalid. Returns before/after per path.",
    input: {
      node: z.string().optional().describe(`${GAME_NODE} Default: the running scene root.`),
      properties: PropertyMap.describe("Property path -> new value."),
    },
  },
  {
    name: "game_pause",
    method: "game.pause",
    title: "Pause / resume running game",
    description:
      "Pause (paused: true) or resume the running game. While paused, game nodes don't run but game_query, game_set, game_call and " +
      "game_wait_for still work — inspect and set up a situation across several calls without time passing, then advance with game_step. " +
      "Input sent with press: true stays held while stepping.",
    input: {
      paused: z.boolean(),
    },
  },
  {
    name: "game_step",
    method: "game.step",
    title: "Advance running game by N frames",
    description:
      "Run exactly N physics frames, then leave the game paused (pauses it first if needed). Deterministic: every pausable node " +
      "gets the same N _physics_process calls, independent of call latency. press/release/tap are sent just before the " +
      "first stepped frame, like real input, so the game sees them in that frame as Input.is_action_just_pressed() and as " +
      "input events (tap lasts one frame) — input sent with game_input while paused can't do that.",
    input: {
      frames: z.number().int().min(1).max(3600).describe("Physics frames to run (60 per second by default)."),
      press: ACTION_LIST.describe("Actions to press before the first frame and keep held."),
      release: ACTION_LIST.describe("Held actions to release before the first frame."),
      tap: ACTION_LIST.describe("Actions to press for exactly the first frame."),
    },
    timeoutFor: (args) => Math.ceil((Number(args.frames ?? 1) * 2000) / 60) + GRACE_MS,
  },
  {
    name: "game_call",
    method: "game.call",
    title: "Call method in running game",
    description:
      "Call a method on a node in the running game (e.g. a test hook such as restart() or spawn_wave(3)) and return its result. " +
      "Arguments are converted to the declared parameter types; coroutines are awaited.",
    input: {
      node: z.string().optional().describe(`${GAME_NODE} Default: the running scene root.`),
      method: z.string().min(1).describe("Method name."),
      args: z.array(JsonValue).max(16).optional().describe("Positional arguments."),
      timeout_ms: z.number().int().min(100).max(60_000).optional().describe("How long to wait for the result. Default 10000."),
    },
    timeoutFor: (a) => Number(a.timeout_ms ?? 10_000) + GRACE_MS,
  },
  {
    name: "game_wait_for",
    method: "game.wait_for",
    title: "Wait for game condition",
    description:
      "Wait until a property of a node in the running game (or the return value of one of its methods, e.g. " +
      "{method: 'summary', property: 'state'}) satisfies a condition, checked every frame. " +
      "Fails with TIMEOUT and the last observed value. timeout_ms=0 checks once (an assertion). " +
      "op changed/increased/decreased waits for a change from the value seen when waiting starts.",
    check: checkConditionTarget,
    input: {
      node: ConditionSchema.shape.node,
      property: ConditionSchema.shape.property,
      method: ConditionSchema.shape.method,
      args: ConditionSchema.shape.args,
      op: ConditionSchema.shape.op,
      value: JsonValue.optional().describe("Expected value: a number, boolean, string, null or array (vectors as [x, y]). Not used by changed/increased/decreased."),
      timeout_ms: z.number().int().min(0).max(120_000).optional().describe("Default 5000."),
      tolerance: ConditionSchema.shape.tolerance,
      message: ConditionSchema.shape.message,
    },
    readOnly: true,
    timeoutFor: (a) => Number(a.timeout_ms ?? 5000) + GRACE_MS,
  },
  {
    name: "logs_read",
    method: "logs.read",
    title: "Read logs",
    description:
      "Read captured output: prints, errors and warnings (with file/line and stack when available). " +
      "source='game' (default; kept after the game stops) or 'editor'. Pass the returned 'next' as 'since' to read only new entries.",
    input: {
      source: z.enum(["game", "editor"]).optional(),
      since: z.number().int().min(0).optional().describe("Cursor from a previous call's 'next'."),
      min_level: z.enum(["info", "warning", "error"]).optional().describe("Default 'info'."),
      limit: z.number().int().min(1).max(2000).optional().describe("Default 200."),
    },
    readOnly: true,
  },
];

export function registerPlayTools(server: McpServer, conn: GodotConnection): void {
  for (const def of PLAY_TOOLS) registerForwardTool(server, conn, def);

  server.registerTool(
    "screenshot",
    {
      title: "Screenshot",
      description:
        "Capture an image of the running game (target='game', default) or of the editor's 2D/3D viewport (target='editor'). " +
        "Game captures are scaled to the project's viewport size (normalize='viewport') so repeated screenshots compare like " +
        "for like; pass normalize='none' to keep the window size. The text says the size and, when it differed, the window size. " +
        "Not available when running headless.",
      inputSchema: {
        target: z.enum(["game", "editor"]).optional(),
        max_width: z.number().int().min(64).max(2560).optional().describe("Downscale to at most this width (default 1280)."),
        normalize: z
          .enum(["viewport", "none"])
          .optional()
          .describe("Game only: scale to the project's viewport size (default) or keep the window size (editor captures are unchanged)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async (args: Record<string, unknown>) => {
      const r = (await conn.call("screenshot", dropUndefined(args ?? {}), { timeoutMs: 30_000 })) as {
        png_base64: string;
        width: number;
        height: number;
        target: string;
        source_width?: number;
        source_height?: number;
      };
      const fromWindow =
        r.source_width !== undefined && r.source_height !== undefined
          ? ` (window ${r.source_width}x${r.source_height}, scaled to the viewport)`
          : "";
      return {
        content: [
          { type: "image" as const, data: r.png_base64, mimeType: "image/png" },
          { type: "text" as const, text: `${r.target} screenshot ${r.width}x${r.height}${fromWindow}` },
        ],
      };
    }),
  );
}

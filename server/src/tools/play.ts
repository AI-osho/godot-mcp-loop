import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GodotConnection } from "../connection.js";
import { dropUndefined, registerForwardTool, type ForwardToolDef } from "./forward.js";
import { safe } from "./helpers.js";
import { JsonValue, PropertyMap } from "./schemas.js";

const GRACE_MS = 10_000;

const GAME_NODE =
  "Node in the running game: relative to the running scene (e.g. 'Player') or absolute (e.g. '/root/Main/Player').";

const Step = z
  .object({
    action: z.string().optional().describe("Input action name from the project's Input Map, e.g. 'move_right'."),
    hold_ms: z.number().int().min(0).max(60_000).optional().describe("How long to hold the action/key/button (default 100 ms for actions)."),
    press: z.boolean().optional().describe("With 'action': press and keep it held (no release)."),
    release: z.boolean().optional().describe("With 'action': release a previously pressed action."),
    strength: z.number().min(0).max(1).optional().describe("Analog strength for actions (default 1)."),
    key: z.string().optional().describe("Physical key name, e.g. 'Space', 'A', 'Escape', 'Left'."),
    mouse_move: z.tuple([z.number(), z.number()]).optional().describe("Move the mouse to [x, y] (viewport pixels)."),
    mouse_click: z.tuple([z.number(), z.number()]).optional().describe("Click at [x, y] (viewport pixels)."),
    button: z.enum(["left", "right"]).optional().describe("Mouse button for mouse_click (default left)."),
    wait_ms: z.number().int().min(0).max(60_000).optional().describe("Wait after this step (or alone: just wait)."),
  })
  .describe("One input step. Use exactly one of action, key, mouse_move, mouse_click, or only wait_ms.");

export function inputTimeoutMs(args: Record<string, unknown>): number {
  const steps = Array.isArray(args.steps) ? (args.steps as Array<Record<string, unknown>>) : [];
  let total = 0;
  for (const s of steps) total += Number(s.hold_ms ?? 100) + Number(s.wait_ms ?? 0);
  return total + GRACE_MS;
}

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
      "without, returns the node's class, children and common properties plus script variables.",
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
      "Play a sequence of input steps in the running game (actions, keys, mouse), in order and with real timing. " +
      "Returns when the whole sequence has finished. To observe something brief (e.g. the top of a jump), pass " +
      "'record': the properties are sampled every frame while the steps run, and min/max (with times) are returned. " +
      "min/max are computed from every recorded frame (up to 3000 frames); only the returned sample list is thinned " +
      "to 50 entries, so interval_ms is not needed for accuracy. Add a final {wait_ms} step to keep recording after the input ends.",
    input: {
      steps: z.array(Step).min(1).max(200),
      record: z
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
          mode: z
            .enum(["all", "changes"])
            .optional()
            .describe("'all' (default) keeps every frame; 'changes' keeps a sample only when a value differs from the previous one."),
        })
        .optional()
        .describe(
          "Sample node properties during the sequence. Returns summary {min, max, min_at_ms, max_at_ms, first, last} over every recorded frame, " +
            "samples_total, and an evenly thinned list of at most 50 samples.",
        ),
    },
    timeoutFor: inputTimeoutMs,
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
      "Wait until a property of a node in the running game satisfies a condition, checked every frame. " +
      "Fails with TIMEOUT and the last observed value. timeout_ms=0 checks once (an assertion).",
    input: {
      node: z.string().describe(GAME_NODE),
      property: z.string().describe("Property name, e.g. 'position:x', 'visible', or a script variable."),
      op: z.enum(["==", "!=", ">", ">=", "<", "<=", "contains"]).describe("Comparison operator."),
      value: JsonValue.describe("Expected value: a number, boolean, string, null or array (vectors as [x, y]). Numbers compare with a small tolerance."),
      timeout_ms: z.number().int().min(0).max(120_000).optional().describe("Default 5000."),
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
        "Not available when running headless.",
      inputSchema: {
        target: z.enum(["game", "editor"]).optional(),
        max_width: z.number().int().min(64).max(2560).optional().describe("Downscale to at most this width (default 1280)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async (args: Record<string, unknown>) => {
      const r = (await conn.call("screenshot", dropUndefined(args ?? {}), { timeoutMs: 30_000 })) as {
        png_base64: string;
        width: number;
        height: number;
        target: string;
      };
      return {
        content: [
          { type: "image" as const, data: r.png_base64, mimeType: "image/png" },
          { type: "text" as const, text: `${r.target} screenshot ${r.width}x${r.height}` },
        ],
      };
    }),
  );
}

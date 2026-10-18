import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GodotConnection } from "../connection.js";
import type { EditorLauncher } from "../editor-launcher.js";
import { editorRunning } from "../projects.js";
import { buildStatus } from "./status.js";
import { jsonResult, safe } from "./helpers.js";

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

const DEFAULT_LAUNCH_MS = 120_000;
const DEFAULT_QUIT_MS = 20_000;

export function registerEditorTools(server: McpServer, conn: GodotConnection, launcher: EditorLauncher, opts: { progressMs?: number } = {}): void {
  const progressMs = opts.progressMs ?? 5000;

  server.registerTool(
    "editor_launch",
    {
      title: "Open the Godot editor",
      description:
        "Open the Godot editor on the current project and wait until the MCP Loop bridge answers, then return the same " +
        "fields as godot_status. Does nothing when an editor already runs for the project. Godot is found from the " +
        "server's --godot / GODOT_BIN, else PATH and the usual install folders (4.5+ required). The project needs the " +
        "MCP Loop addon installed and enabled. headless: true opens it without a window (no screenshots; for servers " +
        "and CI). The editor keeps running after the server stops; editor_quit closes editors opened here.",
      inputSchema: {
        headless: z.boolean().optional().describe("Start the editor without a window (default false)."),
        timeout_ms: z
          .number()
          .int()
          .min(1000)
          .max(600_000)
          .optional()
          .describe("How long to wait for the bridge (default 120000; the first open of a project imports every asset)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    safe(async (args: { headless?: boolean; timeout_ms?: number }, extra: Extra) => {
      if (editorRunning(conn.projectPath, (d) => conn.readSessionOf(d))) {
        return jsonResult({ launched: false, already_running: true, ...(await buildStatus(conn)) });
      }
      const token = extra?._meta?.progressToken;
      const started = Date.now();
      let last = started;
      let tick = 0;
      const onWait = () => {
        if (token === undefined || Date.now() - last < progressMs) return;
        last = Date.now();
        tick += 1;
        void extra
          .sendNotification({
            method: "notifications/progress",
            params: { progressToken: token, progress: tick, message: `editor starting (${Math.round((last - started) / 1000)} s)` },
          })
          .catch(() => undefined);
      };
      const r = await launcher.launch(conn, {
        timeoutMs: args.timeout_ms ?? DEFAULT_LAUNCH_MS,
        onWait,
        ...(args.headless !== undefined ? { headless: args.headless } : {}),
      });
      return jsonResult({ launched: true, pid: r.pid, godot_path: r.godot.path, log: r.log, ...(await buildStatus(conn)) });
    }),
  );

  server.registerTool(
    "editor_quit",
    {
      title: "Close the Godot editor",
      description:
        "Close the Godot editor of the current project — only one this server opened with editor_launch (an editor the " +
        "user opened is refused with EDITOR_NOT_LAUNCHED). Stops a running game, saves the open scenes unless save: false, " +
        "quits, and waits for the process to end (stopped with SIGTERM after timeout_ms).",
      inputSchema: {
        save: z.boolean().optional().describe("Save all open scenes first (default true)."),
        timeout_ms: z.number().int().min(1000).max(120_000).optional().describe("How long to wait for the editor to exit (default 20000)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    safe(async (args: { save?: boolean; timeout_ms?: number }) =>
      jsonResult(await launcher.quit(conn, { save: args.save !== false, timeoutMs: args.timeout_ms ?? DEFAULT_QUIT_MS })),
    ),
  );
}

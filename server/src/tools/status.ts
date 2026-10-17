import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GodotConnection } from "../connection.js";
import { SERVER_VERSION } from "../version.js";
import { jsonResult, safe } from "./helpers.js";

export function registerStatusTools(server: McpServer, conn: GodotConnection): void {
  server.registerTool(
    "godot_status",
    {
      title: "Godot status",
      description:
        "Check the connection to the Godot editor and get basic state: Godot version, project name, " +
        "currently edited scene and whether the game is running. Call this first.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    safe(async () => {
      const editor = (await conn.call("editor.status")) as Record<string, unknown>;
      const info = conn.serverInfo();
      const addon = info?.addon_version;
      const mismatch = addon !== undefined && addon !== SERVER_VERSION;
      return jsonResult({
        connected: conn.isConnected(),
        godot_version: info?.godot_version,
        addon_version: addon,
        server_version: SERVER_VERSION,
        ...(mismatch
          ? {
              warning:
                `The Godot addon is ${addon} but this MCP server is ${SERVER_VERSION}. Tools may be missing or behave ` +
                "differently. Update the older side; after updating the server, restart it in your MCP client " +
                "(Claude Code: /mcp -> godot-loop -> Reconnect).",
            }
          : {}),
        project_path: conn.projectPath,
        ...editor,
      });
    }),
  );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GodotConnection } from "../connection.js";
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
      return jsonResult({
        connected: conn.isConnected(),
        godot_version: info?.godot_version,
        addon_version: info?.addon_version,
        project_path: conn.projectPath,
        ...editor,
      });
    }),
  );
}

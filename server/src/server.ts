import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GodotConnection } from "./connection.js";
import { registerEditingTools } from "./tools/editing.js";
import { registerPlayTools } from "./tools/play.js";
import { registerScenarioTools } from "./tools/scenario.js";
import { registerStatusTools } from "./tools/status.js";
import { SERVER_VERSION } from "./version.js";

export const SERVER_NAME = "godot-mcp-loop";
export { SERVER_VERSION } from "./version.js";

const INSTRUCTIONS = `godot-mcp-loop drives a live Godot 4 editor.
Workflow: godot_status -> inspect (scene_tree, node_get, script_read) -> edit (node_*, script_write/script_edit, file_write, image_write, input_action_set) -> verify (game_run, game_input with record, game_set/game_call for test setup, game_query, game_wait_for, screenshot, logs_read) -> scenario_run.
All edits go through the editor's undo history; use dry_run=true to preview and edit_undo to revert.`;

export function createServer(conn: GodotConnection): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  registerStatusTools(server, conn);
  registerEditingTools(server, conn);
  registerPlayTools(server, conn);
  registerScenarioTools(server, conn);
  return server;
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GodotConnection } from "./connection.js";
import { EditorLauncher } from "./editor-launcher.js";
import { registerEditingTools } from "./tools/editing.js";
import { registerEditorTools } from "./tools/editor.js";
import { registerExportTools } from "./tools/export.js";
import { registerPlayTools } from "./tools/play.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerScenarioTools } from "./tools/scenario.js";
import { registerStatusTools } from "./tools/status.js";
import { registerTestTools } from "./tools/tests.js";
import { registerAuthoringTools } from "./tools/authoring.js";
import { registerTreeTools } from "./tools/tree.js";
import { SERVER_VERSION } from "./version.js";

export const SERVER_NAME = "godot-mcp-loop";
export { SERVER_VERSION } from "./version.js";

const INSTRUCTIONS = `godot-mcp-loop drives a live Godot 4 editor.
Workflow: godot_status -> inspect (scene_tree, node_get, script_read) -> edit (node_*, script_write/script_edit, file_write, image_write, input_action_set) -> verify (game_run, game_input with record, game_set/game_call for test setup, game_pause/game_step for frame-exact checks, game_query, game_wait_for, screenshot, logs_read) -> scenario_run; test_run runs GUT/GdUnit4 unit tests.
Editor scene/script/file edits go through the editor's undo history; use dry_run=true to preview and edit_undo to revert.
For illustrated 2D production: production_plan -> art_request (does not generate images; use the client's existing authorized GPT Image 2 medium producer) -> art_register with the actual PNG and reported quality -> asset_build -> asset_preview and asset_verify -> asset_scene_add -> scene_save -> game_run and ordinary input plus screenshot/log checks. Production records and generated builds are append-only artifacts, not editor undo entries; undoing a scene placement does not delete artwork. A processed preview is not a Godot screenshot.
If no editor is running, editor_launch opens one (editor_quit closes it). project_export builds a release export under res://build/ with one of the project's presets. With --projects-root, project_list and project_connect switch the server to another Godot project.`;

export interface ServerOptions {
  launcher?: EditorLauncher;
}

export function createServer(conn: GodotConnection, opts: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  const launcher = opts.launcher ?? new EditorLauncher();
  registerStatusTools(server, conn);
  registerProjectTools(server, conn);
  registerEditorTools(server, conn, launcher);
  registerExportTools(server, conn, launcher);
  registerEditingTools(server, conn);
  registerPlayTools(server, conn);
  registerScenarioTools(server, conn);
  registerTestTools(server, conn);
  registerAuthoringTools(server, conn);
  registerTreeTools(server, conn);
  return server;
}

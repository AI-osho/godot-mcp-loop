import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GodotConnection } from "../connection.js";
import { registerForwardTool, type ForwardToolDef } from "./forward.js";
import { PropertyMap } from "./schemas.js";

const VALUE_FORMATS =
  "Value formats: Vector2/3 as [x, y(, z)] or {x, y}; Color as '#rrggbb', '#rrggbbaa', a name like 'red', or [r, g, b, a] in 0..1; " +
  "NodePath/StringName as strings; Rect2 as [x, y, w, h]; resources as {\"res\": \"res://path\"} for a file, or " +
  "{\"new\": \"RectangleShape2D\", \"properties\": {\"size\": [32, 48]}} to create an embedded one (shapes, materials, styles; not scripts); null clears. " +
  "Nested fields can be set with Godot's indexed syntax, e.g. \"position:x\".";

const NODE_PATH =
  "Node path relative to the edited scene's root; '.' is the root itself (e.g. 'Player/Sprite2D').";

const DRY_RUN = z.boolean().optional().describe("Preview only: validate and describe the change without applying it.");

export const EDITING_TOOLS: ForwardToolDef[] = [
  {
    name: "project_info",
    method: "project.info",
    title: "Project info",
    description:
      "Project overview: name, main scene, autoloads, project-defined input actions and their events, and (optionally) a file list filtered by a glob.",
    input: {
      glob: z.string().optional().describe("If set, list res:// files matching this glob, e.g. '*.tscn' or 'scripts/**/*.gd'."),
      max_files: z.number().int().min(1).max(2000).optional().describe("Cap on listed files (default 200)."),
    },
    readOnly: true,
  },
  {
    name: "scene_open",
    method: "scene.open",
    title: "Open scene",
    description: "Open a scene in the editor and make it the edited scene. Subsequent node_* tools operate on it.",
    input: { path: z.string().describe("res:// path of a .tscn/.scn file.") },
  },
  {
    name: "scene_create",
    method: "scene.create",
    title: "Create scene",
    description: "Create a new scene file with a single root node and open it. Fails if the file already exists.",
    input: {
      path: z.string().describe("res:// path ending in .tscn, e.g. 'res://levels/level_1.tscn'. Folders are created."),
      root_type: z.string().describe("Root node class, e.g. 'Node2D', 'Node3D', 'Control', 'CharacterBody2D'."),
      root_name: z.string().optional().describe("Root node name (default: file name in PascalCase)."),
      dry_run: DRY_RUN,
    },
  },
  {
    name: "scene_save",
    method: "scene.save",
    title: "Save scene",
    description: "Save the currently edited scene to disk.",
    input: {},
  },
  {
    name: "scene_tree",
    method: "scene.tree",
    title: "Scene tree",
    description:
      "Node hierarchy of the edited scene: name, class, relative path, attached script and instanced scene for each node.",
    input: {
      path: z.string().optional().describe(`Subtree root. ${NODE_PATH} Default '.'.`),
      depth: z.number().int().min(0).max(64).optional().describe("Max depth below the subtree root (default 10)."),
    },
    readOnly: true,
  },
  {
    name: "node_add",
    method: "node.add",
    title: "Add node",
    description:
      "Add a node to the edited scene (undoable). Provide either 'type' (a class like 'Sprite2D') or 'scene' (a res:// .tscn to instance). " +
      `Initial properties are validated before anything is changed. ${VALUE_FORMATS}`,
    input: {
      parent: z.string().optional().describe(`Parent node. ${NODE_PATH} Default '.'.`),
      type: z.string().optional().describe("Node class to create."),
      scene: z.string().optional().describe("res:// path of a scene to instance instead of 'type'."),
      name: z.string().optional().describe("Node name (made unique among siblings if taken)."),
      properties: PropertyMap.optional().describe("Initial property values."),
      dry_run: DRY_RUN,
    },
  },
  {
    name: "node_delete",
    method: "node.delete",
    title: "Delete node",
    description: "Delete a node and its children from the edited scene (undoable with edit_undo). The scene root cannot be deleted.",
    input: { path: z.string().describe(NODE_PATH), dry_run: DRY_RUN },
    destructive: true,
  },
  {
    name: "node_get",
    method: "node.get",
    title: "Get node properties",
    description:
      "Read properties of a node in the edited scene. By default returns only properties that differ from the class default plus script variables.",
    input: {
      path: z.string().describe(NODE_PATH),
      properties: z.array(z.string()).optional().describe("Only these properties (supports 'position:x')."),
      changed_only: z.boolean().optional().describe("When no list is given: only non-default values (default true)."),
    },
    readOnly: true,
  },
  {
    name: "node_set",
    method: "node.set",
    title: "Set node properties",
    description:
      `Set one or more properties on a node as a single undoable action. All values are validated first; nothing changes if any is invalid. Returns before/after values. ${VALUE_FORMATS}`,
    input: {
      path: z.string().describe(NODE_PATH),
      properties: PropertyMap.describe("Property name -> new value."),
      dry_run: DRY_RUN,
    },
  },
  {
    name: "script_read",
    method: "script.read",
    title: "Read script",
    description: "Read a text resource inside the project (GDScript, shader, .tscn, .cfg ...).",
    input: { path: z.string().describe("res:// path.") },
    readOnly: true,
  },
  {
    name: "script_write",
    method: "script.write",
    title: "Write script",
    description:
      "Create or overwrite a GDScript (.gd) file. The code is compiled first; on errors nothing is written and the errors (with line numbers) are returned. " +
      "Returns a unified diff. Undoable with edit_undo.",
    input: {
      path: z.string().describe("res:// path ending in .gd."),
      content: z.string().describe("Full new file content."),
      dry_run: DRY_RUN,
    },
  },
  {
    name: "script_attach",
    method: "script.attach",
    title: "Attach script",
    description: "Attach an existing script to a node in the edited scene (undoable). Pass script=null to detach.",
    input: {
      node: z.string().describe(NODE_PATH),
      script: z.string().nullable().describe("res:// path of the script, or null to detach."),
      dry_run: DRY_RUN,
    },
  },
  {
    name: "edit_undo",
    method: "edit.undo",
    title: "Undo AI edits",
    description:
      "Undo the most recent edits made through this MCP server (node, property, script changes), newest first. " +
      "Stops without touching anything if a human made a later edit in the same history.",
    input: { steps: z.number().int().min(1).max(50).optional().describe("How many actions to undo (default 1).") },
    destructive: true,
  },
];

export function registerEditingTools(server: McpServer, conn: GodotConnection): void {
  for (const def of EDITING_TOOLS) registerForwardTool(server, conn, def);
}

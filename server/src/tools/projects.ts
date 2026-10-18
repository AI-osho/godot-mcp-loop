import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { realpathSync } from "node:fs";
import { z } from "zod";
import type { GodotConnection } from "../connection.js";
import { BridgeError } from "../errors.js";
import { addonInstalled, editorRunning, listProjects, readProjectName, resolveProjectTarget } from "../projects.js";
import { buildStatus } from "./status.js";
import { jsonResult, safe } from "./helpers.js";

const shq = (s: string): string => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);

function realOr(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** Telling the agent how the user (or editor_launch) gets the editor up for a project. */
export function openEditorHint(project: string, addon: boolean): string {
  if (!addon) {
    return (
      `The MCP Loop addon is not installed in ${project}. Ask the user to run ` +
      `\`npx godot-mcp-loop install-addon ${shq(project)}\` and open the project in Godot.`
    );
  }
  return `No Godot editor is running for this project. Open it (\`godot -e --path ${shq(project)}\`) with the MCP Loop plugin enabled; the tools connect as soon as it runs.`;
}

export function registerProjectTools(server: McpServer, conn: GodotConnection): void {
  server.registerTool(
    "project_list",
    {
      title: "List Godot projects",
      description:
        "List the Godot projects this server may switch to: folders with project.godot below the --projects-root folders " +
        "(up to 3 levels down, hidden folders skipped), each with its name, whether the MCP Loop addon is installed, whether " +
        "an editor is running for it, and which one is current. Use project_connect to switch.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    safe(async () => {
      const current = realOr(conn.projectPath);
      if (conn.projectsRoots.length === 0) {
        return jsonResult({
          current_project: conn.projectPath,
          projects_roots: [],
          switching_enabled: false,
          hint: "This server is bound to one project. Start it with --projects-root <folder> to list and switch projects.",
        });
      }
      const r = listProjects(conn.projectsRoots, { current, readSession: (d) => conn.readSessionOf(d) });
      return jsonResult({
        current_project: conn.projectPath,
        projects_roots: conn.projectsRoots,
        projects: r.projects,
        ...(r.truncated ? { truncated: true } : {}),
      });
    }),
  );

  server.registerTool(
    "project_connect",
    {
      title: "Switch project",
      description:
        "Point this running server at another Godot project, so the following tool calls work on it — one MCP registration " +
        "for many games. Only projects below the folders given with --projects-root are allowed (without it the server " +
        "stays on its --project). Returns the new project's status like godot_status, or, when no editor is open for it, " +
        "how to open one. The previous project's editor and game keep running. Don't switch while another tool call runs.",
      inputSchema: {
        path: z
          .string()
          .describe("Project folder (the one with project.godot): absolute, ~/..., or relative to a projects root, e.g. 'games/shooter'."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    safe(async (args: { path: string }) => {
      const target = resolveProjectTarget(conn.projectsRoots, args.path);
      const previous = conn.projectPath;
      const changed = realOr(previous) !== target;
      if (changed) conn.switchProject(target);
      const base = { changed, previous_project: previous };
      if (!editorRunning(target, (d) => conn.readSessionOf(d))) {
        const addon = addonInstalled(target);
        return jsonResult({
          ...base,
          project_path: target,
          project_name: readProjectName(target),
          connected: false,
          editor_running: false,
          addon_installed: addon,
          hint: openEditorHint(target, addon),
        });
      }
      try {
        return jsonResult({ ...base, editor_running: true, ...(await buildStatus(conn)) });
      } catch (e) {
        if (!(e instanceof BridgeError)) throw e;
        return jsonResult({
          ...base,
          project_path: target,
          project_name: readProjectName(target),
          connected: false,
          editor_running: true,
          error: `${e.code}: ${e.message}`,
          ...(e.hint ? { hint: e.hint } : {}),
        });
      }
    }),
  );
}

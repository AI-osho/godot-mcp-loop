import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { relative } from "node:path";
import { z } from "zod";
import type { GodotConnection } from "../connection.js";
import { BridgeError } from "../errors.js";
import type { EditorLauncher } from "../editor-launcher.js";
import { checkTemplates, defaultOutput, exportArgs, exportedFiles, readExportPresets, resolveExportOutput, runExport } from "../export.js";
import { jsonResult, safe, strict } from "./helpers.js";

/** project_export: Godot's own `--export-release`, confined to res://build/ and started without a shell. */
export function registerExportTools(server: McpServer, conn: GodotConnection, launcher: EditorLauncher): void {
  server.registerTool(
    "project_export",
    {
      title: "Export the project",
      description:
        "Export the project with one of its export_presets.cfg presets (Godot's `--export-release`, headless, fixed " +
        "argument list, no shell). The output always goes under res://build/ — pass `path` to choose the name, or " +
        "omit it for res://build/<preset>/ (index.html for Web). Returns the files written with their sizes, " +
        "plus the tail of Godot's log. Fails with TEMPLATES_MISSING when Godot has no export templates installed. " +
        "`dry_run` shows the command and the target without exporting.",
      inputSchema: strict({
        preset: z.string().min(1).describe("Preset name from export_presets.cfg (project_info can list them)."),
        path: z
          .string()
          .optional()
          .describe("Output under res://build/... — a folder or .html for Web, a file for the other platforms."),
        timeout_ms: z.number().int().min(10_000).max(900_000).optional().describe("Limit for the export process (default 600000)."),
        dry_run: z.boolean().optional().describe("Validate the preset and the path, show the command, export nothing."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    safe(async (args: Record<string, unknown>) => {
      const project = conn.projectPath;
      const presets = readExportPresets(project);
      const preset = presets.find((p) => p.name === args.preset);
      if (!preset) {
        throw new BridgeError(
          "PRESET_NOT_FOUND",
          `No export preset named "${String(args.preset)}".`,
          presets.length > 0 ? `Presets: ${presets.map((p) => p.name).join(", ")}.` : "Add one in Godot: Project > Export.",
        );
      }
      const target = resolveExportOutput(project, typeof args.path === "string" ? args.path : defaultOutput(preset));
      if (args.dry_run === true) {
        return jsonResult({
          dry_run: true,
          preset: preset.name,
          platform: preset.platform,
          output: target.res,
          command: ["<godot>", ...exportArgs(project, preset.name, target.abs)],
        });
      }
      const godot = await launcher.executable();
      checkTemplates(godot.version);
      const run = await runExport({
        projectPath: project,
        godotPath: godot.path,
        preset: preset.name,
        absOutput: target.abs,
        timeoutMs: typeof args.timeout_ms === "number" ? args.timeout_ms : 600_000,
      });
      const files = exportedFiles(target.abs).map((f) => ({ path: relative(project, f.path), size: f.size }));
      if (files.length === 0) {
        throw new BridgeError(
          "EXPORT_FAILED",
          "Godot reported success but wrote no files.",
          `Check that the preset exports to the expected place (${target.res}); the log is in the tool output of a normal run.`,
        );
      }
      const tail = run.log.trim().split(/\r?\n/).slice(-8).join("\n");
      return jsonResult({
        preset: preset.name,
        platform: preset.platform,
        output: target.res,
        files,
        bytes: files.reduce((n, f) => n + f.size, 0),
        duration_ms: run.duration_ms,
        log_tail: tail,
      });
    }),
  );
}

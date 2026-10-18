import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { GodotConnection } from "../connection.js";
import { BridgeError } from "../errors.js";
import { parseScenario } from "../scenario/schema.js";
import type { ForwardToolDef } from "./forward.js";
import { resolveProjectFile } from "./scenario.js";

const isYaml = (path: unknown): boolean => typeof path === "string" && /\.ya?ml$/i.test(path);

/** A YAML document with a `steps` list is treated as a scenario and validated (warning only). */
function scenarioWarnings(text: string): string[] {
  let data: unknown;
  try {
    data = parseYaml(text);
  } catch (e) {
    return [`The file is not valid YAML: ${(e as Error).message}`];
  }
  if (data === null || typeof data !== "object" || !("steps" in data)) return [];
  try {
    parseScenario(data);
    return [];
  } catch (e) {
    return [`This looks like a scenario but scenario_run would reject it: ${(e as Error).message}`];
  }
}

export const FILE_TOOLS: ForwardToolDef[] = [
  {
    name: "file_write",
    method: "file.write",
    title: "Write text file",
    description:
      "Create, overwrite or partially edit a text file in the project: .yaml/.yml (e.g. scenarios), .json, .md, .txt, .csv. " +
      "Give 'content' for the whole file or 'edits' (exact replacements, like script_edit). YAML syntax is checked before writing and " +
      "scenario files are validated (warnings); JSON must parse. Undoable with edit_undo. Use script_write for .gd files.",
    input: {
      path: z.string().describe("res:// path, e.g. 'res://tests/scenarios/jump.yaml'."),
      content: z.string().optional().describe("Full file content (creates or overwrites)."),
      edits: z
        .array(z.object({ old: z.string().min(1), new: z.string(), replace_all: z.boolean().optional() }))
        .min(1)
        .max(50)
        .optional()
        .describe("Exact text replacements applied in order to the existing file."),
      dry_run: z.boolean().optional().describe("Preview only: validate and return the diff without writing."),
    },
    check: (args) => {
      if (isYaml(args.path) && typeof args.content === "string") {
        try {
          parseYaml(args.content);
        } catch (e) {
          throw new BridgeError("INVALID_PARAMS", `Invalid YAML: ${(e as Error).message}`, "Nothing was written.");
        }
      }
    },
    after: (result, args, conn: GodotConnection) => {
      if (!isYaml(args.path)) return result;
      let text = typeof args.content === "string" ? args.content : undefined;
      if (text === undefined) {
        try {
          text = readFileSync(resolveProjectFile(conn.projectPath, String(args.path)), "utf8");
        } catch {
          return result;
        }
      }
      const warnings = scenarioWarnings(text);
      return warnings.length > 0 ? { ...(result as object), warnings } : result;
    },
  },
  {
    name: "image_write",
    method: "image.write",
    title: "Write pixel-art PNG",
    description:
      "Create a PNG sprite from text, NES-style: 'palette' maps single characters to colors and each string in 'rows' is one row of pixels " +
      "('.' and ' ' are transparent). 'frames' (a list of row lists) makes a horizontal sprite sheet for animation. Scaled with nearest " +
      "neighbour, imported immediately, undoable with edit_undo. Use the result as {\"res\": path} for a Sprite2D texture.",
    input: {
      path: z.string().describe("res:// path ending in .png."),
      palette: z
        .record(z.string(), z.union([z.string(), z.array(z.number()), z.null()]))
        .describe(
          "Character -> color ('#rrggbb', '#rrggbbaa', a name, or [r, g, b, a] in 0..1), e.g. {\"k\": \"#000000\", \"r\": \"#d82800\"}. " +
            "null or 'transparent' = see-through ('.' and ' ' already are).",
        ),
      rows: z.array(z.string()).max(256).optional().describe("One image: rows of palette characters, all the same length (max 256x256)."),
      frames: z
        .array(
          z
            .array(z.string(), {
              error: 'each frame is its own list of row strings: frames: [["..##..", ".####."], ["..##..", "#....#"]] (use rows for one image)',
            })
            .max(256),
        )
        .max(64)
        .optional()
        .describe('Several same-sized frames, laid out left to right. Each frame is a list of row strings: [["..##..", ...], ["..##..", ...]].'),
      scale: z.number().int().min(1).max(16).optional().describe("Integer upscale factor (default 1). Prefer 1 and scale the node instead."),
      mirror: z
        .enum(["x", "y", "xy"])
        .optional()
        .describe("Symmetric sprites: give only the left half ('x'), top half ('y') or top-left quarter ('xy'); the rest is mirrored."),
      mirror_overlap: z.boolean().optional().describe("Share the middle column/row instead of repeating it (odd widths/heights)."),
      dry_run: z.boolean().optional().describe("Validate and report the size without writing."),
    },
  },
  {
    name: "input_action_set",
    method: "input.action_set",
    title: "Set input action",
    description:
      "Add or replace an input action in the project's input map (project.godot), or remove it with remove: true. " +
      "Keys are matched by physical position (e.g. 'A', 'Space', 'Left', 'Shift'). Undoable with edit_undo. " +
      "A running game picks up changes after game_run with restart: true.",
    input: {
      name: z.string().describe("Action name, e.g. 'shoot' or 'move_up'."),
      keys: z.array(z.string()).max(16).optional(),
      mouse_buttons: z.array(z.enum(["left", "right", "middle"])).max(3).optional(),
      joypad_buttons: z.array(z.number().int().min(0).max(127)).max(16).optional(),
      deadzone: z.number().min(0).max(1).optional().describe("Default 0.2."),
      remove: z.boolean().optional().describe("Remove the action instead."),
      dry_run: z.boolean().optional(),
    },
  },
];

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { GodotConnection } from "../connection.js";
import { BridgeError } from "../errors.js";
import { makeMovie, type MovieOutput } from "../media/movie.js";
import { type EvidenceMovie, resolveEvidenceFolder, saveBatchEvidence, saveScenarioEvidence, type SavedEvidence, withoutImages } from "../scenario/evidence.js";
import { runScenario, type ScenarioReport } from "../scenario/runner.js";
import { parseScenario } from "../scenario/schema.js";
import { safe } from "./helpers.js";

/** Resolves a res:// or project-relative path, refusing anything outside the project. */
export function resolveProjectFile(projectPath: string, path: string): string {
  const rel = path.startsWith("res://") ? path.slice("res://".length) : path;
  if (isAbsolute(rel)) throw new BridgeError("PATH_FORBIDDEN", `Use a res:// or project-relative path (got ${path}).`);
  const root = realpathSync(projectPath);
  const full = resolve(root, rel);
  const r = relative(root, full);
  if (r.startsWith("..") || isAbsolute(r)) {
    throw new BridgeError("PATH_FORBIDDEN", `${path} is outside the project.`);
  }
  // Same rule as the addon's PathGuard: .godot/ holds the session token, .git/ the history.
  const protectedDir = (p: string) => [".godot", ".git"].includes(p.split(sep)[0] ?? "");
  if (protectedDir(r)) throw new BridgeError("PATH_FORBIDDEN", `Access under ${r.split(sep)[0]}/ is not allowed.`);
  if (!existsSync(full)) throw new BridgeError("FILE_NOT_FOUND", `Scenario file not found: ${path}`);
  // Re-check after resolving symlinks: a link inside the project may point outside it.
  const real = realpathSync(full);
  const rr = relative(root, real);
  if (rr.startsWith("..") || isAbsolute(rr) || protectedDir(rr)) {
    throw new BridgeError("PATH_FORBIDDEN", `${path} resolves outside the project or into a protected folder (symbolic link).`);
  }
  return real;
}

const ICON: Record<string, string> = { pass: "✓", fail: "✗", error: "✗", skip: "○", skipped: "-" };

export function summarise(r: ScenarioReport): string {
  const lines = [`Scenario "${r.name}": ${r.passed ? "PASSED" : "FAILED"} (${(r.duration_ms / 1000).toFixed(1)} s)`];
  if (r.setup_error) lines.push(`  Game did not start: ${r.setup_error}`);
  for (const s of r.steps) {
    const time = s.status === "skipped" ? "" : ` (${s.duration_ms} ms)`;
    const target = s.target ? ` ${s.target}` : "";
    const detail = s.detail as { value?: unknown; properties?: unknown; returned?: unknown } | undefined;
    const seen = detail?.value ?? detail?.properties ?? detail?.returned;
    let observed = s.status === "pass" && seen !== undefined ? ` → ${JSON.stringify(seen)}` : "";
    if (observed.length > 200) observed = `${observed.slice(0, 197)}...`;
    lines.push(
      `  ${ICON[s.status] ?? "?"} ${s.index + 1}. ${s.kind}${target}${time}${observed}${s.message ? ` — ${s.message}` : ""}`,
    );
  }
  if (r.errors.length > 0) {
    lines.push(`  Errors logged by the game: ${r.errors.length}`);
    for (const e of r.errors.slice(0, 3)) {
      const x = e as { message?: string; file?: string; line?: number };
      lines.push(`    - ${x.message ?? JSON.stringify(e)}${x.file ? ` (${x.file}${x.line ? `:${x.line}` : ""})` : ""}`);
    }
  }
  return lines.join("\n");
}

const SCENARIO_EXT = /\.(ya?ml|json)$/i;
const MAX_BATCH = 50;

/** Scenario files directly inside a folder (not recursive), in natural name order (2_ before 10_). */
export function listScenarioFolder(projectPath: string, path: string): string[] {
  const dir = resolveProjectFile(projectPath, path);
  const base = path.replace(/\/+$/, "");
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => (e.isFile() || e.isSymbolicLink()) && SCENARIO_EXT.test(e.name))
    .map((e) => e.name)
    // Natural order: 2_ before 10_, so a numbered folder runs in the order its author sees.
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }) || (a < b ? -1 : a > b ? 1 : 0));
  if (names.length === 0) throw new BridgeError("INVALID_PARAMS", `No scenario files (.yaml, .yml, .json) in ${path}.`);
  if (names.length > MAX_BATCH) throw new BridgeError("INVALID_PARAMS", `${path} has ${names.length} scenario files; the limit is ${MAX_BATCH}.`);
  return names.map((n) => `${base}/${n}`);
}

type BatchEntry = { path: string; report?: ScenarioReport; error?: string; skipped?: boolean };
type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export function summariseBatch(entries: BatchEntry[], ms: number): string {
  const passed = entries.filter((e) => e.report?.passed).length;
  const lines = [`Scenarios: ${passed}/${entries.length} passed (${(ms / 1000).toFixed(1)} s)`];
  for (const e of entries) {
    if (e.skipped) lines.push(`  - ${e.path} (not run)`);
    else if (e.error) lines.push(`  ✗ ${e.path} — ${e.error.length > 300 ? `${e.error.slice(0, 297)}...` : e.error}`);
    else if (e.report) {
      const r = e.report;
      lines.push(`  ${r.passed ? "✓" : "✗"} ${e.path} — "${r.name}" ${r.passed ? "" : "FAILED "}(${(r.duration_ms / 1000).toFixed(1)} s)`);
    }
  }
  const failed = entries.filter((e) => e.report && !e.report.passed);
  if (failed.length > 0) {
    lines.push("", "Failures:");
    for (const e of failed) lines.push(`${e.path}:`, summarise(e.report!));
  }
  return lines.join("\n");
}

type MovieArgs = { fps?: number; gif?: boolean; gif_fps?: number; max_width?: number; contact_sheet?: number; frames?: boolean; from_step?: number; to_step?: number };

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** "Movie: 240 frames at 30 fps (8.00 s of game time) → movie.gif 480×270, 120 frames at 15 fps (812 KB); contact.png (12 frames)" */
export function movieLine(m: MovieOutput, keepFrames: boolean): string {
  const usable = m.files.length;
  const parts = [`Movie: ${usable} frames at ${m.fps} fps (${m.seconds.toFixed(2)} s of game time)`];
  const outs: string[] = [];
  if (m.gif) outs.push(`movie.gif ${m.gif.width}×${m.gif.height}, ${m.gif.frames} frames at ${m.gif.fps} fps (${kb(m.gif.data.length)})`);
  if (m.contact) outs.push(`contact.png (${m.contact.frames} frames)`);
  if (keepFrames) outs.push(`frames/ (${usable} PNG files)`);
  if (outs.length > 0) parts.push(`→ ${outs.join("; ")}`);
  if (m.unreadable > 0) parts.push(`[${m.unreadable} unreadable frame${m.unreadable === 1 ? "" : "s"} skipped]`);
  return parts.join(" ");
}

/** One line for the summary; a failed save is reported there and does not hide the test result. */
function evidenceLine(save: () => SavedEvidence): string {
  try {
    const s = save();
    return `Evidence saved: ${s.dir} (${s.screenshots} screenshot${s.screenshots === 1 ? "" : "s"}, ${s.index})`;
  } catch (e) {
    return `Evidence not saved: ${e instanceof BridgeError ? `${e.code}: ${e.message}` : String(e)}`;
  }
}

export function registerScenarioTools(server: McpServer, conn: GodotConnection): void {
  server.registerTool(
    "scenario_run",
    {
      title: "Run scenario test",
      description:
        "Run a scripted play-test: (re)start the game, then execute steps in order — wait_for, assert, input, query, " +
        "screenshot, wait_ms, assert_no_errors, set, call, repeat — stopping at the first failure. Returns a summary with " +
        "per-step result, what was checked and the observed value, game errors, and screenshots; report='full' adds the JSON report. " +
        "Pass a YAML/JSON file in the project (path), a folder or a list of files (paths) to run several and get one summary, " +
        "or an inline scenario. save_to keeps the screenshots and a report as files in the project. movie records every frame " +
        "with Godot's Movie Maker (fixed frame rate, needs a game window) and saves movie.gif plus contact.png — a grid of " +
        "evenly spaced frames, also returned as an image so you can see the motion.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe("Scenario file, e.g. 'res://tests/scenarios/move.yaml', or a folder to run every .yaml/.yml/.json file in it (natural name order, so 2_ runs before 10_)."),
        paths: z.array(z.string()).min(1).max(MAX_BATCH).optional().describe("Several scenario files, run in the given order."),
        stop_on_failure: z.boolean().optional().describe("With a folder or paths: stop after the first scenario that does not pass."),
        scenario: z
          .union([z.string(), z.record(z.string(), z.any())])
          .optional()
          .describe("Inline scenario as YAML text or an object: {name, scene?, steps: [...]}."),
        include_screenshots: z
          .boolean()
          .optional()
          .describe("Attach screenshots as images (default true; for a folder or paths, default is failure screenshots only)."),
        report: z.enum(["summary", "full"]).optional().describe("'summary' (default) or 'full' to also return the JSON report."),
        save_to: z
          .string()
          .optional()
          .describe(
            "Folder in the project for evidence, e.g. 'res://qa/evidence/move': every screenshot as NN-label.png, report.md and " +
              "report.json (a folder run: one subfolder per scenario plus summary.md). Re-runs replace their own files; the editor " +
              "does not import the folder (.gdignore). Not undoable.",
          ),
        movie: z
          .object({
            fps: z.number().int().min(1).max(60).optional().describe("Recording rate (default 30). The game runs at this fixed step, as fast as it can render."),
            gif: z.boolean().optional().describe("Write movie.gif (default true)."),
            gif_fps: z.number().int().min(1).max(50).optional().describe("GIF frame rate (default 15; at most fps). Long recordings are thinned to 300 GIF frames."),
            max_width: z.number().int().min(64).max(1280).optional().describe("GIF width in pixels (default 480; never enlarged)."),
            contact_sheet: z.number().int().min(0).max(36).optional().describe("Frames in contact.png (default 12; 0 = none)."),
            frames: z.boolean().optional().describe("Also keep every recorded frame as frames/frameNNNNNNNN.png (default false)."),
            from_step: z
              .number()
              .int()
              .min(1)
              .max(500)
              .optional()
              .describe("First scenario step to keep in the GIF/contact sheet (1-based; default 1). The whole run is still recorded — the frames are cut afterwards."),
            to_step: z
              .number()
              .int()
              .min(1)
              .max(500)
              .optional()
              .describe("Last scenario step to keep (1-based, inclusive; default the last step)."),
          })
          .optional()
          .describe(
            "Record the run with Movie Maker (one scenario; needs save_to and a game window — not with --headless in Main Run Args). " +
              "Waits in the scenario are game time, so prefer frame-based steps for exact timing.",
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    safe(async (args: {
      path?: string;
      paths?: string[];
      stop_on_failure?: boolean;
      scenario?: unknown;
      include_screenshots?: boolean;
      report?: "summary" | "full";
      save_to?: string;
      movie?: MovieArgs;
    }, extra: Extra): Promise<CallToolResult> => {
      const given = [args.path, args.paths, args.scenario].filter((x) => x !== undefined).length;
      if (given !== 1) {
        throw new BridgeError("INVALID_PARAMS", "Provide exactly one of 'path', 'paths' or 'scenario'.");
      }
      if (args.movie !== undefined && args.save_to === undefined) {
        throw new BridgeError("INVALID_PARAMS", "movie needs save_to: the GIF and contact sheet are saved with the evidence.");
      }
      // Check the evidence folder before starting the game, so a bad save_to costs nothing.
      if (args.save_to !== undefined) resolveEvidenceFolder(conn.projectPath, args.save_to, false);
      let batch: string[] | undefined = args.paths;
      if (args.path !== undefined && statSync(resolveProjectFile(conn.projectPath, args.path)).isDirectory()) {
        batch = listScenarioFolder(conn.projectPath, args.path);
      }
      if (batch !== undefined) {
        if (args.movie !== undefined) throw new BridgeError("INVALID_PARAMS", "movie records one scenario; give a single file or an inline scenario.");
        return runBatch(batch, args, extra);
      }
      const source = args.path !== undefined ? readFileSync(resolveProjectFile(conn.projectPath, args.path), "utf8") : args.scenario;
      const scenario = parseScenario(source);
      if (args.movie) {
        const total = scenario.steps.length;
        const from = args.movie.from_step;
        const to = args.movie.to_step;
        if ((from !== undefined && from > total) || (to !== undefined && to > total)) {
          throw new BridgeError("INVALID_PARAMS", `The scenario has ${total} steps; from_step/to_step must be between 1 and ${total}.`);
        }
        if (from !== undefined && to !== undefined && from > to) {
          throw new BridgeError("INVALID_PARAMS", "movie.from_step must not be after movie.to_step.");
        }
      }
      const fps = args.movie?.fps ?? 30;
      const report = await runScenario(scenario, (m, p, o) => conn.call(m, p ?? {}, o ?? {}), {
        ...(args.movie ? { movie: { fps } } : {}),
        projectPath: conn.projectPath,
      });
      let movie: EvidenceMovie | undefined;
      let movieNote: string | undefined;
      let range: { first: number; last: number } | undefined;
      if (args.movie && (args.movie.from_step !== undefined || args.movie.to_step !== undefined)) {
        const from = args.movie.from_step ?? 1;
        const to = args.movie.to_step ?? scenario.steps.length;
        const sf = report.movie?.step_frames;
        if (sf !== undefined && sf.length > 0) {
          const firstFrame = sf[from - 1] ?? 0;
          const lastFrame = sf[to] ?? sf[sf.length - 1]!;
          if (lastFrame > firstFrame) range = { first: firstFrame, last: lastFrame };
          else movieNote = `Movie range: steps ${from}–${to} cover no frames (${firstFrame}..${lastFrame}); the whole recording is used.`;
        } else {
          movieNote = "Movie range ignored: the recording did not report step frame positions.";
        }
      }
      if (args.movie && report.movie?.dir) {
        try {
          const output = makeMovie(report.movie.dir, {
            fps: report.movie.fps,
            ...(args.movie.gif !== undefined ? { gif: args.movie.gif } : {}),
            ...(args.movie.gif_fps !== undefined ? { gifFps: args.movie.gif_fps } : {}),
            ...(args.movie.max_width !== undefined ? { maxWidth: args.movie.max_width } : {}),
            ...(args.movie.contact_sheet !== undefined ? { contactFrames: args.movie.contact_sheet } : {}),
            ...(range !== undefined ? { range } : {}),
          });
          const keepFrames = args.movie.frames === true;
          movie = { output, keepFrames, line: movieLine(output, keepFrames) };
          if (range !== undefined) {
            const from = args.movie.from_step ?? 1;
            const to = args.movie.to_step ?? scenario.steps.length;
            movie.line += ` — trimmed to steps ${from}–${to} (frames ${range.first}–${range.last - 1} of the recording)`;
          }
          report.movie = { ...report.movie, frames: output.files.length, seconds: Math.round(output.seconds * 100) / 100 };
        } catch (e) {
          movieNote = `Movie not made: ${e instanceof BridgeError ? `${e.code}: ${e.message}` : String(e)}`;
        }
      }
      const full = args.report === "full";
      const shots = args.include_screenshots !== false
        ? [...report.screenshots, ...(report.failure_screenshot ? [report.failure_screenshot] : [])]
        : [];
      let summary = summarise(report);
      if (!full && shots.length > 0) summary += `\n  Screenshots (in order): ${shots.map((x) => x.label).join(", ")}`;
      if (movie) summary += `\n  ${movie.line}`;
      if (movieNote) summary += `\n  ${movieNote}`;
      if (args.save_to !== undefined) {
        const to = args.save_to;
        summary += `\n  ${evidenceLine(() => saveScenarioEvidence(conn.projectPath, to, report, summarise(report), args.path, movie))}`;
      }
      const content: CallToolResult["content"] = [{ type: "text", text: summary }];
      if (movie?.output.contact) {
        content.push({ type: "text", text: `Contact sheet: ${movie.output.contact.frames} frames, evenly spaced, each labelled "<game time>s (<frame>)"` });
        content.push({ type: "image", data: movie.output.contact.data.toString("base64"), mimeType: "image/png" });
      }
      if (full) content.push({ type: "text", text: JSON.stringify(withoutImages(report), null, 2) });
      for (const shot of shots) {
        if (full) content.push({ type: "text", text: `Screenshot: ${shot.label}` });
        content.push({ type: "image", data: shot.png_base64, mimeType: "image/png" });
      }
      return { content };
    }),
  );

  async function runBatch(
    paths: string[],
    args: { stop_on_failure?: boolean; include_screenshots?: boolean; report?: "summary" | "full"; save_to?: string },
    extra: Extra | undefined,
  ): Promise<CallToolResult> {
    const start = Date.now();
    const entries: BatchEntry[] = [];
    // One progress notification per scenario lets clients that reset their timeout on progress run long batches.
    const token = extra?._meta?.progressToken;
    const progress = async (done: number, message: string): Promise<void> => {
      if (token === undefined) return;
      await extra!
        .sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: done, total: paths.length, message } })
        .catch(() => undefined);
    };
    await progress(0, `running ${paths.length} scenarios`);
    let stop = false;
    for (const path of paths) {
      if (stop) {
        entries.push({ path, skipped: true });
        continue;
      }
      try {
        const scenario = parseScenario(readFileSync(resolveProjectFile(conn.projectPath, path), "utf8"));
        const report = await runScenario(scenario, (m, p, o) => conn.call(m, p ?? {}, o ?? {}));
        entries.push({ path, report });
      } catch (e) {
        entries.push({ path, error: e instanceof BridgeError ? `${e.code}: ${e.message}` : String(e) });
      }
      const last = entries[entries.length - 1]!;
      await progress(entries.length, `${path}: ${last.report?.passed ? "passed" : "failed"}`);
      if (args.stop_on_failure && !last.report?.passed) stop = true;
    }
    let text = summariseBatch(entries, Date.now() - start);
    if (args.save_to !== undefined) {
      const to = args.save_to;
      text += `\n${evidenceLine(() => saveBatchEvidence(conn.projectPath, to, entries, text, summarise))}`;
    }
    const content: CallToolResult["content"] = [{ type: "text", text }];
    if (args.report === "full") {
      const json = entries.map((e) => ({ ...e, report: e.report ? withoutImages(e.report) : undefined }));
      content.push({ type: "text", text: JSON.stringify(json, null, 2) });
    }
    if (args.include_screenshots !== false) {
      for (const e of entries) {
        if (!e.report) continue;
        const shots = args.include_screenshots === true ? [...e.report.screenshots] : [];
        if (e.report.failure_screenshot) shots.push(e.report.failure_screenshot);
        for (const shot of shots) {
          content.push({ type: "text", text: `Screenshot: ${e.path} — ${shot.label}` });
          content.push({ type: "image", data: shot.png_base64, mimeType: "image/png" });
        }
      }
    }
    return { content };
  }
}


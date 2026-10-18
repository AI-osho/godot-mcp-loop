import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { GodotConnection } from "../connection.js";
import { BridgeError } from "../errors.js";
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

/** Scenario files directly inside a folder (not recursive), in name order. */
export function listScenarioFolder(projectPath: string, path: string): string[] {
  const dir = resolveProjectFile(projectPath, path);
  const base = path.replace(/\/+$/, "");
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => (e.isFile() || e.isSymbolicLink()) && SCENARIO_EXT.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
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

function withoutImages(r: ScenarioReport): unknown {
  return {
    ...r,
    screenshots: r.screenshots.map(({ label, width, height }) => ({ label, width, height })),
    failure_screenshot: r.failure_screenshot ? { label: r.failure_screenshot.label } : undefined,
  };
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
        "or an inline scenario.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe("Scenario file, e.g. 'res://tests/scenarios/move.yaml', or a folder to run every .yaml/.yml/.json file in it (name order)."),
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
    }, extra: Extra): Promise<CallToolResult> => {
      const given = [args.path, args.paths, args.scenario].filter((x) => x !== undefined).length;
      if (given !== 1) {
        throw new BridgeError("INVALID_PARAMS", "Provide exactly one of 'path', 'paths' or 'scenario'.");
      }
      let batch: string[] | undefined = args.paths;
      if (args.path !== undefined && statSync(resolveProjectFile(conn.projectPath, args.path)).isDirectory()) {
        batch = listScenarioFolder(conn.projectPath, args.path);
      }
      if (batch !== undefined) return runBatch(batch, args, extra);
      const source = args.path !== undefined ? readFileSync(resolveProjectFile(conn.projectPath, args.path), "utf8") : args.scenario;
      const scenario = parseScenario(source);
      const report = await runScenario(scenario, (m, p, o) => conn.call(m, p ?? {}, o ?? {}));
      const full = args.report === "full";
      const shots = args.include_screenshots !== false
        ? [...report.screenshots, ...(report.failure_screenshot ? [report.failure_screenshot] : [])]
        : [];
      let summary = summarise(report);
      if (!full && shots.length > 0) summary += `\n  Screenshots (in order): ${shots.map((x) => x.label).join(", ")}`;
      const content: CallToolResult["content"] = [{ type: "text", text: summary }];
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
    args: { stop_on_failure?: boolean; include_screenshots?: boolean; report?: "summary" | "full" },
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
    const content: CallToolResult["content"] = [{ type: "text", text: summariseBatch(entries, Date.now() - start) }];
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


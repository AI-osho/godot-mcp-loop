import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync, realpathSync } from "node:fs";
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
        "Pass a YAML/JSON file in the project (path) or an inline scenario.",
      inputSchema: {
        path: z.string().optional().describe("Scenario file, e.g. 'res://tests/scenarios/move.yaml'."),
        scenario: z
          .union([z.string(), z.record(z.string(), z.any())])
          .optional()
          .describe("Inline scenario as YAML text or an object: {name, scene?, steps: [...]}."),
        include_screenshots: z.boolean().optional().describe("Attach screenshots as images (default true)."),
        report: z.enum(["summary", "full"]).optional().describe("'summary' (default) or 'full' to also return the JSON report."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    safe(async (args: { path?: string; scenario?: unknown; include_screenshots?: boolean; report?: "summary" | "full" }): Promise<CallToolResult> => {
      if ((args.path === undefined) === (args.scenario === undefined)) {
        throw new BridgeError("INVALID_PARAMS", "Provide exactly one of 'path' or 'scenario'.");
      }
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
}


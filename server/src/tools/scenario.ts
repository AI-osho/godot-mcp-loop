import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
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
  if (!existsSync(full)) throw new BridgeError("FILE_NOT_FOUND", `Scenario file not found: ${path}`);
  // Re-check after resolving symlinks: a link inside the project may point outside it.
  const real = realpathSync(full);
  const rr = relative(root, real);
  if (rr.startsWith("..") || isAbsolute(rr)) {
    throw new BridgeError("PATH_FORBIDDEN", `${path} resolves outside the project (symbolic link).`);
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
    const value = (s.detail as { value?: unknown } | undefined)?.value;
    const observed = s.status === "pass" && value !== undefined ? ` → ${JSON.stringify(value)}` : "";
    lines.push(
      `  ${ICON[s.status] ?? "?"} ${s.index + 1}. ${s.kind}${target}${time}${observed}${s.message ? ` — ${s.message}` : ""}`,
    );
  }
  if (r.errors.length > 0) lines.push(`  Errors logged by the game: ${r.errors.length} (see report.errors)`);
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
        "screenshot, wait_ms, assert_no_errors — stopping at the first failure. Returns a pass/fail report with per-step " +
        "timing, the failing value, game errors, and screenshots. Pass a YAML/JSON file in the project (path) or an inline scenario.",
      inputSchema: {
        path: z.string().optional().describe("Scenario file, e.g. 'res://tests/scenarios/move.yaml'."),
        scenario: z
          .union([z.string(), z.record(z.string(), z.any())])
          .optional()
          .describe("Inline scenario as YAML text or an object: {name, scene?, steps: [...]}."),
        include_screenshots: z.boolean().optional().describe("Attach screenshots as images (default true)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    safe(async (args: { path?: string; scenario?: unknown; include_screenshots?: boolean }): Promise<CallToolResult> => {
      if ((args.path === undefined) === (args.scenario === undefined)) {
        throw new BridgeError("INVALID_PARAMS", "Provide exactly one of 'path' or 'scenario'.");
      }
      const source = args.path !== undefined ? readFileSync(resolveProjectFile(conn.projectPath, args.path), "utf8") : args.scenario;
      const scenario = parseScenario(source);
      const report = await runScenario(scenario, (m, p, o) => conn.call(m, p ?? {}, o ?? {}));
      const content: CallToolResult["content"] = [
        { type: "text", text: summarise(report) },
        { type: "text", text: JSON.stringify(withoutImages(report), null, 2) },
      ];
      if (args.include_screenshots !== false) {
        for (const shot of [...report.screenshots, ...(report.failure_screenshot ? [report.failure_screenshot] : [])]) {
          content.push({ type: "text", text: `Screenshot: ${shot.label}` });
          content.push({ type: "image", data: shot.png_base64, mimeType: "image/png" });
        }
      }
      return { content };
    }),
  );
}


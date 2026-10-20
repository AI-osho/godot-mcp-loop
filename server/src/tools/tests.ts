import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GodotConnection } from "../connection.js";
import { dropUndefined } from "./forward.js";
import { safe, strict } from "./helpers.js";

/** What the addon's tests.run returns (addons/mcp_loop/commands/test_commands.gd build_result). */
export interface TestRunResult {
  framework: "gut" | "gdunit4";
  path: string;
  exit_code: number;
  duration_ms: number;
  passed: boolean;
  totals: { tests: number; passed: number; failed: number; errors: number; skipped: number };
  failures: Array<{ suite: string; name: string; status: string; message: string }>;
  tests?: Array<{ suite: string; name: string; status: string }>;
  report_error?: string;
  log_errors?: string[];
  log_tail?: string[];
}

const NAMES = { gut: "GUT", gdunit4: "GdUnit4" } as const;
const DEFAULT_TIMEOUT_MS = 120_000;
const GRACE_MS = 15_000;

const oneLine = (s: string, max = 240): string => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
};

export function summariseTests(r: TestRunResult): string {
  const t = r.totals;
  const head = `Tests (${NAMES[r.framework] ?? r.framework}, ${r.path}): ${r.passed ? "PASSED" : "FAILED"} — `;
  const secs = `(${(r.duration_ms / 1000).toFixed(1)} s)`;
  let counts: string;
  if (t.tests === 0) counts = `no results ${secs}`;
  else {
    const parts = [`${t.passed}/${t.tests} passed`];
    if (t.failed) parts.push(`${t.failed} failed`);
    if (t.errors) parts.push(`${t.errors} error${t.errors === 1 ? "" : "s"}`);
    if (t.skipped) parts.push(`${t.skipped} skipped`);
    counts = `${parts.join(", ")} ${secs}`;
  }
  const lines = [head + counts];
  if (r.report_error) lines.push(`  ${r.report_error}`);
  for (const f of r.failures) {
    const kind = f.status === "error" ? " (error)" : "";
    lines.push(`  ✗ ${f.suite} › ${f.name}${kind}${f.message ? ` — ${oneLine(f.message)}` : ""}`);
  }
  if (r.failures.length < t.failed + t.errors) lines.push(`  ... ${t.failed + t.errors - r.failures.length} more`);
  if (r.log_errors?.length) {
    lines.push("Errors in the log:", ...r.log_errors.map((e) => `  - ${oneLine(e, 300)}`));
  }
  if (!r.passed && r.log_tail?.length) {
    lines.push("Last log lines:", ...r.log_tail.map((l) => `  ${l}`));
  }
  return lines.join("\n");
}

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export function registerTestTools(server: McpServer, conn: GodotConnection, opts: { progressMs?: number } = {}): void {
  const progressMs = opts.progressMs ?? 10_000;
  server.registerTool(
    "test_run",
    {
      title: "Run unit tests",
      description:
        "Run the project's unit tests with GUT or GdUnit4 (whichever is installed in addons/) in a separate headless Godot " +
        "process started by the editor, and return pass/fail counts, every failing test with its message, and errors from the " +
        "log. Use it for game logic; use scenario_run for play. Failing tests are a normal result (not a tool error).",
      inputSchema: strict({
        framework: z.enum(["auto", "gut", "gdunit4"]).optional().describe("Default 'auto': the one installed."),
        path: z
          .string()
          .optional()
          .describe(
            "Test folder or one test script, e.g. 'res://test/unit' or 'res://test/unit/test_player.gd'. Default: res://test or " +
              "res://tests (GUT: the folders in res://.gutconfig.json when it exists).",
          ),
        test: z.string().optional().describe("GUT only: run the tests whose name contains this, e.g. 'test_jump'."),
        timeout_ms: z.number().int().min(5000).max(600_000).optional().describe("Stop the run after this long (default 120000)."),
        report: z.enum(["summary", "full"]).optional().describe("'full' adds the JSON result with every test's status."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    safe(async (args: { framework?: string; path?: string; test?: string; timeout_ms?: number; report?: "summary" | "full" }, extra: Extra) => {
      const { report, ...params } = args;
      const timeout = (params.timeout_ms ?? DEFAULT_TIMEOUT_MS) + GRACE_MS;
      // Clients that reset their timeout on progress keep long runs alive.
      const token = extra?._meta?.progressToken;
      const started = Date.now();
      let tick = 0;
      const timer =
        token === undefined
          ? undefined
          : setInterval(() => {
              tick += 1;
              void extra
                .sendNotification({
                  method: "notifications/progress",
                  params: { progressToken: token, progress: tick, message: `tests running (${Math.round((Date.now() - started) / 1000)} s)` },
                })
                .catch(() => undefined);
            }, progressMs);
      try {
        const result = (await conn.call("tests.run", dropUndefined(params), { timeoutMs: timeout })) as TestRunResult;
        const content: CallToolResult["content"] = [{ type: "text", text: summariseTests(result) }];
        if (report === "full") content.push({ type: "text", text: JSON.stringify(result, null, 2) });
        return { content };
      } finally {
        if (timer) clearInterval(timer);
      }
    }),
  );
}

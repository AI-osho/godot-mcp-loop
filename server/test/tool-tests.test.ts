import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GodotConnection } from "../src/connection.js";
import { registerTestTools, summariseTests, type TestRunResult } from "../src/tools/tests.js";
import { FakeAddon } from "./fake-addon.js";
import { connectClient, textOf } from "./helpers.js";

const PASSED: TestRunResult = {
  framework: "gut",
  path: "res://test",
  exit_code: 0,
  duration_ms: 3200,
  passed: true,
  totals: { tests: 12, passed: 11, failed: 0, errors: 0, skipped: 1 },
  failures: [],
};

const FAILED: TestRunResult = {
  framework: "gdunit4",
  path: "res://tests",
  exit_code: 100,
  duration_ms: 1000,
  passed: false,
  totals: { tests: 4, passed: 2, failed: 1, errors: 1, skipped: 0 },
  failures: [
    { suite: "tests/calc_test", name: "test_add_wrong", status: "failed", message: "Expecting:\n 5\n but was\n 4" },
    { suite: "tests/io_test", name: "test_load", status: "error", message: "Invalid call. Nonexistent function 'load_x'." },
  ],
  log_errors: ['SCRIPT ERROR: Invalid call. Nonexistent function \'load_x\'. (at: res://tests/io_test.gd:12)'],
  log_tail: ["Overall Summary: 4 test cases | 1 errors | 1 failures", "Exit code: 100"],
};

describe("test_run (#15)", () => {
  it("summarises a passing run in one line", () => {
    expect(summariseTests(PASSED)).toBe("Tests (GUT, res://test): PASSED — 11/12 passed, 1 skipped (3.2 s)");
  });

  it("lists failures with their messages, the log's errors and its last lines", () => {
    const text = summariseTests(FAILED);
    const lines = text.split("\n");
    expect(lines[0]).toBe("Tests (GdUnit4, res://tests): FAILED — 2/4 passed, 1 failed, 1 error (1.0 s)");
    expect(text).toContain("✗ tests/calc_test › test_add_wrong — Expecting: 5 but was 4");
    expect(text).toContain("✗ tests/io_test › test_load (error) — Invalid call.");
    expect(text).toContain("Errors in the log:\n  - SCRIPT ERROR: Invalid call.");
    expect(text).toContain("Last log lines:\n  Overall Summary");
  });

  it("says when no report or no tests came back", () => {
    const none = summariseTests({ ...FAILED, failures: [], totals: { tests: 0, passed: 0, failed: 0, errors: 0, skipped: 0 }, report_error: "No test report was written: The report is empty." });
    expect(none).toMatch(/^Tests \(GdUnit4, res:\/\/tests\): FAILED — no results/);
    expect(none).toContain("No test report was written");
  });

  describe("through the bridge", () => {
    let addon: FakeAddon;
    let conn: GodotConnection;
    let client: Client;

    beforeEach(async () => {
      addon = new FakeAddon();
      const port = await addon.start();
      conn = new GodotConnection({ projectPath: process.cwd(), readSession: () => ({ port, token: addon.token, protocol: 1, pid: process.pid }) });
    });
    afterEach(async () => {
      await client?.close();
      conn.close();
      await addon.stop();
    });

    it("forwards the arguments and returns the summary; report: full adds the JSON", async () => {
      client = await connectClient(conn);
      let seen: Record<string, unknown> = {};
      addon.handlers.set("tests.run", (p) => {
        seen = p as Record<string, unknown>;
        return { ok: true, result: FAILED };
      });
      const res = await client.callTool({
        name: "test_run",
        arguments: { framework: "gdunit4", path: "res://tests", timeout_ms: 30000, report: "full" },
      });
      expect(res.isError).toBeFalsy(); // failing tests are a result, not a tool error
      expect(seen).toEqual({ framework: "gdunit4", path: "res://tests", timeout_ms: 30000 });
      const content = res.content as Array<{ text: string }>;
      expect(content[0]!.text).toMatch(/^Tests \(GdUnit4/);
      expect(JSON.parse(content[1]!.text).totals.failed).toBe(1);
    });

    it("passes the addon's errors through (no framework installed)", async () => {
      client = await connectClient(conn);
      addon.handlers.set("tests.run", () => ({
        ok: false,
        error: { code: "TEST_FRAMEWORK_NOT_FOUND", message: "No test framework found", hint: "Install GUT or GdUnit4" },
      }));
      const res = await client.callTool({ name: "test_run", arguments: {} });
      expect(res.isError).toBe(true);
      expect(textOf(res)).toContain("TEST_FRAMEWORK_NOT_FOUND");
    });

    it("sends progress while a long run is going", async () => {
      const server = new McpServer({ name: "t", version: "0" });
      registerTestTools(server, conn, { progressMs: 50 });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      client = new Client({ name: "c", version: "0" });
      await client.connect(ct);
      addon.handlers.set("tests.run", async () => {
        await new Promise((r) => setTimeout(r, 300));
        return { ok: true, result: PASSED };
      });
      const seen: number[] = [];
      const res = await client.callTool({ name: "test_run", arguments: {} }, undefined, { onprogress: (p) => seen.push(p.progress) });
      expect(textOf(res)).toContain("PASSED");
      expect(seen.length).toBeGreaterThanOrEqual(2);
    });
  });
});

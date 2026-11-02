import { expect, it } from "vitest";
import { connectClient } from "../helpers.js";
import { startHeadlessEditor } from "./godot-harness.js";

// Publish closed diagnostic categories, never the child-controlled raw log or report.
function nativeDiagnostics(report: Record<string, any>): string {
  const errors: unknown[] = Array.isArray(report.log_errors) ? report.log_errors : [];
  const tags = ["queue_free", "tree", "null", "parent", "busy", "children", "thread", "deferred", "parse", "font", "texture", "display", "vulkan", "permission", "resource", "autoload", "condition", "xdg_runtime_dir", "environment", "directory", "file", "script", "load", "initialize"] as const;
  const tail: unknown[] = Array.isArray(report.log_tail) ? report.log_tail : [];
  const runtimeSite = [...errors.slice(0, 10), ...tail.slice(-25)].flatMap(line => typeof line === "string" ? [...line.matchAll(/runtime_agent\.gd:(\d{1,5})\b/g)].map(match => Number(match[1])) : []);
  return JSON.stringify({
    passed: typeof report.passed === "boolean" ? report.passed : null,
    exit_code: report.exit_code === 0 || report.exit_code === 1 ? report.exit_code : "other",
    report_error: report.report_error === undefined ? "absent" : "present",
    native_error_count: errors.length,
    runtime_agent_lines: [...new Set(runtimeSite)],
    native_error_categories: errors.slice(0, 10).map(error => {
      const text = typeof error === "string" ? error : "";
      const site = /runtime_agent\.gd:(\d{1,5})\b/.exec(text);
      return { tags: tags.filter(tag => new RegExp(`\\b${tag}\\b`, "i").test(text)), runtime_agent_line: site ? Number(site[1]) : null };
    }),
  });
}

it("keeps native diagnostics closed instead of echoing child-controlled output", () => {
  const opaque = "opaque-diagnostic-value-that-must-remain-private";
  const diagnostic = nativeDiagnostics({ passed: false, exit_code: 0, report_error: opaque,
    log_errors: [`ERROR: ${opaque} tree null queue_free (at: _ready (res://addons/mcp_loop/runtime/runtime_agent.gd:24))`],
    log_tail: [opaque], unrelated: opaque });
  expect(diagnostic.includes(opaque)).toBe(false);
  expect(JSON.parse(diagnostic)).toEqual({ passed: false, exit_code: 0, report_error: "present", native_error_count: 1, runtime_agent_lines: [24],
    native_error_categories: [{ tags: ["queue_free", "tree", "null"], runtime_agent_line: 24 }] });
});

// A local fault fixture, not a real GUT result: publish chosen XML, then choose the OS exit status.
function runner(exitCode: number, xml = '<testsuites><testsuite name="fault_fixture"><testcase name="reported_success"/></testsuite></testsuites>'): string {
  return `extends SceneTree
func _initialize() -> void:
  var report := ""
  for arg in OS.get_cmdline_args():
    if arg.begins_with("-gjunit_xml_file="):
      report = arg.trim_prefix("-gjunit_xml_file=")
  if report == "":
    quit(98)
    return
  var f := FileAccess.open(report, FileAccess.WRITE)
  if f == null:
    quit(99)
    return
  f.store_string(${JSON.stringify(xml)})
  f.close()
  f = null
  quit(${exitCode})
`;
}

it("rejects an actual native error with exit zero and a successful JUnit case", async () => {
  const noisy = runner(0).replace("  quit(0)", '  push_error("CONTROLLED_NATIVE_RUNNER_ERROR")\n  quit(0)');
  const h = await startHeadlessEditor({ extraFiles: { "addons/gut/gut_cmdln.gd": noisy, "test/placeholder.gd": "extends Node\n" } });
  const client = await connectClient(h.conn);
  try {
    const result = await client.callTool({ name: "test_run", arguments: { framework: "gut", path: "res://test", report: "full", timeout_ms: 10000 } });
    const blocks = (result.content as Array<{ type: string; text: string }>).filter(x => x.type === "text");
    expect(result.isError, JSON.stringify(blocks)).toBeFalsy();
    const report = JSON.parse(blocks[1]!.text);
    expect(report.exit_code).toBe(0);
    expect(report.totals.passed).toBe(1);
    expect(report.log_errors.join(" ")).toContain("CONTROLLED_NATIVE_RUNNER_ERROR");
    expect(report.passed).toBe(false);
    expect(blocks[0]!.text).toContain(": FAILED");
  } finally { await client.close(); await h.stop(); }
}, 120_000);

it.each([0, 1])("uses the real child exit code %i even when its XML reports success", async (exitCode) => {
  const h = await startHeadlessEditor({ extraFiles: { "addons/gut/gut_cmdln.gd": runner(exitCode), "test/placeholder.gd": "extends Node\n" } });
  const client = await connectClient(h.conn);
  try {
    const result = await client.callTool({ name: "test_run", arguments: { framework: "gut", path: "res://test", report: "full", timeout_ms: 10000 } });
    const blocks = (result.content as Array<{ type: string; text: string }>).filter((x) => x.type === "text");
    expect(result.isError, JSON.stringify(blocks)).toBeFalsy();
    const report = JSON.parse(blocks[1]!.text);
    expect(report.totals).toEqual({ tests: 1, passed: 1, failed: 0, errors: 0, skipped: 0 });
    expect(report.exit_code).toBe(exitCode);
    expect(report.passed, nativeDiagnostics(report)).toBe(exitCode === 0);
    expect(blocks[0]!.text).toContain(exitCode === 0 ? ": PASSED" : ": FAILED");
  } finally {
    await client.close();
    await h.stop();
  }
}, 120_000);

it.each([
  ["truncated", '<testsuites><testsuite name="fault_fixture"><testcase name="reported_success"/>'],
  ["mismatched", '<testsuite name="fault_fixture"><testcase name="reported_success"/></wrong>'],
  ["multiple roots", '<testsuite><testcase name="reported_success"/></testsuite><testsuite/>'],
  ["trailing text", '<testsuite><testcase name="reported_success"/></testsuite>not XML'],
])("rejects a real exit-zero runner's %s report", async (_kind, xml) => {
  const h = await startHeadlessEditor({ extraFiles: { "addons/gut/gut_cmdln.gd": runner(0, xml), "test/placeholder.gd": "extends Node\n" } });
  const client = await connectClient(h.conn);
  try {
    const result = await client.callTool({ name: "test_run", arguments: { framework: "gut", path: "res://test", report: "full", timeout_ms: 10000 } });
    const blocks = (result.content as Array<{ type: string; text: string }>).filter((x) => x.type === "text");
    expect(result.isError, JSON.stringify(blocks)).toBeFalsy();
    const report = JSON.parse(blocks[1]!.text);
    expect(report.exit_code).toBe(0);
    expect(report.passed).toBe(false);
    expect(report.report_error).toBeTruthy();
    expect(report.totals.passed).toBe(0);
    expect(blocks[0]!.text).toContain(": FAILED");
  } finally {
    await client.close();
    await h.stop();
  }
}, 120_000);

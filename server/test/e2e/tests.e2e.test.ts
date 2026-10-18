import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectClient } from "../helpers.js";
import { startHeadlessEditor, type GodotHarness } from "./godot-harness.js";

/** Pinned releases, verified by SHA-256 before use (downloads are cached between runs). */
const FRAMEWORKS = [
  {
    name: "gut",
    url: "https://github.com/bitwes/Gut/archive/refs/tags/v9.7.1.tar.gz",
    sha256: "6da99c4e9228d9bec3fb4bd1730a487770a989f0f511dac82a2897a964613385",
    addon: "Gut-9.7.1/addons/gut",
    to: "addons/gut",
  },
  {
    name: "gdunit4",
    url: "https://github.com/MikeSchulze/gdUnit4/archive/refs/tags/v6.2.2.tar.gz",
    sha256: "53ba53c23328d8f30205acc2f7ffe3d663773847d09b8f48edab1df6a5950571",
    addon: "gdUnit4-6.2.2/addons/gdUnit4",
    to: "addons/gdUnit4",
  },
] as const;

const CACHE = join(tmpdir(), "gml-e2e-test-frameworks");

async function fetchFramework(f: (typeof FRAMEWORKS)[number]): Promise<string> {
  const dir = join(CACHE, f.name);
  const tarball = join(CACHE, `${f.name}.tar.gz`);
  if (existsSync(join(dir, f.addon))) return join(dir, f.addon);
  mkdirSync(CACHE, { recursive: true });
  if (!existsSync(tarball)) {
    const res = await fetch(f.url);
    if (!res.ok) throw new Error(`download ${f.url}: HTTP ${res.status}`);
    writeFileSync(tarball, Buffer.from(await res.arrayBuffer()));
  }
  const sum = createHash("sha256").update(readFileSync(tarball)).digest("hex");
  if (sum !== f.sha256) {
    rmSync(tarball, { force: true });
    throw new Error(`${f.name}: checksum mismatch (${sum})`);
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync("tar", ["xzf", tarball, "-C", dir]);
  return join(dir, f.addon);
}

const GUT_TESTS = `extends GutTest

func test_add() -> void:
	assert_eq(2 + 3, 5)

func test_add_wrong() -> void:
	assert_eq(2 + 2, 5, "two plus two")

func test_pending() -> void:
	pending("not yet")
`;

const GUT_SLOW = `extends GutTest

func test_hangs() -> void:
	await wait_seconds(120)
	assert_true(true)
`;

const GDUNIT_TESTS = `extends GdUnitTestSuite

func test_add() -> void:
	assert_int(2 + 3).is_equal(5)

func test_add_wrong() -> void:
	assert_int(2 + 2).is_equal(5)
`;

describe("e2e: test_run with GUT and GdUnit4 (#15)", () => {
  let h: GodotHarness;
  let client: Client;

  async function run(args: Record<string, unknown>): Promise<{ text: string; json: any; isError: boolean }> {
    const res = await client.callTool({ name: "test_run", arguments: { report: "full", ...args } });
    const content = res.content as Array<{ text: string }>;
    return { text: content[0]!.text, json: res.isError ? undefined : JSON.parse(content[1]!.text), isError: Boolean(res.isError) };
  }

  beforeAll(async () => {
    const [gut, gdunit] = await Promise.all(FRAMEWORKS.map(fetchFramework));
    h = await startHeadlessEditor({
      copyFrom: [
        { from: gut!, to: "addons/gut" },
        { from: gdunit!, to: "addons/gdUnit4" },
      ],
      extraFiles: {
        "test/gut/test_calc.gd": GUT_TESTS,
        "slow/test_slow.gd": GUT_SLOW,
        "test/gdunit/calc_test.gd": GDUNIT_TESTS,
      },
    });
    client = await connectClient(h.conn);
  }, 180_000);
  afterAll(async () => {
    await client?.close();
    await h?.stop();
  });

  it("asks which framework when both are installed", async () => {
    const r = await run({});
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Both GUT and GdUnit4 are installed");
  });

  it("GUT: counts, the failing test with its message, and the pending one", async () => {
    const r = await run({ framework: "gut", path: "res://test/gut" });
    expect(r.isError, r.text).toBe(false);
    expect(r.text.split("\n")[0]).toMatch(/^Tests \(GUT, res:\/\/test\/gut\): FAILED — 1\/3 passed, 1 failed, 1 skipped/);
    expect(r.text).toMatch(/✗ test\/gut\/test_calc\.gd › test_add_wrong — \[4\] expected to equal \[5\]: +two plus two/);
    expect(r.json.exit_code).toBe(1);
    expect(r.json.tests.map((t: any) => t.status)).toEqual(["passed", "failed", "skipped"]);
  }, 120_000);

  it("GUT: one script and one test name", async () => {
    const r = await run({ framework: "gut", path: "res://test/gut/test_calc.gd", test: "test_add" });
    // "test_add" also matches test_add_wrong (GUT matches names containing the text).
    expect(r.json.tests.map((t: any) => t.name)).toEqual(["test_add", "test_add_wrong"]);
    const one = await run({ framework: "gut", path: "res://test/gut/test_calc.gd", test: "test_pending" });
    expect(one.json.totals).toEqual({ tests: 1, passed: 0, failed: 0, errors: 0, skipped: 1 });
    expect(one.json.passed).toBe(true);
  }, 120_000);

  it("GdUnit4: counts and the failure message with its location", async () => {
    const r = await run({ framework: "gdunit4", path: "res://test/gdunit" });
    expect(r.isError, r.text).toBe(false);
    expect(r.text.split("\n")[0]).toMatch(/^Tests \(GdUnit4, res:\/\/test\/gdunit\): FAILED — 1\/2 passed, 1 failed/);
    expect(r.text).toMatch(/test_add_wrong — FAILED: res:\/\/test\/gdunit\/calc_test\.gd:\d+ Expecting: 5 but was 4/);
  }, 120_000);

  it("stops a run at the timeout, and the next run works", async () => {
    const started = Date.now();
    const r = await run({ framework: "gut", path: "res://slow", timeout_ms: 5000 });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("TIMEOUT");
    expect(Date.now() - started).toBeLessThan(20_000);
    const again = await run({ framework: "gut", path: "res://test/gut/test_calc.gd", test: "test_pending" });
    expect(again.json.passed).toBe(true);
  }, 120_000);

  it("refuses paths outside the project", async () => {
    const r = await run({ framework: "gut", path: "res://../elsewhere" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("PATH_FORBIDDEN");
  });
});

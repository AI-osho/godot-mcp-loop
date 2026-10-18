import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeError } from "../src/errors.js";
import type { ScenarioReport } from "../src/scenario/runner.js";
import { mdCell, resolveEvidenceFolder, saveBatchEvidence, saveScenarioEvidence, shotFileName } from "../src/scenario/evidence.js";

const PNG_A = Buffer.from("png-a").toString("base64");
const PNG_B = Buffer.from("png-b").toString("base64");

function report(over: Partial<ScenarioReport> = {}): ScenarioReport {
  return {
    name: "move",
    passed: true,
    duration_ms: 1200,
    steps: [{ index: 0, kind: "assert", status: "pass", duration_ms: 3, target: "Player.x > 0" }],
    errors: [],
    screenshots: [
      { label: "start", png_base64: PNG_A, width: 4, height: 4 },
      { label: "after move", png_base64: PNG_B, width: 4, height: 4 },
    ],
    ...over,
  } as ScenarioReport;
}

describe("scenario evidence (#13)", () => {
  let project: string;
  let outside: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "gml-ev-"));
    outside = mkdtempSync(join(tmpdir(), "gml-ev-out-"));
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  const forbidden = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(BridgeError);
      expect((e as BridgeError).code).toBe("PATH_FORBIDDEN");
      return;
    }
    throw new Error("expected PATH_FORBIDDEN");
  };

  describe("resolveEvidenceFolder", () => {
    it("creates a nested folder inside the project and returns its res:// path", () => {
      const f = resolveEvidenceFolder(project, "res://qa/evidence/move/");
      expect(f.res).toBe("res://qa/evidence/move");
      expect(existsSync(join(project, "qa/evidence/move"))).toBe(true);
    });

    it("refuses the project root, paths outside, absolute paths and protected folders", () => {
      forbidden(() => resolveEvidenceFolder(project, "res://"));
      forbidden(() => resolveEvidenceFolder(project, "res://../escape"));
      forbidden(() => resolveEvidenceFolder(project, join(outside, "x")));
      forbidden(() => resolveEvidenceFolder(project, "res://.godot/evidence"));
      forbidden(() => resolveEvidenceFolder(project, "res://.git/evidence"));
      expect(existsSync(join(project, "..", "escape"))).toBe(false);
    });

    it("refuses a symlink in the project that points outside, without creating anything there", () => {
      symlinkSync(outside, join(project, "link"));
      forbidden(() => resolveEvidenceFolder(project, "res://link/evidence"));
      expect(readdirSync(outside)).toEqual([]);
    });

    it("refuses a path that is a file", () => {
      writeFileSync(join(project, "notes.txt"), "x");
      expect(() => resolveEvidenceFolder(project, "res://notes.txt")).toThrow(BridgeError);
    });
  });

  it("escapes table cells: backslashes before pipes, no line breaks", () => {
    expect(mdCell("a|b\\c\nd")).toBe("a\\|b\\\\c d");
    expect(mdCell("ends with \\")).toBe("ends with \\\\"); // a trailing backslash can't swallow the cell border
  });

  it("names screenshot files by position and a filesystem-safe label", () => {
    expect(shotFileName(0, "start")).toBe("01-start.png");
    expect(shotFileName(11, "Title screen / 1")).toBe("12-title-screen-1.png");
    expect(shotFileName(2, "../../etc")).toBe("03-etc.png");
    expect(shotFileName(3, "")).toBe("04-shot.png");
    expect(shotFileName(4, "x".repeat(200)).length).toBeLessThanOrEqual(3 + 48 + 4);
  });

  it("writes screenshots, a markdown report and a JSON manifest, and keeps Godot from importing them", () => {
    const failure = { label: "failure at step 2 (assert)", png_base64: PNG_B, width: 4, height: 4 };
    const saved = saveScenarioEvidence(project, "res://qa/move", report({ passed: false, failure_screenshot: failure }), "SUMMARY TEXT", "res://scenarios/move.yaml");
    const dir = join(project, "qa/move");
    expect(saved.dir).toBe("res://qa/move");
    expect(saved.files).toEqual(["01-start.png", "02-after-move.png", "failure.png", "report.md", "report.json"]);
    expect(readFileSync(join(dir, "01-start.png"), "utf8")).toBe("png-a");
    expect(readFileSync(join(dir, "failure.png"), "utf8")).toBe("png-b");
    expect(existsSync(join(dir, ".gdignore"))).toBe(true);
    const md = readFileSync(join(dir, "report.md"), "utf8");
    expect(md).toContain("FAILED");
    expect(md).toContain("SUMMARY TEXT");
    expect(md).toContain("res://scenarios/move.yaml");
    expect(md).toContain("![after move](02-after-move.png)");
    expect(md).toContain("(failure.png)");
    const json = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
    expect(json.generator).toBe("godot-mcp-loop");
    expect(json.passed).toBe(false);
    expect(json.files).toEqual(saved.files);
    expect(JSON.stringify(json)).not.toContain(PNG_A); // no image data in JSON
  });

  it("a re-run replaces its own previous files and leaves other files alone", () => {
    saveScenarioEvidence(project, "res://qa/move", report(), "first");
    writeFileSync(join(project, "qa/move/notes.txt"), "mine");
    saveScenarioEvidence(project, "res://qa/move", report({ screenshots: [{ label: "only", png_base64: PNG_A, width: 4, height: 4 }] }), "second");
    const names = readdirSync(join(project, "qa/move")).sort();
    expect(names).toEqual([".gdignore", "01-only.png", "notes.txt", "report.json", "report.md"]);
    expect(readFileSync(join(project, "qa/move/report.md"), "utf8")).toContain("second");
  });

  it("refuses a non-empty folder it did not create and deletes nothing", () => {
    mkdirSync(join(project, "art"));
    writeFileSync(join(project, "art/hero.png"), "art");
    expect(() => saveScenarioEvidence(project, "res://art", report(), "s")).toThrow(/not empty/);
    expect(readdirSync(join(project, "art"))).toEqual(["hero.png"]);
  });

  it("ignores manifest entries that point outside the folder", () => {
    writeFileSync(join(project, "victim.txt"), "keep");
    mkdirSync(join(project, "qa"));
    writeFileSync(
      join(project, "qa/report.json"),
      JSON.stringify({ generator: "godot-mcp-loop", files: ["../victim.txt", "/etc/hosts", "sub/../../victim.txt", "report.json"] }),
    );
    saveScenarioEvidence(project, "res://qa", report(), "s");
    expect(readFileSync(join(project, "victim.txt"), "utf8")).toBe("keep");
  });

  it("a batch gets one folder per scenario and a summary with links", () => {
    const entries = [
      { path: "res://scenarios/1_move.yaml", report: report() },
      { path: "res://scenarios/2_jump.yaml", report: report({ name: "jump", passed: false }) },
      { path: "res://scenarios/1_move.json", report: report({ screenshots: [] }) },
      { path: "res://scenarios/3_bad.yaml", error: "INVALID_PARAMS: steps missing" },
      { path: "res://scenarios/4_late.yaml", skipped: true },
    ];
    const saved = saveBatchEvidence(project, "res://qa/all", entries, "Scenarios: 2/5 passed");
    const dir = join(project, "qa/all");
    expect(readdirSync(dir).sort()).toEqual([".gdignore", "1_move", "1_move-2", "2_jump", "summary.json", "summary.md"]);
    expect(readFileSync(join(dir, "2_jump/02-after-move.png"), "utf8")).toBe("png-b");
    const md = readFileSync(join(dir, "summary.md"), "utf8");
    expect(md).toContain("Scenarios: 2/5 passed");
    expect(md).toContain("[report](2_jump/report.md)");
    expect(md).toContain("INVALID_PARAMS: steps missing");
    expect(md).toContain("not run");
    expect(saved.screenshots).toBe(4);

    // Re-run with fewer scenarios: the old per-scenario folders it wrote are removed.
    saveBatchEvidence(project, "res://qa/all", [entries[0]!], "Scenarios: 1/1 passed");
    expect(readdirSync(dir).sort()).toEqual([".gdignore", "1_move", "summary.json", "summary.md"]);
  });
});

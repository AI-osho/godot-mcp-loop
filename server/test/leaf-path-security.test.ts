import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installAddon } from "../src/cli.js";
import { resolveEvidenceFolder, saveScenarioEvidence } from "../src/scenario/evidence.js";
import type { ScenarioReport } from "../src/scenario/runner.js";

const report: ScenarioReport = { name: "fixture", passed: true, duration_ms: 0, steps: [], errors: [], screenshots: [] };

describe("per-file writes also enforce alias containment", () => {
  let base: string;
  let project: string;
  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "gml-leaf-security-")));
    project = join(base, "project"); mkdirSync(project);
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("does not truncate an external file through the evidence .gdignore", () => {
    const sentinel = join(base, "keep.txt"); writeFileSync(sentinel, "KEEP");
    mkdirSync(join(project, "qa"));
    linkSync(sentinel, join(project, "qa/.gdignore"));
    let error: unknown;
    try { saveScenarioEvidence(project, "res://qa", report, "fixture"); } catch (e) { error = e; }
    expect(readFileSync(sentinel, "utf8")).toBe("KEEP");
    expect(error).toMatchObject({ code: "PATH_FORBIDDEN" });
  });

  it("never follows an intermediate link during manifest cleanup, even within the evidence folder", () => {
    const qa = join(project, "qa"); mkdirSync(join(qa, "real"), { recursive: true });
    const victim = join(qa, "real/keep.txt"); writeFileSync(victim, "KEEP");
    symlinkSync(join(qa, "real"), join(qa, "alias"), "dir");
    writeFileSync(join(qa, "report.json"), JSON.stringify({ generator: "godot-mcp-loop", files: ["alias/keep.txt"] }));
    saveScenarioEvidence(project, "res://qa", report, "fixture");
    expect(existsSync(victim)).toBe(true);
    expect(readFileSync(victim, "utf8")).toBe("KEEP");
  });

  it("refuses to establish evidence ownership from an external linked manifest", () => {
    const manifest = join(base, "external-report.json");
    writeFileSync(manifest, JSON.stringify({ generator: "godot-mcp-loop", files: [] }));
    mkdirSync(join(project, "qa"));
    symlinkSync(manifest, join(project, "qa/report.json"));
    expect(() => resolveEvidenceFolder(project, "res://qa", false)).toThrowError(expect.objectContaining({ code: "PATH_FORBIDDEN" }));
  });

  it("does not enable the addon through a hard-linked project.godot", () => {
    const external = join(base, "external-project.godot");
    const before = 'config_version=5\n[application]\nconfig/name="KEEP"\n';
    writeFileSync(external, before); linkSync(external, join(project, "project.godot"));
    let error: unknown;
    try { installAddon({ project }); } catch (e) { error = e; }
    expect(readFileSync(external, "utf8")).toBe(before);
    expect(error).toBeInstanceOf(Error);
  });
});

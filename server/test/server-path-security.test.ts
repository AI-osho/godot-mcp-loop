import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodePng } from "../src/media/png.js";
import { readExportPresets, resolveExportOutput } from "../src/export.js";
import { resolveProjectFile } from "../src/tools/scenario.js";
import { resolveEvidenceFolder } from "../src/scenario/evidence.js";
import { matchScreenshot } from "../src/scenario/screenshot-match.js";

const shot = encodePng({ width: 1, height: 1, data: new Uint8Array([1, 2, 3, 255]) });

describe("baseline writer containment (the server's other file writer)", () => {
  let base: string;
  let project: string;
  let outside: string;
  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "gml-baseline-security-")));
    project = join(base, "project");
    outside = join(base, "outside");
    mkdirSync(project); mkdirSync(outside);
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("never overwrites an external file through a linked baseline", () => {
    const sentinel = join(outside, "keep.png");
    writeFileSync(sentinel, "DO NOT OVERWRITE");
    symlinkSync(sentinel, join(project, "baseline.png"), "file");
    let code: unknown;
    try { matchScreenshot(project, shot, { baseline: "res://baseline.png", update: true }); }
    catch (e) { code = (e as { code?: string }).code; }
    expect(readFileSync(sentinel, "utf8")).toBe("DO NOT OVERWRITE");
    expect(code).toBe("PATH_FORBIDDEN");
  });

  it.each([".GIT", ".Godot", "Addons"])("refuses a case variant of %s", (folder) => {
    mkdirSync(join(project, folder.toLowerCase()));
    let code: unknown;
    try { matchScreenshot(project, shot, { baseline: `res://${folder}/probe.png` }); }
    catch (e) { code = (e as { code?: string }).code; }
    expect(code).toBe("PATH_FORBIDDEN");
    expect(existsSync(join(project, folder, "probe.png"))).toBe(false);
  });

  it("refuses a linked export preset before reading it", () => {
    const cfg = join(outside, "private.cfg");
    writeFileSync(cfg, '[preset.0]\nname="private preset"\nplatform="Web"\n');
    symlinkSync(cfg, join(project, "export_presets.cfg"), "file");
    expect(() => readExportPresets(project)).toThrowError(/symbolic link/i);
  });

  it.each(["build/data:stream", "build/data\\\\file", "build/name\u0001x", "build/../qa/result"])(
    "applies the same forbidden-spelling rule to every server resolver: %s", (path) => {
      for (const fn of [
        () => resolveProjectFile(project, path),
        () => resolveEvidenceFolder(project, path, false),
        () => resolveExportOutput(project, path),
      ]) {
        let code: unknown;
        try { fn(); } catch (e) { code = (e as { code?: string }).code; }
        expect(code, path).toBe("PATH_FORBIDDEN");
      }
    },
  );
});

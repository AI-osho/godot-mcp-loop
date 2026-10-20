import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultOutput, exportArgs, exportedFiles, parseExportPresets, resolveExportOutput, templateVersion, templatesDir, checkTemplates } from "../src/export.js";
import { BridgeError } from "../src/errors.js";

const CFG = `
[preset.0]

name="Web"
platform="Web"
export_path="build/web/index.html"

[preset.0.options]

custom_template/debug=""

[preset.1]

name="Linux/X11"
platform="Linux"
export_path="build/linux/game.x86_64"

[preset.1.options]
`;

describe("export_presets.cfg", () => {
  it("reads name and platform of every preset, in index order", () => {
    expect(parseExportPresets(CFG)).toEqual([
      { index: 0, name: "Web", platform: "Web" },
      { index: 1, name: "Linux/X11", platform: "Linux" },
    ]);
  });

  it("defaults the output per platform, under res://build/", () => {
    const [web, linux] = parseExportPresets(CFG);
    expect(defaultOutput(web!)).toBe("res://build/web/index.html");
    expect(defaultOutput(linux!)).toBe("res://build/linux-x11/linux-x11.x86_64");
  });

  it("refuses a platform it has no default name for", () => {
    expect(() => defaultOutput({ index: 0, name: "Quest", platform: "Meta Quest" })).toThrowError(/No default output name/);
  });
});

describe("export output paths", () => {
  const project = "/tmp/some-project";

  it("accepts a path under res://build/", () => {
    expect(resolveExportOutput(project, "res://build/web/index.html")).toEqual({
      abs: "/tmp/some-project/build/web/index.html",
      res: "res://build/web/index.html",
    });
  });

  it("refuses anything outside res://build/", () => {
    for (const bad of ["res://web/index.html", "res://build", "res://./build", "/etc/passwd", "build/../../x.html", "res://build/../a.html", "res://build\\web\\index.html"]) {
      expect(() => resolveExportOutput(project, bad), bad).toThrowError(BridgeError);
    }
  });

  it("refuses a build path with no file inside", () => {
    expect(() => resolveExportOutput(project, "res://build/")).toThrowError(/under res:\/\/build\//);
  });
});

describe("godot arguments", () => {
  it("builds a fixed argument list (no shell, headless, release)", () => {
    expect(exportArgs("/p", "Web", "/p/build/web/index.html")).toEqual([
      "--headless",
      "--path",
      "/p",
      "--export-release",
      "Web",
      "/p/build/web/index.html",
    ]);
  });
});

describe("export templates", () => {
  it("turns a full version string into the templates folder name", () => {
    expect(templateVersion("4.7.2.stable.official.ed1daf0bf")).toBe("4.7.2.stable");
    expect(templateVersion("4.5.stable.mono")).toBe("4.5.stable");
  });

  it("looks in the platform's data folder", () => {
    expect(templatesDir("4.7.2.stable", { platform: "darwin", home: "/h" })).toBe("/h/Library/Application Support/Godot/export_templates/4.7.2.stable");
    expect(templatesDir("4.7.2.stable", { platform: "linux", home: "/h" })).toBe("/h/.local/share/godot/export_templates/4.7.2.stable");
    expect(templatesDir("4.7.2.stable", { platform: "win32", home: "/h", env: { APPDATA: "/a" } })).toBe("/a/Godot/export_templates/4.7.2.stable");
  });

  it("says what to do when they are missing", () => {
    const home = mkdtempSync(join(tmpdir(), "gml-tpl-"));
    try {
      checkTemplates("4.7.2.stable", { platform: "linux", home });
      expect.unreachable("should have refused");
    } catch (e) {
      const err = e as BridgeError;
      expect(err.code).toBe("TEMPLATES_MISSING");
      expect(err.message).toMatch(/no export templates/);
      expect(err.hint).toMatch(/Manage Export Templates/);
    }
    const dir = join(home, ".local", "share", "godot", "export_templates", "4.7.2.stable");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "version.txt"), "4.7.2.stable\n");
    expect(checkTemplates("4.7.2.stable", { platform: "linux", home })).toBe(dir);
  });
});

describe("what an export wrote", () => {
  it("lists the folder a Web export went into", () => {
    const dir = mkdtempSync(join(tmpdir(), "gml-export-"));
    writeFileSync(join(dir, "index.html"), "<html></html>");
    writeFileSync(join(dir, "index.wasm"), "wasm");
    const files = exportedFiles(join(dir, "index.html")).map((f) => f.path.split("/").pop());
    expect(files).toEqual(["index.html", "index.wasm"]);
  });
});

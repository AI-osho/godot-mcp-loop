import { linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorLauncher } from "../src/editor-launcher.js";
import { GodotConnection } from "../src/connection.js";
import { readSession } from "../src/session.js";
import { resolveProjectTarget } from "../src/projects.js";

// Internal fixed paths are deliberately outside the public tools' allowlist, but still cannot follow aliases.
describe("server internal path safety", () => {
  let base: string;
  let project: string;
  let work: string;
  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "gml-internal-security-")));
    project = join(base, "project");
    work = join(project, ".godot/mcp_loop");
    mkdirSync(work, { recursive: true });
    mkdirSync(join(project, "addons/mcp_loop"), { recursive: true });
    writeFileSync(join(project, "project.godot"), 'config_version=5\n[editor_plugins]\nenabled=PackedStringArray("res://addons/mcp_loop/plugin.cfg")\n');
    writeFileSync(join(project, "addons/mcp_loop/plugin.cfg"), '[plugin]\n');
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("does not truncate an external file through editor.log", async () => {
    const sentinel = join(base, "keep.txt");
    writeFileSync(sentinel, "KEEP");
    symlinkSync(sentinel, join(work, "editor.log"), "file");
    const launcher = new EditorLauncher({
      find: async () => ({ path: "/unused-godot", version: "4.7.2.stable", source: "--godot" }),
      spawn: () => { throw new Error("spawn must not be reached"); },
    });
    let error: unknown;
    try { await launcher.launch(new GodotConnection({ projectPath: project }), { timeoutMs: 1000 }); }
    catch (e) { error = e; }
    expect(readFileSync(sentinel, "utf8")).toBe("KEEP");
    expect(error).toMatchObject({ code: "PATH_FORBIDDEN" });
  });

  it("does not read an external session file", () => {
    const external = join(base, "other-session.json");
    writeFileSync(external, JSON.stringify({ port: 6510, token: "fixture", protocol: 1, pid: process.pid }));
    symlinkSync(external, join(work, "session.json"), "file");
    expect(() => readSession(project)).toThrowError(expect.objectContaining({ code: "PATH_FORBIDDEN" }));
  });

  it("refuses a hard-linked private session even with matching metadata", () => {
    const external = join(base, "shared-session.json");
    writeFileSync(external, JSON.stringify({ port: 6510, token: "fixture", protocol: 1, pid: process.pid, project_path: project }));
    linkSync(external, join(work, "session.json"));
    expect(() => readSession(project)).toThrowError(expect.objectContaining({ code: "PATH_FORBIDDEN" }));
  });

  it("refuses an oversized but valid private session before materializing its JSON", () => {
    writeFileSync(join(work, "session.json"), JSON.stringify({ port: 6510, token: "fixture", protocol: 1, pid: process.pid, project_path: project, padding: "x".repeat(128 * 1024) }));
    expect(() => readSession(project)).toThrowError(expect.objectContaining({ code: "BAD_SESSION_FILE" }));
  });

  it("does not accept a copied session from another project", () => {
    const other = join(base, "other-project"); mkdirSync(other);
    writeFileSync(join(work, "session.json"), JSON.stringify({ port: 6510, token: "fixture", protocol: 1, pid: process.pid, project_path: other }));
    expect(() => readSession(project)).toThrowError(expect.objectContaining({ code: "BAD_SESSION_FILE" }));
  });

  it.each([null, [], { port: -1, token: "fixture", protocol: 1, pid: process.pid }])("rejects malformed session metadata", (data) => {
    writeFileSync(join(work, "session.json"), JSON.stringify(data));
    expect(() => readSession(project)).toThrowError(expect.objectContaining({ code: "BAD_SESSION_FILE" }));
  });

  it.each([".GIT", ".Godot"])("does not switch into a case variant of %s", (folder) => {
    const target = join(base, folder, "hidden-project");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "project.godot"), "config_version=5\n");
    expect(() => resolveProjectTarget([base], target)).toThrowError(expect.objectContaining({ code: "PATH_FORBIDDEN" }));
  });
});

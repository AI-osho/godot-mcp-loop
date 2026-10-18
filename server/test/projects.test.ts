import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listProjects, parseServerArgs, resolveProjectTarget } from "../src/projects.js";

/** A folder with a project.godot (config/name = name) and, optionally, the addon. */
function makeProject(dir: string, name: string, addon = true): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "project.godot"), `config_version=5\n\n[application]\n\nconfig/name="${name}"\n`);
  if (addon) {
    mkdirSync(join(dir, "addons", "mcp_loop"), { recursive: true });
    writeFileSync(join(dir, "addons", "mcp_loop", "plugin.cfg"), '[plugin]\nversion="0.0.0"\n');
  }
  return dir;
}

describe("server arguments (#12)", () => {
  it("reads --project and repeatable --projects-root (both forms), resolving paths", () => {
    const a = parseServerArgs(["--project", "game", "--projects-root", "/games", "--projects-root=~/more"], {}, "/work");
    expect(a.project).toBe("/work/game");
    expect(a.projectsRoots).toEqual(["/games", join(homedir(), "more")]);
  });

  it("falls back to $GODOT_PROJECT_PATH / $GODOT_PROJECTS_ROOT (path-delimiter separated) and the cwd", () => {
    expect(parseServerArgs([], {}, "/work")).toMatchObject({ project: "/work", projectsRoots: [] });
    const a = parseServerArgs([], { GODOT_PROJECT_PATH: "/p", GODOT_PROJECTS_ROOT: `/a${delimiter}/b` }, "/work");
    expect(a).toMatchObject({ project: "/p", projectsRoots: ["/a", "/b"] });
    // Flags win over the environment.
    expect(parseServerArgs(["--projects-root", "/c"], { GODOT_PROJECTS_ROOT: "/a" }, "/w").projectsRoots).toEqual(["/c"]);
  });

  it("recognises --version and --help", () => {
    expect(parseServerArgs(["--version"], {}, "/")).toMatchObject({ version: true });
    expect(parseServerArgs(["-h"], {}, "/")).toMatchObject({ help: true });
  });

  it("reads --godot (both forms) for editor_launch", () => {
    expect(parseServerArgs(["--godot", "bin/godot"], {}, "/work").godot).toBe("/work/bin/godot");
    expect(parseServerArgs(["--godot=/opt/godot"], {}, "/work").godot).toBe("/opt/godot");
    expect(parseServerArgs([], {}, "/work").godot).toBeUndefined();
  });
});

describe("switching projects (#12)", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "gml-roots-")));
    outside = realpathSync(mkdtempSync(join(tmpdir(), "gml-outside-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("is disabled without --projects-root", () => {
    makeProject(join(root, "a"), "A");
    expect(() => resolveProjectTarget([], join(root, "a"))).toThrow(expect.objectContaining({ code: "PROJECT_SWITCH_DISABLED" }));
  });

  it("accepts an absolute path and a path relative to a root", () => {
    const a = makeProject(join(root, "games", "a"), "A");
    expect(resolveProjectTarget([root], a)).toBe(a);
    expect(resolveProjectTarget([root], "games/a")).toBe(a);
    expect(resolveProjectTarget([root], "games/a/")).toBe(a);
    // A root may itself be a project.
    makeProject(root, "Root");
    expect(resolveProjectTarget([root], root)).toBe(root);
  });

  it("tries each root in order for a relative path", () => {
    const second = realpathSync(mkdtempSync(join(tmpdir(), "gml-roots2-")));
    try {
      const b = makeProject(join(second, "b"), "B");
      expect(resolveProjectTarget([root, second], "b")).toBe(b);
    } finally {
      rmSync(second, { recursive: true, force: true });
    }
  });

  it("refuses folders outside the roots, also via a name prefix or a symbolic link", () => {
    const out = makeProject(join(outside, "x"), "X");
    expect(() => resolveProjectTarget([root], out)).toThrow(expect.objectContaining({ code: "PATH_FORBIDDEN" }));
    expect(() => resolveProjectTarget([root], "../x")).toThrow(expect.objectContaining({ code: "PATH_FORBIDDEN" }));
    makeProject(`${root}-sibling`, "S");
    try {
      expect(() => resolveProjectTarget([root], `${root}-sibling`)).toThrow(expect.objectContaining({ code: "PATH_FORBIDDEN" }));
    } finally {
      rmSync(`${root}-sibling`, { recursive: true, force: true });
    }
    symlinkSync(out, join(root, "link"));
    expect(() => resolveProjectTarget([root], join(root, "link"))).toThrow(expect.objectContaining({ code: "PATH_FORBIDDEN" }));
    expect(() => resolveProjectTarget([root], "link")).toThrow(expect.objectContaining({ code: "PATH_FORBIDDEN" }));
  });

  it("needs an existing folder with project.godot", () => {
    mkdirSync(join(root, "empty"));
    expect(() => resolveProjectTarget([root], "empty")).toThrow(expect.objectContaining({ code: "NOT_A_PROJECT" }));
    expect(() => resolveProjectTarget([root], "missing")).toThrow(expect.objectContaining({ code: "PROJECT_NOT_FOUND" }));
    expect(() => resolveProjectTarget([root], "")).toThrow(expect.objectContaining({ code: "INVALID_PARAMS" }));
  });

  it("refuses folders inside .godot/ or .git/", () => {
    makeProject(join(root, "a", ".git", "p"), "P");
    expect(() => resolveProjectTarget([root], "a/.git/p")).toThrow(expect.objectContaining({ code: "PATH_FORBIDDEN" }));
  });

  it("lists projects below the roots with name, addon and editor state, without hidden folders, node_modules or links", () => {
    const a = makeProject(join(root, "a"), "Alpha");
    const deep = makeProject(join(root, "x", "y", "deep"), "Deep", false);
    makeProject(join(root, "x", "y", "z", "too-deep"), "TooDeep");
    makeProject(join(root, ".hidden", "h"), "Hidden");
    makeProject(join(root, "node_modules", "n"), "Npm");
    makeProject(join(root, "a", "nested"), "Nested"); // inside a project: not listed separately
    makeProject(join(outside, "o"), "Outside");
    symlinkSync(join(outside, "o"), join(root, "linked"));

    const r = listProjects([root], { current: a, readSession: () => { throw new Error("not running"); } });
    expect(r.truncated).toBe(false);
    expect(r.projects).toEqual([
      { path: a, name: "Alpha", current: true, addon_installed: true, editor_running: false },
      { path: deep, name: "Deep", current: false, addon_installed: false, editor_running: false },
    ]);
  });

  it("reports a running editor (live session file) and caps the list", () => {
    for (let i = 0; i < 5; i++) makeProject(join(root, `p${i}`), `P${i}`);
    const running = join(root, "p1");
    const r = listProjects([root], {
      limit: 3,
      readSession: (dir) => {
        if (dir !== running) throw new Error("not running");
        return { port: 1, token: "t", protocol: 1, pid: process.pid };
      },
    });
    expect(r.truncated).toBe(true);
    expect(r.projects.map((p) => p.name)).toEqual(["P0", "P1", "P2"]);
    expect(r.projects.find((p) => p.name === "P1")?.editor_running).toBe(true);
  });
});

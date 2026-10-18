import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findGodot, godotCandidates, parseGodotVersion } from "../src/editor-launcher.js";

describe("finding the Godot executable", () => {
  let dir: string;
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "gml-godot-")));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const exe = (rel: string): string => {
    const p = join(dir, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, "", { mode: 0o755 });
    return p;
  };

  it("parses `godot --version` output", () => {
    expect(parseGodotVersion("4.7.2.stable.official.ed1daf0bf\n")).toEqual({ major: 4, minor: 7, patch: 2, text: "4.7.2.stable.official.ed1daf0bf" });
    expect(parseGodotVersion("Godot Engine v4.5.stable.official")).toMatchObject({ major: 4, minor: 5, patch: 0 });
    expect(parseGodotVersion("command not found")).toBeUndefined();
  });

  it("auto-detects from PATH (godot, godot4, Godot), then the platform's usual places", () => {
    const p1 = exe("bin1/godot4");
    const p2 = exe("bin2/godot");
    const app = exe("Applications/Godot.app/Contents/MacOS/Godot");
    const list = godotCandidates({
      env: { PATH: [join(dir, "bin1"), join(dir, "missing"), join(dir, "bin2")].join(delimiter) },
      platform: "darwin",
      home: join(dir, "home"),
      appDirs: [join(dir, "Applications")],
    });
    expect(list).toEqual([
      { path: p1, source: "PATH" },
      { path: p2, source: "PATH" },
      { path: app, source: "default" },
    ]);
  });

  it("uses only the configured executable when --godot or $GODOT_BIN is set (--godot first), even if it is missing", () => {
    const env = exe("env/godot");
    exe("bin/godot");
    const common = { platform: "linux" as const, home: dir, appDirs: [] };
    const PATH = join(dir, "bin");
    expect(godotCandidates({ ...common, flag: join(dir, "nope"), env: { GODOT_BIN: env, PATH } })).toEqual([{ path: join(dir, "nope"), source: "--godot" }]);
    expect(godotCandidates({ ...common, env: { GODOT_BIN: env, PATH } })).toEqual([{ path: env, source: "GODOT_BIN" }]);
  });

  it("uses the first candidate that runs and is Godot 4.5 or newer", async () => {
    const old = exe("a/godot");
    const broken = exe("b/godot");
    const good = exe("c/godot");
    const versions: Record<string, string> = { [old]: "4.4.1.stable.official", [good]: "4.7.2.stable.official.ed1daf0bf" };
    const found = await findGodot({
      env: { PATH: [join(dir, "a"), join(dir, "b"), join(dir, "c")].join(delimiter) },
      platform: "linux",
      home: dir,
      appDirs: [],
      runVersion: async (p) => {
        if (p === broken) throw new Error("exec format error");
        return versions[p] ?? "";
      },
    });
    expect(found).toMatchObject({ path: good, source: "PATH", version: "4.7.2.stable.official.ed1daf0bf" });
  });

  it("explains what it tried when nothing usable is found", async () => {
    const old = exe("a/godot");
    await expect(
      findGodot({ env: { PATH: join(dir, "a") }, platform: "linux", home: dir, appDirs: [], runVersion: async () => "3.6.stable" }),
    ).rejects.toMatchObject({
      code: "GODOT_NOT_FOUND",
      message: expect.stringContaining(`${old} (Godot 3.6.stable; 4.5 or newer is needed)`),
      hint: expect.stringMatching(/--godot.*GODOT_BIN/),
    });
  });
});

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copySample, listSamples } from "../src/cli.js";

const LEGACY_SAMPLES = ["action", "blocks", "marble-3d", "platformer", "rpg", "shooter"];
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("standalone sample catalog", () => {
  let output: string;
  beforeEach(() => { output = mkdtempSync(join(tmpdir(), "gml-catalog-")); });
  afterEach(() => { rmSync(output, { recursive: true, force: true }); });

  it("offers all six existing playable games without requiring a repository clone", () => {
    expect(listSamples()).toEqual(expect.arrayContaining(LEGACY_SAMPLES));
  });

  it.each(LEGACY_SAMPLES)("copies %s as an independent project without addon wiring", (name) => {
    const dest = join(output, name);
    const result = copySample(name, dest);
    expect(result.name).toBe(name);
    const project = readFileSync(join(dest, "project.godot"), "utf8");
    expect(project).not.toContain("MCPLoopRuntime");
    expect(project).not.toContain("[editor_plugins]");
    const main = /^run\/main_scene="res:\/\/([^"\n]+)"$/m.exec(project)?.[1];
    expect(main).toBeTruthy();
    expect(existsSync(join(dest, main!))).toBe(true);
    expect(existsSync(join(dest, "addons"))).toBe(false);
  });

  it.each(LEGACY_SAMPLES)("delivers player and upgrade guides at the root of %s", (name) => {
    const dest = join(output, name);
    copySample(name, dest);
    for (const path of ["README.md", "PLAY.ja.md", "UPGRADING.md"]) {
      expect(existsSync(join(dest, path)), `${name}/${path}`).toBe(true);
      expect(readFileSync(join(dest, path), "utf8").length).toBeGreaterThan(100);
    }
  });

  it("checks generated payload bytes without modifying them and restores them only on explicit generation", () => {
    const script = join(repo, "scripts/sync-samples.mjs");
    expect(existsSync(script)).toBe(true);
    for (const path of ["scripts/sync-samples.mjs", "project.godot", "LICENSE", "examples", "samples"]) {
      cpSync(join(repo, path), join(output, path), { recursive: true });
    }
    const run = (...args: string[]) => spawnSync(process.execPath, [join(output, "scripts/sync-samples.mjs"), ...args], { encoding: "utf8" });
    expect(run("--check").status).toBe(0);
    const target = join(output, "samples/platformer/examples/platformer/player.gd");
    const original = readFileSync(target);
    const changed = Buffer.concat([original, Buffer.from("\n# local generated-copy drift\n")]);
    writeFileSync(target, changed);
    expect(run("--check").status).not.toBe(0);
    expect(readFileSync(target)).toEqual(changed);
    expect(run().status).toBe(0);
    expect(readFileSync(target)).toEqual(original);
  });

  it("ignores standalone copies only from the repository parent, not from a copied game", () => {
    expect(existsSync(join(repo, "samples/.gdignore"))).toBe(true);
    expect(readFileSync(join(repo, "samples/.gdignore")).length).toBe(0);
    for (const name of LEGACY_SAMPLES) {
      const dest = join(output, name);
      copySample(name, dest);
      expect(existsSync(join(dest, ".gdignore"))).toBe(false);
    }
  });

  it("retains unknown files and refuses generation before modifying a managed file", () => {
    for (const path of ["scripts/sync-samples.mjs", "project.godot", "LICENSE", "examples", "samples"]) {
      cpSync(join(repo, path), join(output, path), { recursive: true });
    }
    const target = join(output, "samples/platformer/examples/platformer/player.gd");
    const original = readFileSync(target);
    writeFileSync(join(output, "examples/platformer/player.gd"), Buffer.concat([original, Buffer.from("\n# source update\n")]));
    const note = join(output, "samples/platformer/keep-my-note.txt");
    writeFileSync(note, "keep this user file");
    const result = spawnSync(process.execPath, [join(output, "scripts/sync-samples.mjs")], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unmanaged file retained");
    expect(readFileSync(note, "utf8")).toBe("keep this user file");
    expect(readFileSync(target)).toEqual(original);
  });
});

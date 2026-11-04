import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { copySample, listSamples } from "../src/cli.js";
import { parseTreeRequest } from "../src/scene-tree-schema.js";
import { loadTreePolicy } from "../src/tree-policy.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("tower-defense sample delivery", () => {
  it("ships the seventh addon-free game and its three actual bounded construction plans", () => {
    expect(listSamples()).toEqual(["action", "blocks", "marble-3d", "platformer", "rpg", "shooter", "tower-defense"]);
    const output = mkdtempSync(join(tmpdir(), "gml-td-delivery-"));
    try {
      const dest = join(output, "garden");
      copySample("tower-defense", dest);
      const project = readFileSync(join(dest, "project.godot"), "utf8");
      expect(project).toContain('run/main_scene="res://scenes/title.tscn"');
      expect(project).not.toContain("MCPLoopRuntime");
      expect(project).not.toContain("[editor_plugins]");
      expect(project).not.toContain("trial_20261103");
      expect(existsSync(join(dest, "addons"))).toBe(false);
      for (const path of ["README.md", "PLAY.ja.md", "DESIGN.md", "UPGRADING.md", "ASSET-PROVENANCE.md", "LICENSE"]) {
        expect(existsSync(join(dest, path)), path).toBe(true);
      }
      const policy = loadTreePolicy();
      for (const [file, count] of [["title-tree.json", 13], ["garden-tree.json", 30], ["results-tree.json", 11]] as const) {
        const plan = parseTreeRequest(JSON.parse(readFileSync(join(dest, "plans", file), "utf8")), policy);
        expect(plan.nodes).toHaveLength(count);
      }
    } finally { rmSync(output, { recursive: true, force: true }); }
  });

  it("includes the new native sample checks in the existing windowed CI job", () => {
    const workflow = readFileSync(join(repo, ".github/workflows/ci.yml"), "utf8");
    expect(workflow).toContain("test/e2e/standalone-samples.e2e.test.ts");
    expect(workflow).toContain("test/e2e/tower-defense-sample.e2e.test.ts");
    const registered = readFileSync(join(repo, "server/test/e2e/samples.e2e.test.ts"), "utf8");
    expect(registered).toContain('name: "tower-defense"');
  });

  it("uses portable path-only texture references when the integrated copy regenerates imports", () => {
    for (const scene of ["title.tscn", "game.tscn", "results.tscn"]) {
      const body = readFileSync(join(repo, "examples/tower-defense/scenes", scene), "utf8");
      expect(body, scene).not.toMatch(/^\[ext_resource type="Texture2D" uid=/m);
      expect(body, scene).toMatch(/^\[ext_resource type="Texture2D" path="res:\/\/examples\/tower-defense\/assets\//m);
    }
  });

  it("generates the integrated example with prefixed resources from the single sample authority", () => {
    expect(existsSync(join(repo, "examples/tower-defense/scenes/title.tscn"))).toBe(true);
    for (const file of ["scripts/session.gd", "scripts/title.gd", "scripts/game.gd", "scenes/title.tscn", "scenes/game.tscn", "plans/title-tree.json", "scenarios/01_title_placement.json"]) {
      const source = readFileSync(join(repo, "samples/tower-defense", file), "utf8");
      const example = readFileSync(join(repo, "examples/tower-defense", file), "utf8");
      const relocated = source.replaceAll("res://", "res://examples/tower-defense/");
      const expected = file.endsWith(".tscn") ? relocated.replace(/^(\[ext_resource type="Texture2D") uid="uid:\/\/[^"]+"/gm, "$1") : relocated;
      expect(example, file).toBe(expected);
    }
    expect(readFileSync(join(repo, "project.godot"), "utf8")).toContain('run/main_scene="res://examples/platformer/main.tscn"');
  });
});

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * The 3D game ships twice: samples/marble-3d is the standalone project users copy out of the package, and
 * examples/marble is the same game wired into this repository (res://examples/marble/... paths) so CI can run it.
 * samples/marble-3d is the source of truth; this test fails when the two drift apart.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string): string => readFileSync(join(repo, rel), "utf8");

function scripts(dir: string): Map<string, string> {
  const base = join(repo, dir, "scripts");
  const out = new Map<string, string>();
  for (const f of readdirSync(base)) {
    if (f.endsWith(".gd")) out.set(f, createHash("sha256").update(readFileSync(join(base, f))).digest("hex"));
  }
  return out;
}

describe("the 3D sample and its in-repo copy", () => {
  it("shares every script, byte for byte", () => {
    const sample = scripts("samples/marble-3d");
    const example = scripts("examples/marble");
    expect([...example.keys()].sort()).toEqual([...sample.keys()].sort());
    for (const [name, hash] of sample) expect(example.get(name), name).toBe(hash);
  });

  it("keeps examples/marble generated from the sample", () => {
    expect(() =>
      execFileSync(process.execPath, [join(repo, "scripts", "sync-marble-example.mjs"), "--check"], { stdio: "pipe" }),
    ).not.toThrow();
  });

  it("ships the samples in the npm package", () => {
    const pkg = JSON.parse(read("server/package.json")) as { files?: string[] };
    expect(pkg.files).toContain("samples");
    // `files` is relative to server/, so the bundler has to copy the samples there before packing — 0.9.1 shipped
    // without them because only `files` was updated.
    const bundler = read("server/scripts/bundle-assets.mjs");
    expect(bundler).toContain('["samples", "samples"]');
  });

  it("keeps the standalone project free of addon wiring", () => {
    const godot = read("samples/marble-3d/project.godot");
    expect(godot).not.toContain("MCPLoopRuntime");
    expect(godot).not.toContain("[editor_plugins]");
    expect(godot).toContain("marble_jump");
    expect(existsSync(join(repo, "samples/marble-3d/scenarios/7_gap_needs_jump.yaml"))).toBe(true);
  });
});

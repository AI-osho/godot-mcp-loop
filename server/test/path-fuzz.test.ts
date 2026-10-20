import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveEvidenceFolder } from "../src/scenario/evidence.js";
import { resolveProjectFile } from "../src/tools/scenario.js";

/**
 * Same property as the addon's fuzz test: a spelling that still reaches a protected file must be refused.
 * Mutations are case flips, doubled slashes and "./" segments; on a case-sensitive file system a mutated path
 * simply does not exist, and there is nothing behind it to reach, so only resolvable paths are asserted on.
 */
const SEED = 20261020;
const MUTATIONS_PER_PATH = 120;

function rand(): () => number {
  let s = SEED;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function mutate(path: string, next: () => number): string[] {
  const out = [path, path.replace(/\//g, "//"), path.replace("res://", "res://./"), path + "/."];
  for (let i = 0; i < MUTATIONS_PER_PATH; i++) {
    let m = [...path]
      .map((c) => (/[a-z]/i.test(c) && next() < 0.4 ? (next() < 0.5 ? c.toUpperCase() : c.toLowerCase()) : c))
      .join("");
    if (next() < 0.4) m = m.replace("res://", "res://./");
    if (next() < 0.2) m = m.replace(/\//g, "//");
    out.push(m);
  }
  return out;
}

/** The on-disk path the resolver would look at (mirrors resolveProjectFile's own arithmetic). */
function onDisk(project: string, m: string): string {
  return resolve(project, m.replace(/^res:\/\//, ""));
}

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), "gml-fuzz-"));
  for (const dir of [".git", ".godot", "addons/mcp_loop", "examples/marble", "qa"]) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, ".git", "config"), "[core]\n");
  writeFileSync(join(root, ".godot", "global_script_class_cache.cfg"), "list=[]\n");
  writeFileSync(join(root, "addons", "mcp_loop", "plugin.gd"), "extends EditorPlugin\n");
  writeFileSync(join(root, "examples", "marble", "main.tscn"), "[gd_scene]\n");
  return root;
}

/** BridgeError carries the machine code; the message is for humans. */
function expectForbidden(fn: () => unknown, label: string): void {
  try {
    fn();
  } catch (e) {
    expect((e as { code?: string }).code, label).toBe("PATH_FORBIDDEN");
    return;
  }
  throw new Error(`${label}: did not throw`);
}

describe("server path resolution: mutation property", () => {
  const project = makeProject();
  const next = rand();

  it("never reads a protected file through a mutation", () => {
    let reachable = 0;
    for (const target of ["res://.git/config", "res://.godot/global_script_class_cache.cfg"]) {
      for (const m of mutate(target, next)) {
        if (!existsSync(onDisk(project, m))) continue;
        reachable++;
        expectForbidden(() => resolveProjectFile(project, m), m);
      }
    }
    expect(reachable).toBeGreaterThan(0); // the property actually exercised something
  });

  it("never writes evidence into a protected folder through a mutation", () => {
    let reachable = 0;
    for (const target of ["res://.git/evil", "res://.godot/evil", "res://addons/mcp_loop/evil"]) {
      for (const m of mutate(target, next)) {
        const dir = dirname(onDisk(project, m));
        if (!existsSync(dir)) continue;
        reachable++;
        expectForbidden(() => resolveEvidenceFolder(project, m, false), m);
      }
    }
    expect(reachable).toBeGreaterThan(0);
  });

  it("keeps harmless mutations working", () => {
    for (const m of mutate("res://examples/marble/main.tscn", next)) {
      if (!existsSync(onDisk(project, m))) continue;
      expect(() => resolveProjectFile(project, m), m).not.toThrow();
    }
  });
});

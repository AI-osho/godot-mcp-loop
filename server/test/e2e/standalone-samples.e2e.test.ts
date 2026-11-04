import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copySample } from "../../src/cli.js";
import { GODOT_BIN } from "./godot-harness.js";

const NAMES = ["platformer", "blocks", "shooter", "action", "rpg", "marble-3d", "tower-defense"];

describe("e2e: addon-free standalone sample projects", () => {
  let out: string;
  beforeEach(() => { out = mkdtempSync(join(tmpdir(), "gml-standalone-")); });
  afterEach(() => { rmSync(out, { recursive: true, force: true }); });

  it.each(NAMES)("%s cold-imports and starts with no addon installed", (name) => {
    const project = join(out, "project");
    copySample(name, project);
    expect(existsSync(join(project, "addons"))).toBe(false);
    expect(existsSync(join(project, ".godot"))).toBe(false);
    const home = join(out, "home");
    mkdirSync(home);
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: home, TMPDIR: out, XDG_DATA_HOME: join(home, "data") };
    const results: Array<{ phase: string; exit: number | null; native_errors: number; leak_lines: number }> = [];
    for (const [phase, args] of [
      ["cold-import", ["--headless", "--editor", "--path", project, "--import"]],
      ["normal-startup", ["--headless", "--path", project, "--quit-after", "8", "--verbose"]],
    ] as const) {
      const child = spawnSync(GODOT_BIN, [...args], { env, cwd: out, encoding: "utf8", timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
      const raw = (child.stdout ?? "") + (child.stderr ?? "");
      // Retain raw diagnostics only in this private temporary fixture, not public reports or exception strings.
      writeFileSync(join(out, phase + "-private.log"), raw, { mode: 0o600 });
      const result = { phase, exit: child.status, native_errors: (raw.match(/^(?:SCRIPT ERROR|ERROR):/gm) ?? []).length, leak_lines: (raw.match(/ObjectDB instances leaked|resources still in use/g) ?? []).length };
      results.push(result);
      expect(child.error?.name, `${name}/${phase}: subprocess completion`).toBeUndefined();
      expect(result, `${name}/${phase}: clean native completion`).toEqual({ phase, exit: 0, native_errors: 0, leak_lines: 0 });
    }
    if (process.env.E2E_SAMPLES_OUT) {
      const evidence = join(process.env.E2E_SAMPLES_OUT, "standalone");
      mkdirSync(evidence, { recursive: true });
      writeFileSync(join(evidence, name + ".json"), JSON.stringify({ sample: name, cold_cache_before: true, addon_installed: false, results, scope: "import/startup only; not full gameplay, rendering or human acceptance" }, null, 2) + "\n");
    }
  }, 190_000);
});

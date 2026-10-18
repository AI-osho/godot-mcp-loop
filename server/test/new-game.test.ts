import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(repo, "scripts", "new-game.sh");
const hasDist = existsSync(join(repo, "server", "dist", "index.js"));

describe.skipIf(!hasDist)("scripts/new-game.sh", () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "gml-newgame-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const run = (...args: string[]) => execFileSync("bash", [script, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  it("creates a project with the addon enabled, the agent skill and agent guides", () => {
    const target = join(tmp(), "my game");
    const out = run(target, "--name", "My Game", "--no-git", "--no-import");
    const project = readFileSync(join(target, "project.godot"), "utf8");
    expect(project).toContain('config/name="My Game"');
    expect(project).toContain('MCPLoopRuntime="*res://addons/mcp_loop/runtime/runtime_agent.gd"');
    expect(project).toContain('enabled=PackedStringArray("res://addons/mcp_loop/plugin.cfg")');
    expect(readFileSync(join(target, "addons/mcp_loop/plugin.cfg"), "utf8")).toBe(readFileSync(join(repo, "addons/mcp_loop/plugin.cfg"), "utf8"));
    expect(existsSync(join(target, ".claude/skills/godot-mcp-loop/SKILL.md"))).toBe(true);
    expect(existsSync(join(target, ".claude/skills/godot-mcp-loop/references/deterministic-testing.md"))).toBe(true);
    expect(readFileSync(join(target, "AGENTS.md"), "utf8")).toContain("# My Game");
    expect(readFileSync(join(target, "CLAUDE.md"), "utf8").trim()).toBe("@AGENTS.md");
    expect(readFileSync(join(target, ".gitignore"), "utf8")).toContain(".godot/");
    expect(existsSync(join(target, "scenarios"))).toBe(true);
    // The printed registration command quotes the path with a space (same quoting as the script: printf %q).
    const quoted = execFileSync("bash", ["-c", 'printf %q "$1"', "_", target], { encoding: "utf8" });
    expect(quoted).not.toBe(target);
    expect(out).toContain(`--project ${quoted}`);
  });

  it("refuses a non-empty directory and bad names", () => {
    const target = tmp();
    writeFileSync(join(target, "keep.txt"), "x");
    expect(() => run(target, "--no-git", "--no-import")).toThrow(/non-empty/);
    const other = join(tmp(), "g");
    mkdirSync(other);
    expect(() => run(other, "--name", 'bad"name', "--no-git", "--no-import")).toThrow(/quotes/);
  });
});

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

  describe("session continuity and permissions (#14)", () => {
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.invalid",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.invalid",
    };
    const make = (git: boolean) => {
      const target = join(tmp(), "game");
      execFileSync("bash", [script, target, "--name", "Star Quest", "--no-import", ...(git ? [] : ["--no-git"])], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: gitEnv,
      });
      return target;
    };
    const hook = (target: string) =>
      execFileSync("sh", [join(target, ".claude/hooks/session-context.sh")], {
        encoding: "utf8",
        env: { ...gitEnv, CLAUDE_PROJECT_DIR: target },
        cwd: tmpdir(), // the hook must not depend on the current directory
      });

    it("writes PROGRESS.md and points the agent guide at it and at saved evidence", () => {
      const target = make(false);
      const progress = readFileSync(join(target, "PROGRESS.md"), "utf8");
      expect(progress).toContain("Star Quest");
      for (const h of ["## Goal", "## Status", "## Done", "## Next", "## Decisions", "## Known issues"]) expect(progress).toContain(h);
      const agents = readFileSync(join(target, "AGENTS.md"), "utf8");
      expect(agents).toContain("PROGRESS.md");
      expect(agents).toContain("save_to");
      expect(readFileSync(join(target, ".gitignore"), "utf8")).toContain("qa/evidence/");
    });

    it("project settings allow the godot-loop tools and deny destructive commands", () => {
      const target = make(false);
      const settings = JSON.parse(readFileSync(join(target, ".claude/settings.json"), "utf8"));
      // The allow rule must name the server the script registers.
      const registered = /claude mcp add (\S+)/.exec(readFileSync(script, "utf8"))![1];
      expect(settings.permissions.allow).toContain(`mcp__${registered}__*`);
      for (const rule of ["Bash(rm -rf *)", "Bash(git push --force*)", "Bash(git push * --force*)", "Bash(git reset --hard*)", "Bash(git clean *)"]) {
        expect(settings.permissions.deny).toContain(rule);
      }
      expect(settings.permissions.deny).toContain("Read(/.godot/mcp_loop/**)"); // the session token
      const start = settings.hooks.SessionStart;
      expect(start).toHaveLength(1);
      expect(start[0].matcher).toBeUndefined(); // startup, resume, /clear and after compaction
      expect(start[0].hooks[0].command).toContain(".claude/hooks/session-context.sh");
    });

    it("the session-start hook prints PROGRESS.md, recent commits and uncommitted changes", () => {
      const target = make(true);
      const tracked = execFileSync("git", ["-C", target, "ls-files"], { encoding: "utf8" });
      for (const f of ["PROGRESS.md", ".claude/settings.json", ".claude/hooks/session-context.sh"]) expect(tracked).toContain(f);
      writeFileSync(join(target, "PROGRESS.md"), "# Progress\n\n## Next\n- boss fight\n");
      const out = hook(target);
      expect(out).toContain("- boss fight");
      expect(out).toMatch(/Recent commits:\n[0-9a-f]+ New Godot project/);
      expect(out).toMatch(/Uncommitted changes:\n M PROGRESS\.md/);
    });

    it("the hook keeps its output under Claude Code's 10,000 character limit and never fails", () => {
      const target = make(false);
      writeFileSync(join(target, "PROGRESS.md"), "x".repeat(30000));
      const out = hook(target);
      expect(out.length).toBeLessThan(9000);
      expect(out).toContain("PROGRESS.md is longer");
      rmSync(join(target, "PROGRESS.md"));
      expect(() => hook(target)).not.toThrow(); // no file, no git: still exit 0
    });
  });
});

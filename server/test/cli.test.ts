import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { enablePlugin, installAddon, runCli } from "../src/cli.js";
import { SERVER_VERSION } from "../src/version.js";

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = 'res://addons/mcp_loop/plugin.cfg';

describe("install-addon (#16)", () => {
  let project: string;
  let outside: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "gml-cli-"));
    outside = mkdtempSync(join(tmpdir(), "gml-cli-out-"));
    writeFileSync(join(project, "project.godot"), 'config_version=5\n\n[application]\n\nconfig/name="x"\n');
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  const pluginCfg = () => readFileSync(join(project, "addons/mcp_loop/plugin.cfg"), "utf8");
  const projectGodot = () => readFileSync(join(project, "project.godot"), "utf8");

  it("copies the addon of the same version as the server and enables it", () => {
    const r = installAddon({ project });
    expect(pluginCfg()).toContain(`version="${SERVER_VERSION}"`);
    expect(existsSync(join(project, "addons/mcp_loop/runtime/runtime_agent.gd"))).toBe(true);
    expect(projectGodot()).toContain(`[editor_plugins]\n\nenabled=PackedStringArray("${PLUGIN}")`);
    expect(r.messages.join("\n")).toMatch(/Installed the MCP Loop addon \d+\.\d+\.\d+/);
  });

  it("keeps other enabled plugins and does not add itself twice", () => {
    writeFileSync(
      join(project, "project.godot"),
      'config_version=5\n\n[editor_plugins]\n\nenabled=PackedStringArray("res://addons/gut/plugin.cfg")\n\n[rendering]\n\nx=1\n',
    );
    installAddon({ project });
    installAddon({ project });
    const text = projectGodot();
    expect(text).toContain(`enabled=PackedStringArray("res://addons/gut/plugin.cfg", "${PLUGIN}")`);
    expect(text.match(/mcp_loop\/plugin\.cfg/g)).toHaveLength(1);
    expect(text).toContain("[rendering]\n\nx=1");
  });

  it("enablePlugin handles a section without an enabled line and a missing section", () => {
    expect(enablePlugin('[editor_plugins]\n\n[input]\n')).toBe(`[editor_plugins]\n\nenabled=PackedStringArray("${PLUGIN}")\n\n[input]\n`);
    expect(enablePlugin("config_version=5\n")).toBe(`config_version=5\n\n[editor_plugins]\n\nenabled=PackedStringArray("${PLUGIN}")\n`);
  });

  it("leaves the same version alone and needs --force to replace another version", () => {
    installAddon({ project });
    expect(installAddon({ project }).messages.join("\n")).toContain("already installed");
    writeFileSync(join(project, "addons/mcp_loop/plugin.cfg"), pluginCfg().replace(/version="[^"]*"/, 'version="0.1.0"'));
    writeFileSync(join(project, "addons/mcp_loop/old_file.gd"), "# from 0.1.0");
    expect(() => installAddon({ project })).toThrow(/0\.1\.0 is installed.*--force/);
    installAddon({ project, force: true });
    expect(pluginCfg()).toContain(`version="${SERVER_VERSION}"`);
    expect(existsSync(join(project, "addons/mcp_loop/old_file.gd"))).toBe(false);
  });

  it("refuses a folder without project.godot and symbolic links on the way", () => {
    rmSync(join(project, "project.godot"));
    expect(() => installAddon({ project })).toThrow(/project\.godot/);
    writeFileSync(join(project, "project.godot"), "config_version=5\n");
    symlinkSync(outside, join(project, "addons"));
    expect(() => installAddon({ project })).toThrow(/symbolic link/);
    expect(existsSync(join(outside, "mcp_loop"))).toBe(false);
  });

  it("--skill adds the agent skill; --no-enable leaves project.godot alone", () => {
    const before = projectGodot();
    installAddon({ project, skill: true, enable: false });
    expect(projectGodot()).toBe(before);
    expect(readFileSync(join(project, ".claude/skills/godot-mcp-loop/SKILL.md"), "utf8")).toContain("name: godot-mcp-loop");
    expect(existsSync(join(project, ".claude/skills/godot-mcp-loop/references/scenario-cookbook.md"))).toBe(true);
  });

  it("runs from the command line with usage errors as exit code 2", () => {
    const out: string[] = [];
    const log = (s: string) => out.push(s);
    expect(runCli(["install-addon", project, "--skill"], log)).toBe(0);
    expect(out.join("\n")).toContain("claude mcp add godot-loop");
    expect(runCli(["install-addon"], log)).toBe(2);
    expect(runCli(["install-addon", project, "--bogus"], log)).toBe(2);
    expect(runCli(["install-addon", join(project, "missing")], log)).toBe(1);
  });
});

describe("npm package contents (#16)", () => {
  it("ships the server, the addon and the agent skill, not the tests", () => {
    execFileSync("node", ["scripts/bundle-assets.mjs"], { cwd: serverDir });
    const json = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: serverDir, encoding: "utf8" });
    const files = (JSON.parse(json)[0].files as Array<{ path: string }>).map((f) => f.path);
    for (const f of ["dist/index.js", "dist/cli.js", "addon/mcp_loop/plugin.cfg", "addon/mcp_loop/runtime/runtime_agent.gd", "skill/godot-mcp-loop/SKILL.md", "README.md", "LICENSE", "package.json"]) {
      expect(files, f).toContain(f);
    }
    expect(files.some((f) => f.startsWith("test/") || f.startsWith("src/"))).toBe(false);
    const cfg = readFileSync(join(serverDir, "addon/mcp_loop/plugin.cfg"), "utf8");
    expect(cfg).toContain(`version="${SERVER_VERSION}"`); // addon and server versions match
  });
});

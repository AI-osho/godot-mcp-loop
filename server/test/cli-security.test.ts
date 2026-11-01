import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const server = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("sample destination aliases (isolated package, current source)", () => {
  let base: string;
  let pkg: string;
  beforeAll(() => { execFileSync("npm", ["run", "build"], { cwd: server }); });
  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "gml-copy-security-")));
    pkg = join(base, "package");
    mkdirSync(join(pkg, "dist"), { recursive: true });
    cpSync(join(server, "..", "samples"), join(pkg, "samples"), { recursive: true });
    cpSync(join(server, "package.json"), join(pkg, "package.json"));
    // Compile the current source into a disposable package. Never attack the actual installed package or stale dist/.
    cpSync(join(server, "dist"), join(pkg, "dist"), { recursive: true });
    writeFileSync(join(pkg, "probe.mjs"), 'import { runCli } from "./dist/cli.js"; process.exit(runCli(process.argv.slice(2)));');
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  const run = (dest: string) => spawnSync(process.execPath, [join(pkg, "probe.mjs"), "sample", "marble-3d", dest], { encoding: "utf8" });

  it("refuses a symlink alias into its own package without copying anything", () => {
    const link = join(base, "alias");
    symlinkSync(pkg, link, "dir");
    const dest = join(link, "new-sample");
    const r = run(dest);
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toMatch(/inside the installed package/);
    expect(existsSync(dest)).toBe(false);
  });

  it("refuses a case alias when the filesystem resolves it", (ctx) => {
    const alias = join(base, "PACKAGE");
    if (!existsSync(alias)) { ctx.skip(); return; }
    const dest = join(alias, "new-sample");
    const r = run(dest);
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(existsSync(dest)).toBe(false);
  });

  it("refuses to install into the package's bundled sample itself", () => {
    cpSync(join(server, "..", "addons/mcp_loop"), join(pkg, "addon/mcp_loop"), { recursive: true });
    const dest = join(pkg, "samples/marble-3d");
    const before = readFileSync(join(dest, "project.godot"), "utf8");
    const r = spawnSync(process.execPath, [join(pkg, "probe.mjs"), "install-addon", dest], { encoding: "utf8" });
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(readFileSync(join(dest, "project.godot"), "utf8")).toBe(before);
    expect(existsSync(join(dest, "addons"))).toBe(false);
  });

  it.each(["same source", "contains source"])("refuses destructive install when the target %s, without deleting the disposable checkout", (kind) => {
    const game = join(base, "game");
    const checkout = kind === "same source" ? game : join(game, "addons", "mcp_loop");
    const runningServer = join(checkout, "server");
    const addon = join(checkout, "addons", "mcp_loop");
    mkdirSync(runningServer, { recursive: true });
    cpSync(join(server, "dist"), join(runningServer, "dist"), { recursive: true });
    cpSync(join(server, "package.json"), join(runningServer, "package.json"));
    cpSync(join(server, "..", "addons", "mcp_loop"), addon, { recursive: true });
    cpSync(join(server, "..", ".claude", "skills", "godot-mcp-loop"), join(checkout, ".claude", "skills", "godot-mcp-loop"), { recursive: true });
    writeFileSync(join(game, "project.godot"), "config_version=5\n");
    const before = readFileSync(join(addon, "plugin.cfg"), "utf8");
    const probe = join(runningServer, "probe.mjs");
    writeFileSync(probe, 'import { runCli } from "./dist/cli.js"; process.exit(runCli(process.argv.slice(2)));');
    const r = spawnSync(process.execPath, [probe, "install-addon", game, "--force", "--skill"], { encoding: "utf8", timeout: 5000 });
    expect(existsSync(join(addon, "plugin.cfg")), "the installer must never delete its own copy source").toBe(true);
    expect(readFileSync(join(addon, "plugin.cfg"), "utf8")).toBe(before);
    expect(existsSync(probe), "a target containing the running package must also be refused").toBe(true);
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toMatch(/source|package/i);
    expect(readFileSync(join(game, "project.godot"), "utf8")).toBe("config_version=5\n");
  });

  it("still copies into a normal empty destination", () => {
    const dest = join(base, "my-game");
    const r = run(dest);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(existsSync(join(dest, "project.godot"))).toBe(true);
  });
});

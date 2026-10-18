import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const server = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(server, "..");
const notesScript = join(server, "scripts", "release-notes.mjs");

describe("release automation", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gml-release-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("release-notes.mjs: the version's CHANGELOG section, pinned install commands and the checksums", () => {
    writeFileSync(
      join(dir, "CHANGELOG.md"),
      [
        "# Changelog",
        "",
        "## [Unreleased]",
        "",
        "## [1.2.0] - 2026-11-01",
        "",
        "Big one.",
        "",
        "### Added",
        "- `thing`",
        "",
        "## [1.1.0] - 2026-10-01",
        "",
        "- old",
        "",
        "[1.2.0]: https://example.com/1.2.0",
      ].join("\n"),
    );
    writeFileSync(join(dir, "SUMS"), "abc  godot-mcp-loop-addon-1.2.0.zip\ndef  godot-mcp-loop-1.2.0.tgz\n");
    const out = execFileSync(process.execPath, [notesScript, "1.2.0", join(dir, "SUMS"), "--changelog", join(dir, "CHANGELOG.md")], {
      encoding: "utf8",
    });
    expect(out.startsWith("Big one.\n\n### Added\n- `thing`\n\n### Install")).toBe(true);
    expect(out).not.toContain("- old");
    expect(out).toContain("npx -y godot-mcp-loop@1.2.0 install-addon");
    expect(out).toContain("abc  godot-mcp-loop-addon-1.2.0.zip\ndef  godot-mcp-loop-1.2.0.tgz");
    expect(out).toContain("blob/v1.2.0/CHANGELOG.md");
  });

  it("release-notes.mjs fails without the section or with bad arguments", () => {
    writeFileSync(join(dir, "CHANGELOG.md"), "## [1.0.0] - 2026-01-01\n- x\n");
    writeFileSync(join(dir, "SUMS"), "x\n");
    const missing = spawnSync(process.execPath, [notesScript, "2.0.0", join(dir, "SUMS"), "--changelog", join(dir, "CHANGELOG.md")], { encoding: "utf8" });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("No '## [2.0.0]");
    expect(spawnSync(process.execPath, [notesScript, "v2"], { encoding: "utf8" }).status).toBe(2);
  });

  it("the current CHANGELOG has a section for the package version", () => {
    const version = (JSON.parse(readFileSync(join(server, "package.json"), "utf8")) as { version: string }).version;
    writeFileSync(join(dir, "SUMS"), "x\n");
    const out = execFileSync(process.execPath, [notesScript, version, join(dir, "SUMS")], { encoding: "utf8" });
    expect(out).toContain(`godot-mcp-loop@${version}`);
  });

  it("release-artifacts.sh refuses a version that the package, the addon or the CHANGELOG do not have", () => {
    const r = spawnSync("bash", [join(repo, "scripts", "release-artifacts.sh"), "9.9.9", join(dir, "out")], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Version mismatch: release 9\.9\.9/);
    const usage = spawnSync("bash", [join(repo, "scripts", "release-artifacts.sh"), "v1"], { encoding: "utf8" });
    expect(usage.status).toBe(2);
  });

  it("the release workflow builds with the script, publishes to GitHub and stages npm with trusted publishing", () => {
    const wf = readFileSync(join(repo, ".github", "workflows", "release.yml"), "utf8");
    expect(wf).toContain("scripts/release-artifacts.sh");
    expect(wf).toMatch(/tags:\s*\[\s*"v\*\.\*\.\*"\s*\]/);
    expect(wf).toContain("id-token: write");
    expect(wf).toContain("npm stage publish");
    expect(wf).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets/); // no long-lived token
    // Every action is pinned to a full commit SHA.
    for (const m of wf.matchAll(/uses:\s*([^\s#]+)/g)) expect(m[1]).toMatch(/@[0-9a-f]{40}$/);
  });
});

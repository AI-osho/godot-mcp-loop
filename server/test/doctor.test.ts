import { execFile, execFileSync, spawnSync } from "node:child_process";
import { once } from "node:events";
import { connect, createServer } from "node:net";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, lstatSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { diagnose } from "../src/doctor.js";
import { SERVER_VERSION } from "../src/version.js";

const serverDir = fileURLToPath(new URL("..", import.meta.url));
const build = mkdtempSync(join(tmpdir(), "gml-doctor-cli-build-"));
const binary = join(build, "dist/index.js");
beforeAll(() => {
  copyFileSync(join(serverDir, "package.json"), join(build, "package.json"));
  symlinkSync(join(serverDir, "node_modules"), join(build, "node_modules"), "junction");
  execFileSync(process.execPath, [join(serverDir, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json", "--outDir", join(build, "dist")], { cwd: serverDir, timeout: 60000 });
});
afterAll(() => rmSync(build, { recursive: true, force: true }));
const projects: string[] = [];
afterEach(() => { for (const p of projects.splice(0)) rmSync(p, { recursive: true, force: true }); });
const goodProbes = { findGodot: async () => ({ path: "/unused-by-unit-probe", version: "4.7.2.stable.official", source: "default" as const }) };

function installedFixture(enabled = true): string {
  const project = mkdtempSync(join(tmpdir(), "gml-doctor-")); projects.push(project);
  writeFileSync(join(project, "project.godot"), `config_version=5\n[editor_plugins]\nenabled=PackedStringArray(${enabled ? '"res://addons/mcp_loop/plugin.cfg"' : ''})\n`);
  mkdirSync(join(project, "addons/mcp_loop/runtime"), { recursive: true });
  writeFileSync(join(project, "addons/mcp_loop/plugin.cfg"), `[plugin]\nversion="${SERVER_VERSION}"\nscript="plugin.gd"\n`);
  writeFileSync(join(project, "addons/mcp_loop/plugin.gd"), "# Must never be executed by doctor.\n");
  writeFileSync(join(project, "addons/mcp_loop/runtime/runtime_agent.gd"), "# Must never be executed by doctor.\n");
  return project;
}

it("reports a missing addon through the real CLI without opening an editor", () => {
  const project = mkdtempSync(join(tmpdir(), "gml-doctor-")); projects.push(project);
  writeFileSync(join(project, "project.godot"), 'config_version=5\n[application]\nconfig/name="doctor fixture"\n');
  const r = spawnSync(process.execPath, [binary, "doctor", project, "--json"], { encoding: "utf8", timeout: 30000 });
  expect(r.status).toBe(1);
  expect(r.stdout).toContain('"code": "ADDON_NOT_INSTALLED"');
  const report = JSON.parse(r.stdout);
  expect(report.scope).toBe("static_installation_only");
  expect(report.checks).toContainEqual(expect.objectContaining({ id: "addon", status: "problem", code: "ADDON_NOT_INSTALLED" }));
  expect(report.runtime).toEqual({ status: "not_checked", code: "RUNTIME_NOT_CHECKED" });
  expect(r.stderr).toBe("");
});

it("reports a missing project before trying to inspect its addon", () => {
  const project = mkdtempSync(join(tmpdir(), "gml-doctor-")); projects.push(project);
  const r = spawnSync(process.execPath, [binary, "doctor", project, "--json"], { encoding: "utf8", timeout: 30000 });
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout).checks).toContainEqual(expect.objectContaining({ id: "project", status: "problem", code: "PROJECT_NOT_FOUND" }));
});

it("distinguishes a version mismatch from an absent addon", () => {
  const project = mkdtempSync(join(tmpdir(), "gml-doctor-")); projects.push(project);
  writeFileSync(join(project, "project.godot"), "config_version=5\n");
  mkdirSync(join(project, "addons/mcp_loop"), { recursive: true });
  writeFileSync(join(project, "addons/mcp_loop/plugin.cfg"), '[plugin]\nversion="0.9.2"\n');
  const r = spawnSync(process.execPath, [binary, "doctor", project, "--json"], { encoding: "utf8", timeout: 30000 });
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout).checks).toContainEqual(expect.objectContaining({ id: "addon", status: "problem", code: "ADDON_VERSION_MISMATCH" }));
});

it("accepts matching static settings without certifying runtime behavior", async () => {
  const report = await diagnose(installedFixture(), {}, goodProbes);
  expect(report.status).toBe("ok");
  expect(report.checks).toContainEqual(expect.objectContaining({ id: "addon", status: "ok", code: "ADDON_VERSION_MATCH" }));
  expect(report.runtime).toEqual({ status: "not_checked", code: "RUNTIME_NOT_CHECKED" });
});

it("distinguishes an installed but disabled plugin", async () => {
  const report = await diagnose(installedFixture(false), {}, goodProbes);
  expect(report.checks).toContainEqual(expect.objectContaining({ id: "plugin", status: "problem", code: "ADDON_NOT_ENABLED" }));
  expect(report.status).toBe("problem");
});

it.each(["missing", "unknown", "duplicate", "fix"])("rejects %s arguments before diagnosis and does not echo them", (kind) => {
  const project = installedFixture();
  const secret = "DOCTOR_SYNTHETIC_SECRET_NOT_FOR_OUTPUT_91";
  const args = kind === "missing" ? [] : kind === "duplicate" ? [project, project] : [project, kind === "fix" ? "--fix" : `--${secret}`];
  const r = spawnSync(process.execPath, [binary, "doctor", ...args, "--json"], { encoding: "utf8", timeout: 30000 });
  expect(r.status).toBe(2);
  expect(JSON.parse(r.stdout).checks).toContainEqual(expect.objectContaining({ id: "arguments", code: "INVALID_ARGUMENTS" }));
  expect(r.stdout + r.stderr).not.toContain(secret);
  expect(r.stderr).toBe("");
});

it("provides CLI help without starting the MCP protocol or inspecting a project", () => {
  const r = spawnSync(process.execPath, [binary, "doctor", "--help"], { encoding: "utf8", timeout: 30000 });
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("doctor <project>");
  expect(r.stdout).toContain("--artwork");
  expect(r.stderr).toBe("");
});

it("reports an unavailable Godot without exposing the probe error", async () => {
  const secret = "DOCTOR_SYNTHETIC_PROBE_SECRET_82";
  const report = await diagnose(installedFixture(), {}, { findGodot: async () => { throw new Error(secret); } });
  expect(report.checks).toContainEqual(expect.objectContaining({ id: "godot", status: "problem", code: "GODOT_NOT_FOUND" }));
  expect(JSON.stringify(report)).not.toContain(secret);
});

it("does not certify an unverified Godot version", async () => {
  const report = await diagnose(installedFixture(), {}, { findGodot: async () => ({ path: "/unused", version: "4.6.2.stable", source: "default" }) });
  expect(report.checks).toContainEqual(expect.objectContaining({ id: "godot", status: "not_checked", code: "GODOT_VERSION_UNVERIFIED" }));
  expect(report.status).toBe("not_checked");
});

it("checks the declared Node minimum and discards Godot raw suffixes", async () => {
  const report = await diagnose(installedFixture(), {}, { nodeVersion: "19.0.0", findGodot: async () => ({ path: "/unused", version: "4.7.2.stable.DOCTOR_SYNTHETIC_SUFFIX_46", source: "default" }) });
  expect(report.checks).toContainEqual(expect.objectContaining({ id: "node", status: "problem", code: "NODE_UNSUPPORTED" }));
  expect(JSON.stringify(report)).not.toContain("DOCTOR_SYNTHETIC_SUFFIX_46");
});

it("does not probe optional artwork dependencies unless requested", async () => {
  let calls = 0;
  const report = await diagnose(installedFixture(), {}, { ...goodProbes, artwork: async () => { calls++; throw new Error("must not run"); } });
  expect(calls).toBe(0);
  expect(report.checks).toContainEqual(expect.objectContaining({ id: "artwork", status: "not_checked", code: "ARTWORK_NOT_REQUESTED", required: false }));
  expect(report.status).toBe("ok");
});

it.each([
  { python: [3, 10, 9], pillow: "13.0.0", code: "PYTHON_UNSUPPORTED" },
  { python: [3, 13, 2], pillow: "12.3.0", code: "PILLOW_VERSION_MISMATCH" },
  { python: [3, 13, 2], pillow: null, code: "PILLOW_VERSION_MISMATCH" },
])("reports incompatible artwork runtime as $code", async ({ python, pillow, code }) => {
  const report = await diagnose(installedFixture(), { artwork: true }, { ...goodProbes, artwork: async () => ({ python, pillow }) });
  expect(report.checks).toContainEqual(expect.objectContaining({ id: "artwork", status: "problem", code }));
  expect(report.status).toBe("problem");
});

it("accepts the selected supported artwork runtime without claiming image API readiness", async () => {
  const report = await diagnose(installedFixture(), { artwork: true }, { ...goodProbes, artwork: async () => ({ python: [3, 13, 2], pillow: "13.0.0" }) });
  expect(report.checks).toContainEqual(expect.objectContaining({ id: "artwork", status: "ok", code: "PYTHON_PILLOW_READY" }));
  expect(report.status).toBe("ok");
  expect(report.runtime.status).toBe("not_checked");
});

it.each(["symlink", "hardlink", "directory", "oversized"])("refuses a %s project marker with a closed report", async (kind) => {
  const project = installedFixture(), marker = join(project, "project.godot");
  if (kind === "oversized") writeFileSync(marker, "DOCTOR_SYNTHETIC_FILE_SECRET_93" + "x".repeat(1024 * 1024));
  else {
    const original = join(project, "saved-project.txt"); copyFileSync(marker, original); rmSync(marker);
    if (kind === "symlink") symlinkSync(original, marker);
    else if (kind === "hardlink") linkSync(original, marker);
    else mkdirSync(marker);
  }
  const report = await diagnose(project, {}, goodProbes);
  expect(report.checks).toContainEqual(expect.objectContaining({ id: "project", status: "problem", code: "PROJECT_UNREADABLE" }));
  expect(JSON.stringify(report)).not.toContain("DOCTOR_SYNTHETIC_FILE_SECRET_93");
});

it("does not follow an addon directory link or confuse it with absence", async () => {
  const project = installedFixture(), other = installedFixture();
  rmSync(join(project, "addons"), { recursive: true });
  symlinkSync(join(other, "addons"), join(project, "addons"), "junction");
  const report = await diagnose(project, {}, goodProbes);
  expect(report.checks).toContainEqual(expect.objectContaining({ id: "addon", status: "problem", code: "ADDON_UNREADABLE" }));
});

it("does not call a config-only stub a complete addon entry installation", async () => {
  const project = installedFixture(); rmSync(join(project, "addons/mcp_loop/plugin.gd"));
  const report = await diagnose(project, {}, goodProbes);
  expect(report.checks).toContainEqual(expect.objectContaining({ id: "addon_files", status: "problem", code: "ADDON_FILES_MISSING" }));
});

it.each([
  '[editor_plugins]\nenabled=PackedStringArray("res://addons/mcp_loop/plugin.cfg")\n[editor_plugins]\nenabled=PackedStringArray()\n',
  '[editor_plugins]\nenabled=PackedStringArray("res://addons/mcp_loop/plugin.cfg")\nenabled=PackedStringArray()\n',
  '[editor_plugins]\nenabled=Array("unsupported")\n',
])("keeps ambiguous or unsupported enabled settings unverified", async (settings) => {
  const project = installedFixture(); writeFileSync(join(project, "project.godot"), "config_version=5\n" + settings);
  const report = await diagnose(project, {}, goodProbes);
  expect(report.checks).toContainEqual(expect.objectContaining({ id: "plugin", status: "not_checked", code: "PROJECT_CONFIG_UNSUPPORTED" }));
  expect(report.status).toBe("not_checked");
});

it("reads bounded multiline settings and ignores comments without loading variants", async () => {
  const project = installedFixture();
  writeFileSync(join(project, "project.godot"), '\ufeffconfig_version=5\n[application]\nconfig/name="a ; harmless [editor_plugins] string"\n  [editor_plugins] ; comment\n enabled = PackedStringArray(\n"res://addons/other/plugin.cfg",\n"res://addons/mcp_loop/plugin.cfg"\n) ; comment\n');
  const report = await diagnose(project, {}, goodProbes);
  expect(report.checks).toContainEqual(expect.objectContaining({ id: "plugin", status: "ok", code: "ADDON_ENABLED" }));
  expect(report.status).toBe("ok");
});

it("does not select the first of conflicting addon metadata versions", async () => {
  const project = installedFixture();
  writeFileSync(join(project, "addons/mcp_loop/plugin.cfg"), `[plugin]\nversion="${SERVER_VERSION}"\nversion="0.9.2"\nscript="plugin.gd"\n`);
  const report = await diagnose(project, {}, goodProbes);
  expect(report.checks).toContainEqual(expect.objectContaining({ id: "addon", status: "not_checked", code: "ADDON_METADATA_UNREADABLE" }));
});

it("does not certify a marker without a recognized project format", async () => {
  const project = installedFixture(); writeFileSync(join(project, "project.godot"), "");
  const report = await diagnose(project, {}, goodProbes);
  expect(report.checks).toContainEqual(expect.objectContaining({ id: "plugin", status: "not_checked", code: "PROJECT_CONFIG_UNSUPPORTED" }));
  expect(report.status).toBe("not_checked");
});

it("does not certify a different configured addon entry script", async () => {
  const project = installedFixture();
  writeFileSync(join(project, "addons/mcp_loop/plugin.cfg"), `[plugin]\nversion="${SERVER_VERSION}"\nscript="different.gd"\n`);
  const report = await diagnose(project, {}, goodProbes);
  expect(report.checks).toContainEqual(expect.objectContaining({ id: "addon_files", status: "not_checked", code: "ADDON_ENTRY_UNVERIFIED" }));
});

it("shows actionable hints and a runtime disclaimer in human-readable output", () => {
  const project = installedFixture();
  const r = spawnSync(process.execPath, [binary, "doctor", project], { env: { ...process.env, GODOT_BIN: join(project, "missing-godot") }, encoding: "utf8", timeout: 30000 });
  expect(r.status).toBe(1);
  expect(r.stdout).toContain("Static installation checks:");
  expect(r.stdout).toContain("RUNTIME_NOT_CHECKED");
  expect(r.stdout).toContain("GODOT_BIN");
  expect(r.stderr).toBe("");
});

it("rejects an empty project argument rather than diagnosing the working directory", () => {
  const r = spawnSync(process.execPath, [binary, "doctor", "", "--json"], { encoding: "utf8", timeout: 30000 });
  expect(r.status).toBe(2);
  expect(JSON.parse(r.stdout).checks).toContainEqual(expect.objectContaining({ id: "arguments", code: "INVALID_ARGUMENTS" }));
});

it("does not label a prerelease engine as the verified stable version", async () => {
  const report = await diagnose(installedFixture(), {}, { findGodot: async () => ({ path: "/unused", version: "4.7.2.beta1", source: "default" }) });
  expect(report.checks).toContainEqual(expect.objectContaining({ id: "godot", status: "not_checked", code: "GODOT_VERSION_UNVERIFIED" }));
});

it.skipIf(process.platform === "win32" || /\s/.test(process.execPath))("terminates a version probe that ignores SIGTERM", () => {
  const project = installedFixture(), owner = mkdtempSync(join(tmpdir(), "gml-doctor-probe-owner-")); projects.push(owner);
  const fake = join(owner, "godot"), pidFile = join(owner, "pid.txt");
  writeFileSync(fake, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},100);\n`); chmodSync(fake, 0o755);
  try {
    const r = spawnSync(process.execPath, [binary, "doctor", project, "--json"], { env: { ...process.env, GODOT_BIN: fake }, encoding: "utf8", timeout: 9000 });
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).checks).toContainEqual(expect.objectContaining({ id: "godot", code: "GODOT_NOT_FOUND" }));
    const pid = Number(readFileSync(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    if (existsSync(pidFile)) { const pid = Number(readFileSync(pidFile, "utf8")); try { process.kill(pid, "SIGKILL"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e; } }
  }
}, 15000);


function inventory(root: string): unknown[] {
  const out: unknown[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name), s = lstatSync(p);
      out.push([p.slice(root.length), s.mode, s.isSymbolicLink() ? readlinkSync(p) : s.isFile() ? createHash("sha256").update(readFileSync(p)).digest("hex") : "directory"]);
      if (s.isDirectory() && !s.isSymbolicLink()) walk(p);
    }
  };
  walk(root); return out;
}

it.skipIf(process.platform === "win32" || /\s/.test(process.execPath))("uses only fixed version arguments and preserves project contents and secrets", () => {
  const project = installedFixture(), owner = mkdtempSync(join(tmpdir(), "gml-doctor-observer-")); projects.push(owner);
  const fake = join(owner, "godot"), observation = join(owner, "observation.json");
  const secret = "DOCTOR_SYNTHETIC_OPAQUE_AUTH_1397";
  writeFileSync(fake, `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(observation)},JSON.stringify({args,cwd:process.cwd(),secretPresent:process.env.DOCTOR_TEST_AUTH!==undefined}));if(JSON.stringify(args)!==JSON.stringify(['--headless','--version']))process.exit(2);console.log('4.7.2.stable.${secret}');\n`); chmodSync(fake, 0o755);
  mkdirSync(join(project, ".godot/mcp_loop"), { recursive: true });
  writeFileSync(join(project, ".godot/mcp_loop/session.json"), JSON.stringify({ token: secret }));
  const before = inventory(project);
  const r = spawnSync(process.execPath, [binary, "doctor", project, "--json"], { env: { ...process.env, GODOT_BIN: fake, DOCTOR_TEST_AUTH: secret }, encoding: "utf8", timeout: 10000 });
  expect(r.status).toBe(0);
  expect(JSON.parse(r.stdout).status).toBe("ok");
  expect(r.stdout + r.stderr).not.toContain(secret);
  expect(r.stderr).toBe("");
  const observed = JSON.parse(readFileSync(observation, "utf8"));
  expect(observed.args).toEqual(["--headless", "--version"]);
  expect(observed.cwd).not.toBe(project);
  expect(observed.secretPresent).toBe(false);
  expect(inventory(project)).toEqual(before);
});

it("forwards --artwork to a real missing-interpreter check without exposing its path", () => {
  const project = installedFixture(), secret = "DOCTOR_SYNTHETIC_MISSING_PYTHON_41";
  const r = spawnSync(process.execPath, [binary, "doctor", project, "--artwork", "--json"], { env: { ...process.env, GODOT_LOOP_PYTHON: join(project, secret) }, encoding: "utf8", timeout: 30000 });
  expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout).checks).toContainEqual(expect.objectContaining({ id: "artwork", code: "ARTWORK_PROBE_FAILED" }));
  expect(r.stdout + r.stderr).not.toContain(secret);
});

it.each([null, {}, { python: [3, 13, 2], pillow: "13.0.0", opaque: "DOCTOR_SYNTHETIC_ENVELOPE_SECRET" }])("rejects malformed artwork probe metadata without copying raw fields", async (data) => {
  const report = await diagnose(installedFixture(), { artwork: true }, { ...goodProbes, artwork: async () => data });
  expect(report.checks).toContainEqual(expect.objectContaining({ id: "artwork", status: "problem", code: "ARTWORK_PROBE_FAILED" }));
  expect(JSON.stringify(report)).not.toContain("DOCTOR_SYNTHETIC_ENVELOPE_SECRET");
});

it("ignores commented enablement and never evaluates object-valued configuration", async () => {
  const project = installedFixture();
  writeFileSync(join(project, "project.godot"), 'config_version=5\n[application]\ncustom=Object(Node,"name":"DOCTOR_SYNTHETIC_DATA")\n[editor_plugins]\n; enabled=PackedStringArray("res://addons/mcp_loop/plugin.cfg")\nenabled=PackedStringArray()\n');
  const before = inventory(project);
  const report = await diagnose(project, {}, goodProbes);
  expect(report.checks).toContainEqual(expect.objectContaining({ id: "plugin", status: "problem", code: "ADDON_NOT_ENABLED" }));
  expect(JSON.stringify(report)).not.toContain("DOCTOR_SYNTHETIC_DATA");
  expect(inventory(project)).toEqual(before);
});


const syntaxSpaces = [
  { label: "NBSP", space: "\u00a0" }, { label: "narrow-NBSP", space: "\u202f" },
  { label: "em-space", space: "\u2003" }, { label: "fullwidth-space", space: "\u3000" },
  { label: "interior-BOM", space: "\ufeff" },
].flatMap(item => ["enabled-key", "enabled-value", "metadata-key"].map(place => ({ ...item, place })));

it.each(syntaxSpaces)("refuses Unicode whitespace syntax instead of repairing it: $label/$place", async ({ space, place }) => {
  const project = installedFixture();
  if (place === "metadata-key") {
    const cfg = join(project, "addons/mcp_loop/plugin.cfg");
    writeFileSync(cfg, readFileSync(cfg, "utf8").replace("version=", `version${space}=`));
  } else {
    const marker = join(project, "project.godot");
    writeFileSync(marker, readFileSync(marker, "utf8").replace("enabled=", place === "enabled-key" ? `enabled${space}=` : `enabled=${space}`));
  }
  const report = await diagnose(project, {}, goodProbes);
  expect(report.status).toBe("not_checked");
  expect(report.checks).toContainEqual(expect.objectContaining(place === "metadata-key"
    ? { id: "addon", code: "ADDON_METADATA_UNREADABLE" }
    : { id: "plugin", code: "PROJECT_CONFIG_UNSUPPORTED" }));
  expect(report.checks.some(c => c.code === (place === "metadata-key" ? "ADDON_VERSION_MATCH" : "ADDON_ENABLED"))).toBe(false);
});

it("distinguishes a supported project BOM from unverified ConfigFile addon metadata", async () => {
  const project = installedFixture(), marker = join(project, "project.godot"), cfg = join(project, "addons/mcp_loop/plugin.cfg");
  writeFileSync(marker, "\ufeff" + readFileSync(marker, "utf8"));
  expect((await diagnose(project, {}, goodProbes)).status).toBe("ok");
  writeFileSync(cfg, "\ufeff" + readFileSync(cfg, "utf8"));
  const report = await diagnose(project, {}, goodProbes);
  expect(report.status).toBe("not_checked");
  expect(report.checks).toContainEqual(expect.objectContaining({ id: "addon", code: "ADDON_METADATA_UNREADABLE" }));
  expect(report.checks.some(c => c.code === "ADDON_VERSION_MATCH")).toBe(false);
});

it("preserves Unicode whitespace inside quoted values and comments", async () => {
  const project = installedFixture();
  const marker = join(project, "project.godot"), cfg = join(project, "addons/mcp_loop/plugin.cfg");
  writeFileSync(marker, readFileSync(marker, "utf8") + '[application]\nconfig/name="空白 \u00a0\u3000\ufeff は値のまま"\n; comment \u00a0\u3000\ufeff\n');
  writeFileSync(cfg, readFileSync(cfg, "utf8") + 'description="説明 \u00a0\u3000\ufeff"\n');
  const before = inventory(project), report = await diagnose(project, {}, goodProbes);
  expect(report.status).toBe("ok");
  expect(inventory(project)).toEqual(before);
});

it("does not contact an advertised live editor endpoint", async () => {
  const project = installedFixture(); let attempts = 0;
  const listener = createServer(socket => { attempts++; socket.destroy(); });
  listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = (listener.address() as { port: number }).port;
  mkdirSync(join(project, ".godot/mcp_loop"), { recursive: true, mode: 0o700 });
  writeFileSync(join(project, ".godot/mcp_loop/session.json"), JSON.stringify({ port, token: "DOCTOR_SYNTHETIC_SESSION_59", protocol: 1, pid: process.pid, project_path: project }), { mode: 0o600 });
  const before = inventory(project);
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(process.execPath, [binary, "doctor", project, "--json"], { timeout: 15000 }, (error, stdout, stderr) => {
        if ((error && error.code !== 1) || stderr) reject(error ?? new Error("Unexpected stderr."));
        else resolve(stdout);
      });
    });
    expect(JSON.parse(stdout).scope).toBe("static_installation_only");
    expect(JSON.parse(stdout).runtime.status).toBe("not_checked");
    expect(attempts).toBe(0);
    expect(inventory(project)).toEqual(before);
    const accepted = once(listener, "connection"), control = connect(port, "127.0.0.1");
    await accepted; control.destroy();
    expect(attempts).toBe(1);
  } finally { await new Promise<void>((resolve, reject) => listener.close(e => e ? reject(e) : resolve())); }
});

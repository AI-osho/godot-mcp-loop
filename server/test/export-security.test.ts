import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveExportOutput, runExport } from "../src/export.js";

// These must exercise the real filesystem: a string-only "res://build/" check misses every case below.
describe("export path containment", () => {
  let base: string;
  let project: string;
  let outside: string;

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "gml-export-security-")));
    project = join(base, "project");
    outside = join(base, "outside");
    mkdirSync(project);
    mkdirSync(outside);
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("refuses a symlinked build root before creating output folders", () => {
    symlinkSync(outside, join(project, "build"), "dir");
    expect(() => resolveExportOutput(project, "res://build/web/index.html")).toThrowError(/symbolic link/i);
    expect(readdirSync(outside)).toEqual([]);
  });

  it.each(["symlink", "hardlink"])("refuses a %s in an export's companion files", (kind) => {
    const dir = join(project, "build", "web");
    mkdirSync(dir, { recursive: true });
    const sentinel = join(outside, "keep.wasm");
    writeFileSync(sentinel, "DO NOT OVERWRITE");
    const companion = join(dir, "index.wasm");
    if (kind === "symlink") symlinkSync(sentinel, companion, "file");
    else linkSync(sentinel, companion);
    expect(() => resolveExportOutput(project, "res://build/web/index.html")).toThrowError(/link/i);
    expect(readFileSync(sentinel, "utf8")).toBe("DO NOT OVERWRITE");
  });

  it("refuses Godot argument normalization before creating the export folder", async () => {
    await expect(runExport({ projectPath: project, godotPath: "/missing-exporter", preset: "Web", absOutput: join(project, "build/a%20b/index.html"), timeoutMs: 1000 }))
      .rejects.toMatchObject({ code: "INVALID_PARAMS" });
    expect(existsSync(join(project, "build")), "a rejected argv must not create output folders").toBe(false);
  });

  it("rechecks containment immediately before starting the exporter", async () => {
    const target = resolveExportOutput(project, "res://build/web/index.html");
    symlinkSync(outside, join(project, "build"), "dir");
    await expect(runExport({ projectPath: project, godotPath: "/missing-exporter", preset: "Web", absOutput: target.abs, timeoutMs: 1000 }))
      .rejects.toMatchObject({ code: "PATH_FORBIDDEN" });
    expect(readdirSync(outside)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("settles a timeout even when a descendant keeps the export pipes open", async () => {
    const executable = join(base, "fake-godot-pipe-owner");
    const pidFile = join(base, "descendant.pid");
    writeFileSync(executable, `#!${process.execPath}\nconst child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });\nrequire('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));\nsetInterval(() => {}, 1000);\n`, { mode: 0o700 });
    let error: unknown;
    let deadline: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        runExport({ projectPath: project, godotPath: executable, preset: "Web", absOutput: join(project, "build/pipes.bin"), timeoutMs: 500 }),
        new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("Export remained pending after its timeout.")), 3000); }),
      ]);
    } catch (e) { error = e; }
    finally {
      if (deadline) clearTimeout(deadline);
      if (existsSync(pidFile)) {
        try { process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL"); } catch { /* already exited */ }
      }
    }
    expect(error).toMatchObject({ code: "TIMEOUT" });
  }, 6000);

  it.skipIf(process.platform === "win32")("keeps exporter diagnostics in timeout errors", async () => {
    const executable = join(base, "fake-godot-diagnostics");
    // Avoid racing a cold Node startup under parallel suite load: the marker must precede the timeout fault.
    writeFileSync(executable, `#!/bin/sh\nprintf '%s\\n' EXPORT_DIAGNOSTIC_MARKER >&2\nexec sleep 60\n`, { mode: 0o700 });
    await expect(runExport({ projectPath: project, godotPath: executable, preset: "Web", absOutput: join(project, "build/diagnostic.bin"), timeoutMs: 500 }))
      .rejects.toMatchObject({ code: "TIMEOUT", message: expect.stringContaining("EXPORT_DIAGNOSTIC_MARKER") });
  });

  it.skipIf(process.platform === "win32")("kills an exporter that ignores SIGTERM and reports TIMEOUT", async () => {
    const executable = join(base, "fake-godot");
    const term = join(base, "term-received");
    const pidFile = join(base, "exporter.pid");
    writeFileSync(executable, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nprocess.on('SIGTERM', () => require('node:fs').writeFileSync(${JSON.stringify(term)}, 'yes'));\nsetTimeout(() => process.exit(0), 4000);\n`, { mode: 0o700 });
    const started = Date.now();
    let error: unknown;
    try {
      await runExport({ projectPath: project, godotPath: executable, preset: "Web", absOutput: join(project, "build/timeout.bin"), timeoutMs: 500 });
    } catch (e) { error = e; }
    expect(error).toMatchObject({ code: "TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(existsSync(term), "the stub really ignored SIGTERM").toBe(true);
    const pid = Number(readFileSync(pidFile, "utf8"));
    expect(() => process.kill(pid, 0), "TIMEOUT must not claim the exporter stopped before its exit was observed")
      .toThrowError(expect.objectContaining({ code: "ESRCH" }));
  }, 6000);
});

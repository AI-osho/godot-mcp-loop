import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { BridgeError } from "./errors.js";

/**
 * Project export (project_export): `--export-release` with a preset from export_presets.cfg, started with a fixed
 * argument list (no shell) and confined to res://build/ so an export can never overwrite the project.
 */

export const EXPORT_ROOT = "build";

export interface ExportPreset {
  index: number;
  name: string;
  platform: string;
}

/** Reads the `[preset.N]` blocks of an export_presets.cfg (name and platform only). */
export function parseExportPresets(text: string): ExportPreset[] {
  const out: ExportPreset[] = [];
  let current: { index: number; name?: string; platform?: string } | null = null;
  const flush = (): void => {
    if (current?.name) out.push({ index: current.index, name: current.name, platform: current.platform ?? "" });
    current = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[preset\.(\d+)\]$/.exec(line);
    if (header) {
      flush();
      current = { index: Number(header[1]) };
      continue;
    }
    if (line.startsWith("[")) {
      flush();
      continue;
    }
    if (!current) continue;
    const kv = /^([A-Za-z_]+)\s*=\s*"(.*)"$/.exec(line);
    if (!kv) continue;
    if (kv[1] === "name") current.name = kv[2];
    if (kv[1] === "platform") current.platform = kv[2];
  }
  flush();
  return out.sort((a, b) => a.index - b.index);
}

export function readExportPresets(projectPath: string): ExportPreset[] {
  const file = join(projectPath, "export_presets.cfg");
  if (!existsSync(file)) {
    throw new BridgeError(
      "PRESET_NOT_FOUND",
      "This project has no export_presets.cfg, so there is nothing to export.",
      "Add a preset in Godot: Project > Export > Add…, then call project_export again.",
    );
  }
  const presets = parseExportPresets(readFileSync(file, "utf8"));
  if (presets.length === 0) {
    throw new BridgeError(
      "PRESET_NOT_FOUND",
      "export_presets.cfg has no [preset.N] block with a name.",
      "Add a preset in Godot: Project > Export > Add….",
    );
  }
  return presets;
}

const PLATFORM_EXT: Record<string, string> = {
  Web: "html",
  Linux: "x86_64",
  Windows: "exe",
  macOS: "zip",
  Android: "apk",
};

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "export";

/** Where the export goes when the caller does not say: res://build/<preset>. */
export function defaultOutput(preset: ExportPreset): string {
  const name = slug(preset.name);
  if (preset.platform === "Web") return `res://${EXPORT_ROOT}/${name}/index.html`;
  const ext = PLATFORM_EXT[preset.platform];
  if (!ext) {
    throw new BridgeError(
      "INVALID_PARAMS",
      `No default output name for platform "${preset.platform}".`,
      "Pass path: a res://build/... location (a file for most platforms, a folder or an .html for Web).",
    );
  }
  return `res://${EXPORT_ROOT}/${name}/${name}.${ext}`;
}

/** A res://build/... path, resolved to disk. Anything else is refused. */
export function resolveExportOutput(projectPath: string, path: string): { abs: string; res: string } {
  const rel = path.startsWith("res://") ? path.slice("res://".length) : path;
  if (isAbsolute(rel)) {
    throw new BridgeError("PATH_FORBIDDEN", `Use a res:// path under res://${EXPORT_ROOT}/ (got ${path}).`);
  }
  if (rel.includes("\\") || rel.split("/").includes("..")) {
    throw new BridgeError("PATH_FORBIDDEN", `Use a simple res://${EXPORT_ROOT}/... path (got ${path}).`);
  }
  const abs = resolve(projectPath, rel);
  const r = relative(projectPath, abs);
  if (r.startsWith("..") || isAbsolute(r)) {
    throw new BridgeError("PATH_FORBIDDEN", `${path} is outside the project.`);
  }
  const parts = r.split("/");
  if ((parts[0] ?? "").toLowerCase() !== EXPORT_ROOT || parts.length < 2) {
    throw new BridgeError(
      "PATH_FORBIDDEN",
      `Exports go under res://${EXPORT_ROOT}/ only (got ${path}).`,
      `Use res://${EXPORT_ROOT}/<name> so the project itself is never overwritten.`,
    );
  }
  return { abs, res: `res://${parts.join("/")}` };
}

/** The exact argument list handed to Godot (never a shell string). */
export function exportArgs(projectPath: string, preset: string, absOutput: string): string[] {
  return ["--headless", "--path", projectPath, "--export-release", preset, absOutput];
}

/** Files an export produced: the file itself, or the folder a Web export wrote into. */
export function exportedFiles(absOutput: string): Array<{ path: string; size: number }> {
  const out: Array<{ path: string; size: number }> = [];
  const stat = (p: string): void => {
    try {
      const s = statSync(p);
      if (s.isFile()) out.push({ path: p, size: s.size });
    } catch {
      /* not written */
    }
  };
  if (absOutput.endsWith(".html")) {
    const dir = absOutput.slice(0, absOutput.lastIndexOf("/"));
    try {
      for (const f of readdirSync(dir)) stat(join(dir, f));
    } catch {
      return out;
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }
  stat(absOutput);
  return out;
}


/** "4.7.2.stable.official.ed1daf0bf" -> "4.7.2.stable" (the folder Godot names its templates after). */
export function templateVersion(godotVersion: string): string {
  const m = /(\d+\.\d+(?:\.\d+)?\.[a-z]+)/i.exec(godotVersion);
  return m ? m[1]! : godotVersion.trim();
}

export interface TemplatesOptions {
  platform?: NodeJS.Platform;
  home?: string;
  env?: Record<string, string | undefined>;
}

/** Where Godot looks for export templates, per platform. */
export function templatesDir(godotVersion: string, opts: TemplatesOptions = {}): string {
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? homedir();
  const ver = templateVersion(godotVersion);
  if (platform === "darwin") return join(home, "Library", "Application Support", "Godot", "export_templates", ver);
  if (platform === "win32") {
    const appData = opts.env?.APPDATA ?? join(home, "AppData", "Roaming");
    return join(appData, "Godot", "export_templates", ver);
  }
  const data = opts.env?.XDG_DATA_HOME ?? join(home, ".local", "share");
  return join(data, "godot", "export_templates", ver);
}

/** Throws TEMPLATES_MISSING unless the templates for this Godot version are installed. */
export function checkTemplates(godotVersion: string, opts: TemplatesOptions = {}): string {
  const dir = templatesDir(godotVersion, opts);
  if (!existsSync(join(dir, "version.txt"))) {
    throw new BridgeError(
      "TEMPLATES_MISSING",
      `Godot has no export templates for ${templateVersion(godotVersion)} (${dir} is empty).`,
      "Install them once: Editor > Manage Export Templates > Download and Install (about 1.2 GB), then call project_export again.",
    );
  }
  return dir;
}

export interface ExportRunOptions {
  projectPath: string;
  godotPath: string;
  preset: string;
  absOutput: string;
  timeoutMs: number;
}

export interface ExportRunResult {
  log: string;
  duration_ms: number;
  exit_code: number | null;
}

/** Runs Godot's exporter and returns its log; throws with a hint when templates are missing or it failed. */
export function runExport(opts: ExportRunOptions): Promise<ExportRunResult> {
  return new Promise((resolvePromise, reject) => {
    const started = Date.now();
    // Godot refuses to export into a folder that does not exist yet.
    mkdirSync(dirname(opts.absOutput), { recursive: true });
    const child = spawn(opts.godotPath, exportArgs(opts.projectPath, opts.preset, opts.absOutput), {
      shell: false,
      cwd: opts.projectPath,
      windowsHide: true,
    });
    let log = "";
    const keep = (chunk: Buffer): void => {
      log += chunk.toString();
      if (log.length > 200_000) log = log.slice(-200_000);
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, opts.timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new BridgeError("EXPORT_FAILED", `Could not start Godot: ${e.message}`, "Check the --godot path or GODOT_BIN."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const result = { log, duration_ms: Date.now() - started, exit_code: code };
      const missing = /no export template|export template(s)? (are|is) missing|not found:.*template/i.test(log);
      if (code === 0 && !missing) {
        resolvePromise(result);
        return;
      }
      if (missing) {
        reject(
          new BridgeError(
            "TEMPLATES_MISSING",
            `Godot has no export templates for this version.\n${tail(log)}`,
            "Install them once: Editor > Manage Export Templates > Download and Install (about 1 GB), then call project_export again.",
          ),
        );
        return;
      }
      reject(new BridgeError("EXPORT_FAILED", `Godot exited with ${code}.\n${tail(log)}`, "Read the log above; fix the preset or the project and try again."));
    });
  });
}

const tail = (log: string): string => log.trim().split(/\r?\n/).slice(-12).join("\n");

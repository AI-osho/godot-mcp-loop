import { execFile } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { FILE_READ_LIMITS, readTextFileBounded } from "./bounded-io.js";
import { findGodot, parseGodotVersion, type FoundGodot } from "./editor-launcher.js";
import { SERVER_VERSION } from "./version.js";

export type DoctorStatus = "ok" | "problem" | "not_checked";
export interface DoctorCheck { id: string; status: DoctorStatus; code: string; message: string; hint?: string; required?: boolean }
export interface DoctorOptions { artwork?: boolean }
/** Trusted test seams only; the CLI never accepts callbacks or executable recipes. */
export interface DoctorProbes { nodeVersion?: string; findGodot?: () => Promise<FoundGodot>; artwork?: () => Promise<unknown> }
export interface DoctorReport {
  schema_version: 1;
  scope: "static_installation_only";
  server_version: string;
  status: DoctorStatus;
  checks: DoctorCheck[];
  runtime: { status: "not_checked"; code: "RUNTIME_NOT_CHECKED" };
}

const DOCTOR_USAGE = "Usage: godot-mcp-loop doctor <project> [--json] [--artwork]\nStatic checks only: no editor launch, connection, repair or installation.";
function reportFor(checks: DoctorCheck[]): DoctorReport {
  return {
    schema_version: 1, scope: "static_installation_only", server_version: SERVER_VERSION,
    status: checks.some(c => c.status === "problem") ? "problem" : checks.some(c => c.required !== false && c.status === "not_checked") ? "not_checked" : "ok",
    checks, runtime: { status: "not_checked", code: "RUNTIME_NOT_CHECKED" },
  };
}

/** Fixed probes inherit no provider/auth variables and never receive a project argument. */
function probe(program: string, args: string[], timeout = 5000): Promise<string> {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "Path", "HOME", "SystemRoot", "WINDIR", "TMPDIR", "TEMP", "TMP"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return new Promise((resolve, reject) => {
    execFile(program, args, { cwd: tmpdir(), env, timeout, killSignal: "SIGKILL", maxBuffer: 4096, windowsHide: true }, (error, stdout) => {
      if (error) reject(new Error("Version probe unavailable."));
      else resolve(stdout);
    });
  });
}

const PYTHON_CHECK = [
  "import sys, json",
  "sys.path = [p for p in sys.path if p]",
  "result = {'python': list(sys.version_info[:3]), 'pillow': None}",
  "try:",
  " import PIL",
  " result['pillow'] = PIL.__version__",
  "except ImportError:",
  " pass",
  "print(json.dumps(result))",
].join("\n");

async function probeArtwork(): Promise<unknown> {
  const python = process.env.GODOT_LOOP_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  // Match the artwork worker's interpreter/flags; -I would hide supported user-site Pillow installs.
  return JSON.parse(await probe(python, ["-B", "-E", "-c", PYTHON_CHECK])) as unknown;
}

function artworkCheck(value: unknown): DoctorCheck {
  const hint = "Use a trusted Python 3.11+ environment with Pillow 13.0.0; select it with GODOT_LOOP_PYTHON. No installation was performed.";
  if (typeof value !== "object" || value === null) throw new Error("Invalid probe envelope.");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(",") !== "pillow,python" || !Array.isArray(v.python) || v.python.length !== 3 || !v.python.every(n => Number.isSafeInteger(n) && n >= 0 && n < 10000) || (v.pillow !== null && typeof v.pillow !== "string")) throw new Error("Invalid probe envelope.");
  if (v.python[0] !== 3 || v.python[1] < 11) return { id: "artwork", status: "problem", code: "PYTHON_UNSUPPORTED", message: "The selected interpreter does not meet the Python 3.11+ requirement.", hint };
  if (v.pillow !== "13.0.0") return { id: "artwork", status: "problem", code: "PILLOW_VERSION_MISMATCH", message: "The selected interpreter cannot import the required Pillow 13.0.0.", hint };
  return { id: "artwork", status: "ok", code: "PYTHON_PILLOW_READY", message: "The selected Python can import Pillow 13.0.0. Image generation, credentials and image processing itself were not tested." };
}

function discoverGodot(): Promise<FoundGodot> {
  const deadline = performance.now() + 5000;
  let attempts = 0;
  return findGodot({ runVersion: path => {
    const remaining = Math.ceil(deadline - performance.now());
    if (++attempts > 4 || remaining <= 0) return Promise.reject(new Error("Probe budget exhausted."));
    return probe(path, ["--headless", "--version"], remaining);
  } });
}

/** Only syntax whitespace from the supported native subset, never Unicode token normalization. */
function trimSyntax(value: string): string {
  return value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
}

/** A bounded lexer for static ConfigFile assignments; never decodes Object/Resource variants. */
function statements(text: string): string[] | undefined {
  const out: string[] = [], stack: string[] = [];
  let current = "", quoted = false, escaped = false, comment = false;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i] ?? "\n";
    if (comment) { if (c !== "\n") continue; comment = false; }
    if (quoted) {
      current += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === ";") { comment = true; continue; }
    if (c === '"') { quoted = true; current += c; continue; }
    // JS whitespace is broader than native key/value syntax. Refuse instead of repairing it.
    // Quotes and comments above deliberately preserve their literal Unicode contents.
    if (/[^\S \t\r\n]/u.test(c)) return undefined;
    if ("([{".includes(c)) { stack.push(c); if (stack.length > 64) return undefined; }
    if (")]}".includes(c)) {
      const expected: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
      if (stack.pop() !== expected[c]) return undefined;
    }
    if (c === "\n" && stack.length === 0) {
      const statement = trimSyntax(current);
      if (statement) out.push(statement);
      if (out.length > 4096) return undefined;
      current = "";
    } else current += c;
  }
  return quoted || stack.length ? undefined : out;
}

/** undefined is ambiguous/unsupported, null is absent, otherwise the original bounded value. */
function configValue(text: string, wantedSection: string, key: string): string | null | undefined {
  const parsed = statements(text);
  if (!parsed) return undefined;
  let section = "", sections = 0, matches = 0, value: string | null = null;
  for (const s of parsed) {
    const header = /^\[([A-Za-z0-9_./-]+)\]$/.exec(s);
    if (header) {
      section = header[1]!;
      if (section === wantedSection && ++sections > 1) return undefined;
      continue;
    }
    const assignment = /^([A-Za-z0-9_./-]+)[ \t]*=[ \t]*([\s\S]*)$/.exec(s);
    if (!assignment) return undefined;
    if (section === wantedSection && assignment[1] === key) {
      if (++matches > 1) return undefined;
      value = trimSyntax(assignment[2]!);
    }
  }
  return value;
}

function configString(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  try { const v: unknown = JSON.parse(value); return typeof v === "string" ? v : undefined; }
  catch { return undefined; }
}

function enabledPlugins(value: string | null | undefined): string[] | undefined {
  if (value === null) return [];
  if (value === undefined) return undefined;
  const m = /^PackedStringArray\(([\s\S]*)\)$/.exec(value);
  if (!m) return undefined;
  try {
    const v: unknown = JSON.parse(`[${m[1]}]`);
    return Array.isArray(v) && v.length <= 1024 && v.every(s => typeof s === "string") ? v as string[] : undefined;
  } catch { return undefined; }
}

type Input = { kind: "value"; text: string } | { kind: "missing" | "unreadable" };

function inputFile(root: string, parts: string[], limit: number, read = true): Input {
  try {
    let path = root;
    for (let i = 0; i < parts.length; i++) {
      path = join(path, parts[i]!);
      const st = lstatSync(path), last = i === parts.length - 1;
      if (st.isSymbolicLink() || (!last && !st.isDirectory()) || (last && (!st.isFile() || st.nlink > 1 || st.size > limit))) return { kind: "unreadable" };
      const rel = relative(root, realpathSync(path));
      if (isAbsolute(rel) || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\")) return { kind: "unreadable" };
    }
    return { kind: "value", text: read ? readTextFileBounded(path, limit) : "" };
  } catch (e) {
    return { kind: (e as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable" };
  }
}

function staticChecks(project: string): { checks: DoctorCheck[]; canProbe: boolean } {
  let root: string;
  try {
    root = realpathSync(resolve(project));
    if (!lstatSync(root).isDirectory()) throw new Error("Not a directory.");
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === "ENOENT";
    return { checks: [{ id: "project", status: "problem", code: missing ? "PROJECT_NOT_FOUND" : "PROJECT_UNREADABLE", message: "The selected project folder could not be inspected safely." }], canProbe: false };
  }
  const marker = inputFile(root, ["project.godot"], FILE_READ_LIMITS.text);
  if (marker.kind !== "value") return { checks: [{ id: "project", status: "problem", code: marker.kind === "missing" ? "PROJECT_NOT_FOUND" : "PROJECT_UNREADABLE", message: "The project marker is absent or cannot be read as a bounded regular file without symbolic or multiple hard links." }], canProbe: false };
  const checks: DoctorCheck[] = [{ id: "project", status: "ok", code: "PROJECT_FOUND", message: "The project marker was read without loading project code." }];
  // ProjectSettings accepts one leading UTF-8 BOM; ConfigFile addon metadata is not the same reader.
  const projectText = marker.text.replace(/^\uFEFF/, "");
  if (configValue(projectText, "", "config_version") !== "5") {
    checks.push({ id: "plugin", status: "not_checked", code: "PROJECT_CONFIG_UNSUPPORTED", message: "The marker is not a recognized, unambiguous project format; no project code was loaded." });
    return { checks, canProbe: false };
  }
  const cfg = inputFile(root, ["addons", "mcp_loop", "plugin.cfg"], FILE_READ_LIMITS.metadata);
  if (cfg.kind !== "value") {
    checks.push({ id: "addon", status: "problem", code: cfg.kind === "missing" ? "ADDON_NOT_INSTALLED" : "ADDON_UNREADABLE", message: "The addon metadata is absent or cannot be inspected safely.", hint: "Install the matching addon into the selected project; do not force-overwrite existing work." });
    return { checks, canProbe: cfg.kind === "missing" };
  }
  const version = configString(configValue(cfg.text, "plugin", "version"));
  checks.push(version === undefined
    ? { id: "addon", status: "not_checked", code: "ADDON_METADATA_UNREADABLE", message: "The addon version metadata is ambiguous or unsupported." }
    : version === SERVER_VERSION
      ? { id: "addon", status: "ok", code: "ADDON_VERSION_MATCH", message: "The addon and server versions match." }
      : { id: "addon", status: "problem", code: "ADDON_VERSION_MISMATCH", message: "The addon and server versions differ.", hint: "Use matching server and addon versions; do not force-overwrite a working project." });
  const entries = [["addons", "mcp_loop", "plugin.gd"], ["addons", "mcp_loop", "runtime", "runtime_agent.gd"]];
  const complete = entries.every(parts => inputFile(root, parts, FILE_READ_LIMITS.text, false).kind === "value");
  const entry = configString(configValue(cfg.text, "plugin", "script"));
  checks.push(entry !== "plugin.gd"
    ? { id: "addon_files", status: "not_checked", code: "ADDON_ENTRY_UNVERIFIED", message: "The addon does not declare the expected entry script; it was not executed." }
    : complete
      ? { id: "addon_files", status: "ok", code: "ADDON_ENTRY_FILES_PRESENT", message: "Required entry files are present; code and full addon integrity were not executed or certified." }
      : { id: "addon_files", status: "problem", code: "ADDON_FILES_MISSING", message: "Required addon entry files are missing or unsafe to inspect." });
  const enabled = enabledPlugins(configValue(projectText, "editor_plugins", "enabled"));
  checks.push(enabled === undefined
    ? { id: "plugin", status: "not_checked", code: "PROJECT_CONFIG_UNSUPPORTED", message: "Plugin settings are ambiguous or use an unsupported static form.", hint: "Inspect and normalize settings in Godot; doctor did not load or modify them." }
    : enabled.includes("res://addons/mcp_loop/plugin.cfg")
      ? { id: "plugin", status: "ok", code: "ADDON_ENABLED", message: "The MCP Loop plugin is enabled in the project settings." }
      : { id: "plugin", status: "problem", code: "ADDON_NOT_ENABLED", message: "The MCP Loop plugin is not enabled.", hint: "Enable MCP Loop in Project Settings > Plugins, then rerun doctor." });
  return { checks, canProbe: true };
}

/** Static installation diagnosis only: never opens an editor or a bridge connection. */
export async function diagnose(project: string, options: DoctorOptions = {}, probes: DoctorProbes = {}): Promise<DoctorReport> {
  const { checks, canProbe } = staticChecks(project);
  const node = /^(\d{1,3})\.\d+\.\d+$/.exec(probes.nodeVersion ?? process.versions.node);
  checks.unshift(node && Number(node[1]) >= 20
    ? { id: "node", status: "ok", code: "NODE_SUPPORTED", message: "Node.js meets the declared minimum (20+)." }
    : { id: "node", status: "problem", code: "NODE_UNSUPPORTED", message: "Node.js 20 or newer is required." });
  if (canProbe) {
    try {
      const found = await (probes.findGodot ?? discoverGodot)();
      const v = parseGodotVersion(found.version);
      const verified = v?.major === 4 && v.minor === 7 && v.patch === 2 && /^4\.7\.2\.stable(?:\.|$)/.test(v.text);
      checks.push(verified
        ? { id: "godot", status: "ok", code: "GODOT_VERSION_VERIFIED", message: "Godot reports 4.7.2, the exercised release version. Import and runtime remain unchecked." }
        : { id: "godot", status: "not_checked", code: "GODOT_VERSION_UNVERIFIED", message: "The reported Godot version is not the exercised 4.7.2 release.", hint: "Use the tested engine version or qualify this version separately." });
    } catch {
      checks.push({ id: "godot", status: "problem", code: "GODOT_NOT_FOUND", message: "No usable Godot executable was found within the bounded version probes.", hint: "Install Godot 4.7.2 or select its trusted executable with GODOT_BIN." });
    }
  }
  if (options.artwork) {
    try { checks.push(artworkCheck(await (probes.artwork ?? probeArtwork)())); }
    catch { checks.push({ id: "artwork", status: "problem", code: "ARTWORK_PROBE_FAILED", message: "The selected Python/Pillow probe could not be verified.", hint: "Select a trusted Python 3.11+/Pillow 13.0.0 interpreter with GODOT_LOOP_PYTHON." }); }
  } else {
    checks.push({ id: "artwork", status: "not_checked", required: false, code: "ARTWORK_NOT_REQUESTED", message: "Optional artwork dependencies were not requested. Non-artwork tools do not require them." });
  }
  return reportFor(checks);
}

export async function runDoctorCli(argv: string[], log: (text: string) => void = console.log): Promise<number> {
  const flags = new Set(["--json", "--artwork", "--help", "-h"]);
  const positional = argv.filter(a => !a.startsWith("-"));
  const help = argv.includes("--help") || argv.includes("-h");
  if (argv.some(a => a.length === 0 || /[\u0000-\u001f\u007f]/.test(a) || (a.startsWith("-") && !flags.has(a))) || positional.length > 1 || (!help && positional.length !== 1)) {
    const invalid = reportFor([{ id: "arguments", status: "problem", code: "INVALID_ARGUMENTS", message: "Pass one project folder and only the documented doctor options." }]);
    log(argv.includes("--json") ? JSON.stringify(invalid, null, 2) : `INVALID_ARGUMENTS\n${DOCTOR_USAGE}`);
    return 2;
  }
  if (help) { log(DOCTOR_USAGE); return 0; }
  const report = await diagnose(positional[0]!, { artwork: argv.includes("--artwork") });
  log(argv.includes("--json") ? JSON.stringify(report, null, 2) : [
    `Static installation checks: ${report.status.toUpperCase()}`,
    ...report.checks.map(c => `${c.status}: ${c.code} — ${c.message}${c.hint ? `\n  Next: ${c.hint}` : ""}`),
    "Runtime: RUNTIME_NOT_CHECKED — no editor, bridge connection, resource import or gameplay was tested.",
  ].join("\n"));
  return report.status === "ok" ? 0 : 1;
}

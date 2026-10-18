import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { BridgeError } from "../errors.js";
import { SERVER_VERSION } from "../version.js";
import type { ScenarioReport, Shot } from "./runner.js";

/**
 * Evidence on disk for scenario_run's save_to (#13): screenshots as PNG files plus a markdown report and a JSON
 * manifest, so a run can be checked later by a person or attached to a pull request. The folder gets a .gdignore so
 * the editor does not import the images. A re-run deletes only the files its previous manifest lists (regular files
 * inside the folder); a non-empty folder without a manifest is refused.
 */

const GENERATOR = "godot-mcp-loop";
const PROTECTED = [".godot", ".git"];
const MANIFESTS = ["report.json", "summary.json"];

export interface SavedEvidence {
  /** res:// path of the folder. */
  dir: string;
  /** Files written, relative to the folder. */
  files: string[];
  /** PNG files written (including failure screenshots). */
  screenshots: number;
  /** The human-readable entry point: report.md or summary.md. */
  index: string;
}

export interface EvidenceBatchEntry {
  path: string;
  report?: ScenarioReport;
  error?: string;
  skipped?: boolean;
}

const forbidden = (msg: string) => new BridgeError("PATH_FORBIDDEN", msg);
const isOutside = (r: string) => r.startsWith("..") || isAbsolute(r);
const isProtected = (r: string) => PROTECTED.includes(r.split(sep)[0] ?? "");

/** The report without image data (images are separate files or content items). */
export function withoutImages(r: ScenarioReport): unknown {
  return {
    ...r,
    screenshots: r.screenshots.map(({ label, width, height }) => ({ label, width, height })),
    failure_screenshot: r.failure_screenshot ? { label: r.failure_screenshot.label } : undefined,
  };
}

/**
 * Resolves (and with create, makes) an evidence folder inside the project. Same rules as reads: no absolute paths,
 * nothing outside the project or under .godot/ or .git/, symbolic links resolved before checking. The project root
 * itself is refused. Without create, an existing folder is also checked for ownership (see the module comment).
 */
export function resolveEvidenceFolder(projectPath: string, path: string, create = true): { abs: string; res: string } {
  const rel = path.startsWith("res://") ? path.slice("res://".length) : path;
  if (isAbsolute(rel)) throw forbidden(`Use a res:// or project-relative folder (got ${path}).`);
  const root = realpathSync(projectPath);
  const full = resolve(root, rel);
  const r = relative(root, full);
  if (r === "") throw forbidden("Choose a folder inside the project, e.g. res://qa/evidence/<name>, not the project root.");
  if (isOutside(r)) throw forbidden(`${path} is outside the project.`);
  if (isProtected(r)) throw forbidden(`Writing under ${r.split(sep)[0]}/ is not allowed.`);

  // The deepest part of the path that exists must resolve inside the project (symbolic links).
  let probe = full;
  for (;;) {
    try {
      lstatSync(probe);
      break;
    } catch {
      probe = dirname(probe);
    }
  }
  let real: string;
  try {
    real = realpathSync(probe);
  } catch {
    throw forbidden(`${path} goes through a broken symbolic link.`);
  }
  const rr = relative(root, real);
  if (isOutside(rr) || isProtected(rr) || (probe === full && rr === "")) {
    throw forbidden(`${path} resolves outside the project, to its root, or into a protected folder (symbolic link).`);
  }
  if (probe === full && !statSync(real).isDirectory()) {
    throw new BridgeError("INVALID_PARAMS", `${path} is a file; save_to needs a folder.`);
  }
  const res = `res://${r.split(sep).join("/")}`;
  if (!create) {
    if (probe === full) ownedFiles(real, res);
    return { abs: full, res };
  }
  mkdirSync(full, { recursive: true });
  const made = relative(root, realpathSync(full));
  if (isOutside(made) || isProtected(made) || made === "") throw forbidden(`${path} resolves outside the project.`);
  return { abs: full, res };
}

/** Files listed by this folder's manifests; throws if the folder has other content but no manifest. */
function ownedFiles(dir: string, res: string): string[] {
  const listed: string[] = [];
  let owned = false;
  for (const name of MANIFESTS) {
    const file = join(dir, name);
    if (!existsSync(file)) continue;
    try {
      const m = JSON.parse(readFileSync(file, "utf8")) as { generator?: unknown; files?: unknown };
      if (m.generator === GENERATOR && Array.isArray(m.files)) {
        owned = true;
        listed.push(...m.files.filter((f): f is string => typeof f === "string"));
      }
    } catch {
      // not ours
    }
  }
  const content = readdirSync(dir).filter((n) => n !== ".gdignore");
  if (content.length > 0 && !owned) {
    throw new BridgeError(
      "INVALID_PARAMS",
      `${res} is not empty and was not written by scenario_run; choose another folder for save_to (nothing was changed).`,
    );
  }
  return listed;
}

/** Deletes the previous run's files: only regular files strictly inside the folder, then emptied subfolders. */
function removePrevious(dir: string, files: string[]): void {
  const realDir = realpathSync(dir);
  const subdirs = new Set<string>();
  for (const f of files) {
    if (f === "" || isAbsolute(f)) continue;
    const norm = normalize(f);
    if (isOutside(norm) || norm.split(sep).includes("..")) continue;
    const target = resolve(dir, norm);
    const r = relative(dir, target);
    if (r === "" || isOutside(r)) continue;
    let st;
    try {
      st = lstatSync(target);
      const parent = relative(realDir, realpathSync(dirname(target)));
      if (isOutside(parent)) continue;
    } catch {
      continue;
    }
    if (!st.isFile()) continue; // never follows or removes links and folders
    unlinkSync(target);
    if (r.includes(sep)) subdirs.add(r.split(sep)[0]!);
  }
  for (const s of subdirs) {
    const p = join(dir, s);
    try {
      if (lstatSync(p).isDirectory() && readdirSync(p).length === 0) rmdirSync(p);
    } catch {
      // already gone
    }
  }
}

/** Writes a file without following a symbolic link that may sit at the target. */
function writeOwn(path: string, data: string | Buffer): void {
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) unlinkSync(path);
    else if (!st.isFile()) throw forbidden(`${basename(path)} exists and is not a file.`);
  } catch (e) {
    if (e instanceof BridgeError) throw e;
  }
  writeFileSync(path, data);
}

/** A subfolder of the evidence folder; refuses one that is a symbolic link. */
function ownSubdir(dir: string, name: string): string {
  const p = join(dir, name);
  try {
    if (lstatSync(p).isSymbolicLink()) throw forbidden(`${name} in the evidence folder is a symbolic link.`);
  } catch (e) {
    if (e instanceof BridgeError) throw e;
  }
  mkdirSync(p, { recursive: true });
  return p;
}

function prepare(projectPath: string, saveTo: string): { abs: string; res: string } {
  const folder = resolveEvidenceFolder(projectPath, saveTo, true);
  removePrevious(folder.abs, ownedFiles(folder.abs, folder.res));
  writeOwn(join(folder.abs, ".gdignore"), "");
  return folder;
}

export function shotFileName(index: number, label: string): string {
  const slug =
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/, "") || "shot";
  return `${String(index + 1).padStart(2, "0")}-${slug}.png`;
}

const altText = (s: string) => s.replace(/[[\]\n\r]/g, " ").trim();
/** Text for one Markdown table cell: backslashes first, then pipes, and no line breaks. */
export const mdCell = (s: string): string => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const stamp = () => new Date().toISOString();

/** Writes one scenario's files into dir; returns names relative to dir. */
function writeScenario(dir: string, report: ScenarioReport, summary: string, source: string | undefined): { files: string[]; pngs: number } {
  const files: string[] = [];
  const shots: Array<{ shot: Shot; file: string; failure: boolean }> = report.screenshots.map((shot, i) => ({
    shot,
    file: shotFileName(i, shot.label),
    failure: false,
  }));
  if (report.failure_screenshot) shots.push({ shot: report.failure_screenshot, file: "failure.png", failure: true });
  for (const s of shots) {
    writeOwn(join(dir, s.file), Buffer.from(s.shot.png_base64, "base64"));
    files.push(s.file);
  }
  const md = [
    `# Scenario evidence: ${report.name}`,
    "",
    `- Result: **${report.passed ? "PASSED" : "FAILED"}**`,
    `- Scenario: ${source ?? "inline"}`,
    `- Generated: ${stamp()} by ${GENERATOR} ${SERVER_VERSION}`,
    "",
    "```text",
    summary,
    "```",
  ];
  if (shots.length > 0) {
    md.push("", "## Screenshots");
    shots.forEach((s, i) => {
      md.push("", `### ${s.failure ? `Failure: ${s.shot.label}` : `${i + 1}. ${s.shot.label}`}`, "", `![${altText(s.shot.label)}](${s.file})`);
    });
  }
  writeOwn(join(dir, "report.md"), `${md.join("\n")}\n`);
  files.push("report.md", "report.json");
  const manifest = {
    generator: GENERATOR,
    version: SERVER_VERSION,
    generated_at: stamp(),
    scenario: source ?? "inline",
    passed: report.passed,
    files,
    report: withoutImages(report),
  };
  writeOwn(join(dir, "report.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { files, pngs: shots.length };
}

export function saveScenarioEvidence(
  projectPath: string,
  saveTo: string,
  report: ScenarioReport,
  summary: string,
  source?: string,
): SavedEvidence {
  const folder = prepare(projectPath, saveTo);
  const { files, pngs } = writeScenario(folder.abs, report, summary, source);
  return { dir: folder.res, files, screenshots: pngs, index: "report.md" };
}

function folderName(path: string, used: Set<string>): string {
  const stem = basename(path, extname(path)).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "scenario";
  let name = stem;
  for (let n = 2; used.has(name); n++) name = `${stem}-${n}`;
  used.add(name);
  return name;
}

const shortSummary = (r: ScenarioReport): string => `Scenario "${r.name}": ${r.passed ? "PASSED" : "FAILED"}`;

/** summariseOne gives each scenario's report.md the same text the tool shows for a single run. */
export function saveBatchEvidence(
  projectPath: string,
  saveTo: string,
  entries: EvidenceBatchEntry[],
  summary: string,
  summariseOne: (report: ScenarioReport) => string = shortSummary,
): SavedEvidence {
  const folder = prepare(projectPath, saveTo);
  const used = new Set<string>(["summary"]);
  const files: string[] = [];
  let pngs = 0;
  const rows: string[] = [];
  const scenarios: unknown[] = [];
  for (const e of entries) {
    if (e.report) {
      const name = folderName(e.path, used);
      const out = writeScenario(ownSubdir(folder.abs, name), e.report, summariseOne(e.report), e.path);
      files.push(...out.files.map((f) => `${name}/${f}`));
      pngs += out.pngs;
      rows.push(`| ${mdCell(e.path)} | ${e.report.passed ? "✓ passed" : "✗ FAILED"} | [report](${name}/report.md) |`);
      scenarios.push({ path: e.path, folder: name, passed: e.report.passed });
    } else if (e.skipped) {
      rows.push(`| ${mdCell(e.path)} | - not run | |`);
      scenarios.push({ path: e.path, skipped: true });
    } else {
      rows.push(`| ${mdCell(e.path)} | ✗ ${mdCell(e.error ?? "error")} | |`);
      scenarios.push({ path: e.path, error: e.error });
    }
  }
  const passed = entries.filter((e) => e.report?.passed).length;
  const md = [
    `# Scenario evidence: ${passed}/${entries.length} passed`,
    "",
    `- Generated: ${stamp()} by ${GENERATOR} ${SERVER_VERSION}`,
    "",
    "```text",
    summary,
    "```",
    "",
    "| Scenario | Result | Report |",
    "|---|---|---|",
    ...rows,
  ];
  writeOwn(join(folder.abs, "summary.md"), `${md.join("\n")}\n`);
  files.push("summary.md", "summary.json");
  const manifest = { generator: GENERATOR, version: SERVER_VERSION, generated_at: stamp(), passed, total: entries.length, files, scenarios };
  writeOwn(join(folder.abs, "summary.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir: folder.res, files, screenshots: pngs, index: "summary.md" };
}

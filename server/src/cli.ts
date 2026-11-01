import { FILE_READ_LIMITS, readTextFileBounded } from "./bounded-io.js";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_VERSION } from "./version.js";

/**
 * Command-line helpers next to the MCP server (#16):
 *   godot-mcp-loop install-addon <project> [--skill] [--force] [--no-enable]
 * copies the editor addon of the same version as this server (bundled in the npm package) into a Godot project and
 * enables it in project.godot.
 */

export class CliError extends Error {}

const PLUGIN = "res://addons/mcp_loop/plugin.cfg";
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const USAGE = `Usage:
  godot-mcp-loop [--project <dir>]                      run the MCP server (stdio) for a Godot project
      --projects-root <dir>   allow switching (project_connect) to the projects below <dir>; repeatable
      --godot <path>          Godot executable for editor_launch (default: $GODOT_BIN, PATH, usual install folders)
  godot-mcp-loop install-addon <dir> [options]          copy the editor addon (same version) into a project
      --skill       also add the agent skill to <dir>/.claude/skills/godot-mcp-loop
      --force       replace an addon of another version (or an existing skill)
      --no-enable   do not edit project.godot (enable it in Project Settings > Plugins)
  godot-mcp-loop sample                                 list the bundled sample projects
  godot-mcp-loop sample <name> <dir>                    copy a sample project (e.g. marble-3d) into <dir>
  godot-mcp-loop --version`;

/** In a checkout of the repository the addon and skill come from it; in the npm package from the bundled copies. */
export function assetDirs(): { addon: string; skill: string } {
  const repo = resolve(pkgRoot, "..");
  if (basename(pkgRoot) === "server" && existsSync(join(repo, "addons", "mcp_loop", "plugin.cfg"))) {
    return { addon: join(repo, "addons", "mcp_loop"), skill: join(repo, ".claude", "skills", "godot-mcp-loop") };
  }
  return { addon: join(pkgRoot, "addon", "mcp_loop"), skill: join(pkgRoot, "skill", "godot-mcp-loop") };
}

/** Where the bundled sample projects live (the repository's samples/, or the package's copy). */
export function samplesDir(): string {
  const repo = resolve(pkgRoot, "..");
  if (basename(pkgRoot) === "server" && existsSync(join(repo, "samples"))) return join(repo, "samples");
  return join(pkgRoot, "samples");
}

export function listSamples(): string[] {
  const dir = samplesDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** Refuse writes into the running installation, including path aliases and missing final components. */
function assertOutsidePackage(target: string, extra: string[] = [], refuseContainingSource = false): void {
  // Compare filesystem identities, not spellings: both a symlink alias and differently cased paths on macOS/Windows
  // can reach this package while looking unrelated to pkgRoot. Missing final components are checked via their parent.
  const sourcePaths = [pkgRoot, ...extra];
  const protectedDirs = sourcePaths.map((p) => statSync(p));
  let ancestor = target;
  for (;;) {
    try { lstatSync(ancestor); break; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new CliError(`Cannot inspect ${ancestor}; choose a writable folder.`);
      const parent = dirname(ancestor);
      if (parent === ancestor) throw new CliError(`Cannot resolve ${target}.`);
      ancestor = parent;
    }
  }
  try { ancestor = realpathSync(ancestor); }
  catch { throw new CliError(`${target} goes through a broken symbolic link.`); }
  for (;;) {
    const st = statSync(ancestor);
    if (protectedDirs.some((p) => p.dev === st.dev && p.ino === st.ino)) {
      throw new CliError(`${target} is inside the installed package or sample source; pick a folder outside it.`);
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  if (!refuseContainingSource) return;
  let targetId;
  try { targetId = statSync(target); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
  // rmSync would also delete a running package/source nested below the target. Check both directions before any copy.
  for (const source of sourcePaths) {
    let current = realpathSync(source);
    for (;;) {
      const st = statSync(current);
      if (st.dev === targetId.dev && st.ino === targetId.ino) {
        throw new CliError(`${target} contains the installed package or copy source; refusing to replace it.`);
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
}

/** Copies a sample project into an empty or missing folder. */
export function copySample(name: string, dest: string): { name: string; project: string; files: number } {
  const available = listSamples();
  if (!available.includes(name)) {
    throw new CliError(`No sample called "${name}". Available: ${available.join(", ") || "(none)"}.`);
  }
  const source = join(samplesDir(), name);
  const target = resolve(dest);
  assertOutsidePackage(target, [source]);
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new CliError(`${target} is not empty; pass a new folder for the sample.`);
  }
  cpSync(source, target, { recursive: true });
  const count = (function walk(dir: string): number {
    return readdirSync(dir, { withFileTypes: true }).reduce((n: number, e) => n + (e.isDirectory() ? walk(join(dir, e.name)) : 1), 0);
  })(target);
  return { name, project: target, files: count };
}

function addonVersion(dir: string): string | undefined {
  try {
    return /^version="([^"]*)"/m.exec(readTextFileBounded(join(dir, "plugin.cfg"), FILE_READ_LIMITS.metadata))?.[1];
  } catch {
    return undefined;
  }
}

/** A path below root; refuses symbolic links on the way so nothing is written outside the project. */
function inside(root: string, ...parts: string[]): string {
  let p = root;
  for (const part of parts) {
    p = join(p, part);
    try {
      const st = lstatSync(p);
      if (st.isSymbolicLink() || (st.isFile() && st.nlink > 1)) {
        throw new CliError(`${p} is a symbolic link or hard link; refusing to write through it.`);
      }
    } catch (e) {
      if (e instanceof CliError) throw e;
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      break; // does not exist yet
    }
  }
  return join(root, ...parts);
}

/** Adds the plugin to [editor_plugins] enabled=PackedStringArray(...), keeping other plugins and sections. */
export function enablePlugin(text: string): string {
  const entry = `"${PLUGIN}"`;
  const header = /^\[editor_plugins\][ \t]*$/m.exec(text);
  if (!header) return `${text.replace(/\n*$/, "\n")}\n[editor_plugins]\n\nenabled=PackedStringArray(${entry})\n`;
  const start = header.index + header[0].length;
  const next = text.slice(start).search(/^\[/m);
  const end = next === -1 ? text.length : start + next;
  const section = text.slice(start, end);
  const enabled = /^[ \t]*enabled[ \t]*=[ \t]*PackedStringArray\((.*)\)[ \t]*$/m.exec(section);
  const assignments = [...section.matchAll(/^[ \t]*enabled[ \t]*=/gm)].length;
  if (assignments > 1 || (assignments === 1 && !enabled)) {
    throw new CliError("The editor_plugins enabled setting is duplicated or unsupported; open the project in Godot to normalize it before installing.");
  }
  if (!enabled) return `${text.slice(0, start)}\n\nenabled=PackedStringArray(${entry})${section.replace(/^\n*/, "\n\n")}${text.slice(end)}`;
  const items = [...enabled[1]!.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
  if (items.includes(PLUGIN)) return text;
  const line = `enabled=PackedStringArray(${[...items, PLUGIN].map((i) => `"${i}"`).join(", ")})`;
  return text.slice(0, start) + section.slice(0, enabled.index) + line + section.slice(enabled.index + enabled[0].length) + text.slice(end);
}

export interface InstallOptions {
  project: string;
  force?: boolean;
  skill?: boolean;
  enable?: boolean;
}

export function installAddon(opts: InstallOptions): { messages: string[]; project: string } {
  const given = resolve(opts.project);
  if (!existsSync(join(given, "project.godot"))) throw new CliError(`${given} is not a Godot project (no project.godot).`);
  const root = realpathSync(given);
  assertOutsidePackage(root);
  const assets = assetDirs();
  const want = addonVersion(assets.addon);
  if (!want) throw new CliError(`The bundled addon is missing (${assets.addon}); reinstall godot-mcp-loop.`);
  const messages: string[] = [];

  const target = inside(root, "addons", "mcp_loop");
  const sources = [assets.addon, ...(opts.skill ? [assets.skill] : [])];
  assertOutsidePackage(target, sources, true);
  if (opts.skill) assertOutsidePackage(inside(root, ".claude", "skills", "godot-mcp-loop"), sources, true);
  if (existsSync(target)) {
    const have = addonVersion(target);
    if (have === want && !opts.force) {
      messages.push(`The MCP Loop addon ${want} is already installed in ${target}.`);
    } else if (!opts.force) {
      throw new CliError(`MCP Loop addon ${have ?? "(unknown version)"} is installed in ${target}; run again with --force to replace it with ${want}.`);
    } else {
      rmSync(target, { recursive: true, force: true });
      cpSync(assets.addon, target, { recursive: true });
      messages.push(`Replaced the MCP Loop addon ${have ?? "(unknown version)"} with ${want} in ${target}.`);
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    cpSync(assets.addon, target, { recursive: true });
    messages.push(`Installed the MCP Loop addon ${want} in ${target}.`);
  }

  if (opts.enable !== false) {
    const file = inside(root, "project.godot");
    const before = readTextFileBounded(file, FILE_READ_LIMITS.text);
    const after = enablePlugin(before);
    if (after === before) {
      messages.push("The plugin is already enabled in project.godot.");
    } else {
      writeFileSync(file, after);
      messages.push("Enabled the plugin in project.godot. If the project is open in Godot, use Project > Reload Current Project.");
    }
  }

  if (opts.skill) {
    const dest = inside(root, ".claude", "skills", "godot-mcp-loop");
    if (existsSync(dest) && !opts.force) {
      messages.push(`The agent skill is already in ${dest} (use --force to replace it).`);
    } else {
      rmSync(dest, { recursive: true, force: true });
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(assets.skill, dest, { recursive: true });
      messages.push(`Added the agent skill to ${dest}.`);
    }
  }
  return { messages, project: root };
}

const shq = (s: string): string => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);

/** Runs a subcommand; returns the process exit code (2 = usage error, 1 = refused). */
export function runCli(argv: string[], log: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): number {
  const [cmd, ...rest] = argv;
  if (cmd === "sample") {
    const [name, dir] = rest;
    if (name === undefined || name === "--help" || name === "-h") {
      const available = listSamples();
      log(available.length > 0 ? `Samples:\n${available.map((s) => `  ${s}`).join("\n")}` : "No samples are bundled.");
      if (name === undefined) log("\nCopy one with: godot-mcp-loop sample <name> <dir>");
      return name === undefined ? 0 : 0;
    }
    if (dir === undefined) {
      log(`Copy a sample with: godot-mcp-loop sample ${name} <dir>\n\n${USAGE}`);
      return 2;
    }
    try {
      const r = copySample(name, dir);
      log(
        [
          `Copied ${r.name} (${r.files} files) to ${r.project}`,
          "",
          "Next:",
          `  cd ${shq(r.project)} && npx -y godot-mcp-loop@${SERVER_VERSION} install-addon . --skill`,
          `  godot -e --path ${shq(r.project)}`,
        ].join("\n"),
      );
      return 0;
    } catch (e) {
      if (e instanceof CliError) {
        log(`Error: ${e.message}`);
        return 1;
      }
      throw e;
    }
  }
  if (cmd !== "install-addon") {
    log(USAGE);
    return 2;
  }
  let project: string | undefined;
  const opts = { force: false, skill: false, enable: true };
  for (const a of rest) {
    if (a === "--force") opts.force = true;
    else if (a === "--skill") opts.skill = true;
    else if (a === "--no-enable") opts.enable = false;
    else if (a === "--help" || a === "-h") {
      log(USAGE);
      return 0;
    } else if (a.startsWith("-")) {
      log(`Unknown option: ${a}\n\n${USAGE}`);
      return 2;
    } else if (project === undefined) project = a;
    else {
      log(`Only one project folder.\n\n${USAGE}`);
      return 2;
    }
  }
  if (project === undefined) {
    log(USAGE);
    return 2;
  }
  try {
    const r = installAddon({ project, ...opts });
    for (const m of r.messages) log(m);
    const p = shq(r.project);
    log(
      [
        "",
        "Next: open the project in Godot 4 and connect your MCP client, e.g. Claude Code:",
        `  cd ${p} && claude mcp add godot-loop -- npx -y godot-mcp-loop@${SERVER_VERSION} --project ${p}`,
        `Other clients: command "npx", args ["-y", "godot-mcp-loop@${SERVER_VERSION}", "--project", "${r.project}"].`,
      ].join("\n"),
    );
    return 0;
  } catch (e) {
    if (e instanceof CliError) {
      log(`Error: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

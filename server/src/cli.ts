import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
  godot-mcp-loop install-addon <dir> [options]          copy the editor addon (same version) into a project
      --skill       also add the agent skill to <dir>/.claude/skills/godot-mcp-loop
      --force       replace an addon of another version (or an existing skill)
      --no-enable   do not edit project.godot (enable it in Project Settings > Plugins)
  godot-mcp-loop --version`;

/** In a checkout of the repository the addon and skill come from it; in the npm package from the bundled copies. */
export function assetDirs(): { addon: string; skill: string } {
  const repo = resolve(pkgRoot, "..");
  if (basename(pkgRoot) === "server" && existsSync(join(repo, "addons", "mcp_loop", "plugin.cfg"))) {
    return { addon: join(repo, "addons", "mcp_loop"), skill: join(repo, ".claude", "skills", "godot-mcp-loop") };
  }
  return { addon: join(pkgRoot, "addon", "mcp_loop"), skill: join(pkgRoot, "skill", "godot-mcp-loop") };
}

function addonVersion(dir: string): string | undefined {
  try {
    return /^version="([^"]*)"/m.exec(readFileSync(join(dir, "plugin.cfg"), "utf8"))?.[1];
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
      if (lstatSync(p).isSymbolicLink()) throw new CliError(`${p} is a symbolic link; refusing to write through it.`);
    } catch (e) {
      if (e instanceof CliError) throw e;
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
  const enabled = /^enabled=PackedStringArray\((.*)\)[ \t]*$/m.exec(section);
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
  const assets = assetDirs();
  const want = addonVersion(assets.addon);
  if (!want) throw new CliError(`The bundled addon is missing (${assets.addon}); reinstall godot-mcp-loop.`);
  const messages: string[] = [];

  const target = inside(root, "addons", "mcp_loop");
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
    const before = readFileSync(file, "utf8");
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

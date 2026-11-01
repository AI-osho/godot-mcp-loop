import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { BridgeError } from "./errors.js";

export interface ProjectPathOptions {
  write?: boolean;
  requireRes?: boolean;
  allowRoot?: boolean;
  protectedTop?: readonly string[];
}

/**
 * Shared boundary for files the server itself reads/writes (not the addon's separate PathGuard).
 * Resolve the chosen project root once, but never follow a link below it, including dangling links.
 * This is accident containment, not isolation from a same-user process racing these checks.
 */
export function projectFilePath(project: string, path: string, opts: ProjectPathOptions = {}): { abs: string; res: string } {
  if (opts.requireRes && !path.startsWith("res://")) {
    throw new BridgeError("INVALID_PARAMS", `Use a res:// path (got ${path}).`);
  }
  const rel = path.startsWith("res://") ? path.slice(6) : path;
  // Colons also reject Windows drive-relative paths and NTFS alternate data streams on every host.
  if (isAbsolute(rel) || /[\\:\u0000-\u001f\u007f\ufffd]/u.test(rel)) {
    throw new BridgeError("PATH_FORBIDDEN", "Path contains forbidden characters or is absolute.");
  }
  const parts = rel.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === ".." || /[. ]$/.test(p))) {
    throw new BridgeError("PATH_FORBIDDEN", "Parent segments and trailing dots/spaces are not allowed.");
  }
  const low = parts.map((p) => p.toLowerCase());
  if ((opts.protectedTop ?? [".git", ".godot"]).includes(low[0] ?? "") ||
      (opts.write && low[0] === "addons" && low[1] === "mcp_loop")) {
    throw new BridgeError("PATH_FORBIDDEN", "Access to a protected project folder is not allowed.");
  }
  if (parts.length === 0 && opts.allowRoot === false) {
    throw new BridgeError("PATH_FORBIDDEN", "Choose a file or folder inside the project, not its root.");
  }
  const root = realpathSync(project);
  // Filesystems recognize aliases (Unicode folds, short names) beyond JavaScript's lowercase mapping.
  // Compare the actual protected objects as well as their spellings, without resolving away a symlink below root.
  const protectedPaths = [...(opts.protectedTop ?? [".git", ".godot"])];
  if (opts.write) protectedPaths.push("addons/mcp_loop");
  const protectedIds: Array<{ dev: number; ino: number }> = [];
  for (const name of protectedPaths) {
    try { protectedIds.push(lstatSync(join(root, name))); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  const abs = resolve(root, ...parts);
  const r = relative(root, abs);
  if (r === ".." || r.startsWith(`..${sep}`) || isAbsolute(r)) {
    throw new BridgeError("PATH_FORBIDDEN", "Path resolves outside the project.");
  }
  let current = root;
  for (const [i, part] of parts.entries()) {
    current = join(current, part);
    let st;
    try { st = lstatSync(current); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") break;
      throw e;
    }
    if (st.isSymbolicLink() || (opts.write && st.isFile() && st.nlink > 1)) {
      throw new BridgeError("PATH_FORBIDDEN", `Symbolic links and write-through hard links are not allowed: ${current}.`);
    }
    if (protectedIds.some((p) => p.dev === st.dev && p.ino === st.ino)) {
      throw new BridgeError("PATH_FORBIDDEN", "Path is a filesystem alias of a protected project object.");
    }
    if (i < parts.length - 1 && !st.isDirectory()) {
      throw new BridgeError("PATH_FORBIDDEN", "A parent of this path is not a directory.");
    }
    if (!st.isDirectory() && !st.isFile()) {
      throw new BridgeError("PATH_FORBIDDEN", "Special files are not allowed.");
    }
  }
  return { abs, res: `res://${parts.join("/")}` };
}

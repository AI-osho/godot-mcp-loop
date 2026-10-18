// Copies the editor addon and the agent skill from the repository into the npm package (run by `npm pack` /
// `npm publish` through the prepack script). Only files tracked by git are copied when this is a git checkout.
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const server = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(server, "..");
const ASSETS = [
  ["addons/mcp_loop", "addon/mcp_loop"],
  [".claude/skills/godot-mcp-loop", "skill/godot-mcp-loop"],
];

for (const [from, to] of ASSETS) {
  const dest = join(server, to);
  rmSync(dest, { recursive: true, force: true });
  let files = [];
  try {
    files = execFileSync("git", ["-C", repo, "ls-files", "-z", "--", from], { encoding: "utf8" })
      .split("\0")
      .filter((f) => f !== "" && existsSync(join(repo, f)));
  } catch {
    files = [];
  }
  if (files.length === 0) {
    cpSync(join(repo, from), dest, { recursive: true });
  } else {
    for (const f of files) {
      const out = join(dest, relative(from, f));
      mkdirSync(dirname(out), { recursive: true });
      copyFileSync(join(repo, f), out);
    }
  }
  console.log(`bundled ${from} -> server/${to} (${files.length || "all"} files)`);
}

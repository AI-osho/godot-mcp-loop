#!/usr/bin/env node
// Generates examples/marble (the in-repo copy CI runs) from samples/marble-3d (the standalone project users get).
// Only the paths differ: the sample addresses its own files as res://x, the in-repo copy as res://examples/marble/x.
// Run with --check to verify the copy is up to date (CI and the test suite do this).
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(repo, "samples", "marble-3d");
const TARGET = join(repo, "examples", "marble");
const PREFIX = "res://examples/marble/";

/** The sample's own res:// paths, moved under res://examples/marble/ for the in-repo copy. */
export function rewrite(text) {
  return text
    .replace(/res:\/\/scripts\//g, `${PREFIX}scripts/`)
    .replace(/res:\/\/(main|ball|coin|goal|platform|checkpoint)\.tscn/g, `${PREFIX}$1.tscn`);
}

function files(dir = SOURCE) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.(tscn|gd|yaml|yml)$/.test(name) && !/^project\.godot$/.test(name)) out.push(full);
  }
  return out;
}

function expected() {
  const out = new Map();
  for (const src of files()) {
    const rel = relative(SOURCE, src);
    const text = readFileSync(src, "utf8");
    const body = /\.(tscn|ya?ml)$/.test(rel) ? rewrite(text) : text;
    out.set(rel, body);
  }
  return out;
}

const check = process.argv.includes("--check");
const want = expected();
let changed = 0;
for (const [rel, body] of want) {
  const dest = join(TARGET, rel);
  const current = (() => {
    try {
      return readFileSync(dest, "utf8");
    } catch {
      return null;
    }
  })();
  if (current === body) continue;
  changed++;
  if (check) console.log(`out of date: examples/marble/${rel}`);
  else {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, body);
    console.log(`wrote examples/marble/${rel}`);
  }
}

// Files that exist in the copy but not in the sample (removed upstream) are reported, never deleted silently.
for (const rel of files(TARGET)) {
  if (!want.has(relative(TARGET, rel))) {
    console.log(`not in the sample any more: examples/marble/${relative(TARGET, rel)}`);
    changed++;
  }
}

if (check && changed > 0) {
  console.error(`examples/marble is out of date (${changed} file(s)). Run: node scripts/sync-marble-example.mjs`);
  process.exit(1);
}
if (!check) console.log(changed === 0 ? "examples/marble is up to date" : `updated ${changed} file(s)`);

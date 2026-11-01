import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("routes every project-controlled Node file read through the bounded I/O boundary", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../src");
  const violations: string[] = [];
  function visit(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(".ts")) {
        const name = relative(root, path);
        // The installed server's own package metadata is trusted code, not a selected project's input.
        if (name === "version.ts") continue;
        if (/\breadFileSync\s*\(/.test(readFileSync(path, "utf8"))) violations.push(name);
      }
    }
  }
  visit(root);
  expect(violations).toEqual([]);
});

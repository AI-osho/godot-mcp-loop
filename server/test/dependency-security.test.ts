import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Keep the verified fixes in the lockfile even when an unrelated dependency update re-resolves the tree.
it.each([
  ["body-parser", [2, 4, 0], "GHSA-27r3-jxmh-p828"],
  ["fast-uri", [3, 1, 9], "GHSA-w74x-v6f9-j3xg"],
] as const)("locks every %s copy at or above the reviewed advisory fix", (name, minimum, advisory) => {
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8")) as {
    packages: Record<string, { version?: string }>;
  };
  const copies = Object.entries(lock.packages).filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`));
  expect(copies.length, `The audited ${name} dependency must not silently disappear from this check.`).toBeGreaterThan(0);
  for (const [path, pkg] of copies) {
    expect(pkg.version, `${path}: ${advisory}`).toMatch(/^\d+\.\d+\.\d+$/);
    const actual = pkg.version!.split(".").map(Number);
    // A new major needs its own advisory review; a numerically larger version is not automatically unaffected.
    expect(actual[0], `${path}: review the new release line before changing this policy.`).toBe(minimum[0]);
    const firstDifference = minimum.findIndex((part, i) => actual[i] !== part);
    expect(firstDifference < 0 || actual[firstDifference]! > minimum[firstDifference]!, `${path}@${pkg.version}: ${advisory}`).toBe(true);
  }
});

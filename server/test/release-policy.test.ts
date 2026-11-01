import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("pins the staged-publishing npm CLI to an exact reviewed version", () => {
  const workflow = readFileSync(fileURLToPath(new URL("../../.github/workflows/release.yml", import.meta.url)), "utf8");
  expect(workflow).not.toMatch(/npm@latest\b/);
  expect(workflow).toMatch(/npm install -g npm@\d+\.\d+\.\d+(?:\s|&)/);
});

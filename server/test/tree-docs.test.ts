import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createTreeInputSchema, parseTreeRequest } from "../src/scene-tree-schema.js";
import { loadTreePolicy } from "../src/tree-policy.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const examples = [
  ".claude/skills/godot-mcp-loop/SKILL.md",
  "docs/scene-tree-build.md",
  "docs/scene-tree-build.ja.md",
];

describe("subtree documentation examples", () => {
  it("provides schema-valid typed examples in the shipped skill and both guides", () => {
    const policy = loadTreePolicy();
    const schema = createTreeInputSchema(policy);
    for (const relative of examples) {
      const text = readFileSync(resolve(root, relative), "utf8");
      const blocks = [...text.matchAll(/```json tool=node_add_tree\n([\s\S]*?)```/g)];
      expect(blocks.length, `${relative}: missing typed example`).toBeGreaterThan(0);
      for (const match of blocks) {
        const input = JSON.parse(match[1]!);
        const checked = schema.parse(input);
        const plan = parseTreeRequest(checked, policy);
        expect(plan.nodes.length).toBeGreaterThan(0);
        expect(plan.dry_run).toBe(true);
      }
    }
  });
});

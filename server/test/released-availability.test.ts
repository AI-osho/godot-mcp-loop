import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(resolve(repo, path), "utf8");
const introduced = "0.12.0";
const pages = [
  "README.md", "README.ja.md", "server/README.md", "docs/clients.md", "docs/tools.md",
  ...["architecture", "getting-started", "samples", "sample-upgrades", "scene-tree-build", "art-production"].flatMap((name) => [`docs/${name}.md`, `docs/${name}.ja.md`]),
  ".claude/skills/godot-mcp-loop/SKILL.md",
];

describe("released tool and sample availability", () => {
  it.each(pages)("%s identifies the release instead of an unpublished feature collection", (path) => {
    const text = read(path);
    expect(text, path).toContain(introduced);
    expect(text, path).not.toMatch(/unreleased source|unreleased development|unpublished development addition|unpublished addition|unreleased `?node_add_tree|development-only `?node_add_tree|未公開開発ソース|未公開のソース版|未公開node_add_tree|未公開の開発機能/);
  });

  it("uses the same precise description for the addon and npm package without an unconditional safety claim", () => {
    const description = /^description="([^"]+)"$/m.exec(read("addons/mcp_loop/plugin.cfg"))?.[1];
    expect(description).toBe(JSON.parse(read("server/package.json")).description);
  });
});

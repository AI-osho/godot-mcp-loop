import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(resolve(repo, path), "utf8");
const description = "Edit, run, inspect and test Godot 4 projects through MCP.";

describe("repository descriptions", () => {
  it.each(["server/package.json", "server.json", ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json"])("%s describes actual capabilities without an unqualified safety guarantee", (path) => {
    const metadata = JSON.parse(read(path));
    const value = path.endsWith("marketplace.json") ? metadata.plugins[0].description : metadata.description;
    expect(value).toBe(description);
    expect(value.length).toBeLessThanOrEqual(100);
  });

  it("the npm README does not replace same-install guidance with a version-label registry fallback", () => {
    const text = read("server/README.md");
    expect(text).toContain("same selected distribution");
    expect(text).toContain("actual server executable");
    expect(text).toContain("Version labels alone");
    expect(text).not.toContain("godot-mcp-loop@<version>");
    expect(text).not.toContain("seven-sample collection");
  });
});

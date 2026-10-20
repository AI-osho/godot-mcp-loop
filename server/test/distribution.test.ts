import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The MCP Registry only accepts a server.json whose name matches the package's `mcpName` and whose version matches
 * the published package. Keeping them in one file makes a stale manifest a test failure instead of a rejected upload.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string): string => readFileSync(join(repo, rel), "utf8");

describe("distribution manifests", () => {
  const pkg = JSON.parse(read("server/package.json")) as { version: string; mcpName?: string };
  const server = JSON.parse(read("server.json")) as {
    name: string;
    description?: string;
    version: string;
    packages: Array<{ registryType: string; identifier: string; version: string }>;
  };

  it("uses the package's mcpName as the registry name", () => {
    expect(pkg.mcpName).toBe("io.github.AI-osho/godot-mcp-loop");
    expect(server.name).toBe(pkg.mcpName);
  });

  it("keeps the description short enough for the registry", () => {
    expect((server as { description?: string }).description!.length).toBeLessThanOrEqual(100);
  });

  it("names the version the package will be published with", () => {
    expect(server.version).toBe(pkg.version);
    expect(server.packages[0]?.version).toBe(pkg.version);
    expect(server.packages[0]?.registryType).toBe("npm");
    expect(server.packages[0]?.identifier).toBe("godot-mcp-loop");
  });
});

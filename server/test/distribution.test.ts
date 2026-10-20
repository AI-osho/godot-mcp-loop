import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The MCP Registry only accepts a server.json whose name matches the package's `mcpName` and whose version matches
 * the published package. Keeping them in one file makes a stale manifest a test failure instead of a rejected upload.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string): string => readFileSync(join(repo, rel), "utf8");


describe("Claude Code plugin manifests", () => {
  const pkg = JSON.parse(read("server/package.json")) as { name?: string; version: string };
  const plugin = JSON.parse(read(".claude-plugin/plugin.json")) as {
    name: string;
    version: string;
    skills?: string[];
    mcpServers?: Record<string, { command: string; args: string[] }>;
    userConfig?: Record<string, unknown>;
  };
  const marketplace = JSON.parse(read(".claude-plugin/marketplace.json")) as {
    name: string;
    plugins: Array<{ name: string; source: string }>;
  };

  it("ships the same version and name as the package", () => {
    expect(plugin.name).toBe(pkg.name ?? "godot-mcp-loop");
    expect(plugin.version).toBe(pkg.version);
    expect(marketplace.plugins.map((p) => p.name)).toContain(plugin.name);
    expect(marketplace.plugins.find((p) => p.name === plugin.name)?.source).toBe("./");
  });

  it("pins the MCP server to this plugin's version instead of @latest", () => {
    for (const server of Object.values(plugin.mcpServers ?? {})) {
      const pkg = server.args.find((a) => a.startsWith("godot-mcp-loop@"));
      expect(pkg, "the server launches the package by name").toBeDefined();
      // A user who installed 0.9.x should keep running 0.9.x: @latest would make every editor session execute
      // whatever npm published most recently, including a bad or compromised release.
      expect(pkg).toBe(`godot-mcp-loop@${plugin.version}`);
    }
  });

  it("only references userConfig options it declares", () => {
    const declared = new Set(Object.keys(plugin.userConfig ?? {}));
    for (const server of Object.values(plugin.mcpServers ?? {})) {
      for (const arg of server.args) {
        for (const m of arg.matchAll(/\$\{user_config\.([A-Za-z0-9_]+)\}/g)) {
          expect(declared.has(m[1]!), m[1]).toBe(true);
        }
      }
    }
  });

  it("points the skill at a folder that exists", () => {
    for (const dir of plugin.skills ?? []) {
      expect(existsSync(join(repo, dir)), dir).toBe(true);
    }
  });
});

describe("distribution manifests", () => {
  const pkg = JSON.parse(read("server/package.json")) as { name?: string; version: string; mcpName?: string };
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

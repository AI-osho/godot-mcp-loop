import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GodotConnection } from "../src/connection.js";
import { parseScenario } from "../src/scenario/schema.js";
import { FILE_TOOLS } from "../src/tools/files.js";
import { connectClient } from "./helpers.js";

/**
 * The agent skill in .claude/skills teaches other agents how to use the tools, so its examples must stay valid:
 * every YAML block is parsed as a scenario, every JSON block as image_write arguments, and every link must resolve.
 */
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const skillDir = join(repo, ".claude", "skills", "godot-mcp-loop");

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? markdownFiles(p) : name.endsWith(".md") ? [p] : [];
  });
}

function blocks(text: string, lang: string): string[] {
  const re = new RegExp("```" + lang + "\\n([\\s\\S]*?)```", "g");
  return [...text.matchAll(re)].map((m) => m[1]!);
}

const files = markdownFiles(skillDir);

describe("agent skill (.claude/skills/godot-mcp-loop)", () => {
  it("has spec-compliant frontmatter", () => {
    const text = readFileSync(join(skillDir, "SKILL.md"), "utf8");
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    expect(fm, "frontmatter").not.toBeNull();
    const meta = parseYaml(fm![1]!) as { name: string; description: string };
    expect(meta.name).toBe("godot-mcp-loop"); // must match the folder name
    expect(meta.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(meta.description.length).toBeGreaterThan(20);
    expect(meta.description.length).toBeLessThanOrEqual(1024);
    expect(text.split("\n").length).toBeLessThan(500); // keep the always-read part short
  });

  it("every YAML example is a valid scenario", () => {
    const examples = files.flatMap((f) => blocks(readFileSync(f, "utf8"), "yaml").map((y) => ({ f, y })));
    expect(examples.length).toBeGreaterThanOrEqual(10);
    for (const { f, y } of examples) {
      expect(() => parseScenario(y), `${f}:\n${y}`).not.toThrow();
    }
  });

  it("every JSON example is valid image_write input", () => {
    const tool = FILE_TOOLS.find((t) => t.name === "image_write")!;
    const schema = z.object(tool.input).strict();
    const examples = files.flatMap((f) => blocks(readFileSync(f, "utf8"), "json"));
    expect(examples.length).toBeGreaterThanOrEqual(2);
    for (const json of examples) {
      const parsed = schema.safeParse(JSON.parse(json));
      expect(parsed.success, `${json}\n${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  it("every relative link resolves", () => {
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/\]\(([^)#\s]+)\)/g)) {
        const target = m[1]!;
        if (/^[a-z]+:/.test(target)) continue;
        expect(existsSync(resolve(dirname(f), target)), `${f} -> ${target}`).toBe(true);
      }
    }
  });

  it("mentions only tools the server provides", async () => {
    const conn = new GodotConnection({ projectPath: "/unused" });
    const client = await connectClient(conn);
    const known = new Set((await client.listTools()).tools.map((t) => t.name));
    await client.close();
    const text = files.map((f) => readFileSync(f, "utf8")).join("\n");
    const mentioned = new Set([...text.matchAll(/`((?:game|scene|node|script|file|image|input|project|godot|edit|logs|scenario|test|editor)_[a-z_]+)/g)].map((m) => m[1]!));
    for (const name of mentioned) expect(known.has(name), `unknown tool ${name}`).toBe(true);
  });
});

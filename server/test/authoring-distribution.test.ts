import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { GodotConnection } from "../src/connection.js";
import { connectClient } from "./helpers.js";
const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");
describe("artwork runtime distribution", () => {
  it("keeps English and Japanese headline counts equal to the actual MCP inventory", async () => {
    const conn = new GodotConnection({ projectPath: "/unused" }); const client = await connectClient(conn);
    try {
      const count = (await client.listTools()).tools.length;
      expect(Number(/0\.12\.0の(\d+)ツール/.exec(read("../../README.ja.md"))?.[1])).toBe(count);
      expect(Number(/All (\d+) tools in 0\.12\.0/.exec(read("../../README.md"))?.[1])).toBe(count);
      expect(Number(/(\d+) tools,/.exec(read("../../docs/tools.md"))?.[1])).toBe(count);
    } finally { await client.close(); conn.close(); }
  });
  it("documents all seven artwork tools at each user and agent entrypoint", () => {
    const names = ["production_plan", "art_request", "art_register", "asset_build", "asset_preview", "asset_verify", "asset_scene_add"];
    for (const path of ["../../README.md", "../../README.ja.md", "../README.md", "../../docs/tools.md", "../../.claude/skills/godot-mcp-loop/SKILL.md"]) {
      const text = read(path);
      for (const name of names) expect(text, `${path}: ${name}`).toContain("`" + name + "`");
    }
  });
  it("ships the fixed Python worker alongside the compiled server", () => {
    const pkg = JSON.parse(read("../package.json"));
    expect(pkg.files).toContain("authoring");
    expect(read("../authoring/worker.py")).toContain("def main():");
    expect(read("../authoring/requirements.txt")).toBe("Pillow==13.0.0\n");
  });
  it("keeps source attribution without shipping the developer's absolute home paths", () => {
    const origin = JSON.parse(read("../authoring/ORIGIN.json"));
    for (const entry of Object.values(origin.files) as Array<{ source: string; sha256: string }>) {
      expect(entry.source).not.toMatch(/^\//); expect(entry.source).not.toContain("/Users/");
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });
  it("installs the optional artwork dependency in every CI job that exercises it", () => {
    const ci = parse(read("../../.github/workflows/ci.yml"));
    const release = parse(read("../../.github/workflows/release.yml"));
    for (const job of [ci.jobs.server, ci.jobs.godot, release.jobs.build]) {
      expect(job.steps.some((s: any) => typeof s.uses === "string" && /^actions\/setup-python@[a-f0-9]{40}$/.test(s.uses))).toBe(true);
      expect(job.steps.some((s: any) => typeof s.run === "string" && s.run.includes("pip install --requirement authoring/requirements.txt"))).toBe(true);
    }
  });
});

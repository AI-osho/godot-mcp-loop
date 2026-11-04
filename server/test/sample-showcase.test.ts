import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listSamples } from "../src/cli.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");
const games = ["blocks", "shooter", "action", "rpg", "marble-3d", "tower-defense"];

describe("curated sample showcase", () => {
  it("shows the six selected games while retaining the minimal internal compatibility fixture", () => {
    const provenance = JSON.parse(read("docs/images/samples-current-provenance.json"));
    expect(provenance.samples.map((item: { sample: string }) => item.sample)).toEqual(games);
    expect(provenance.excluded_from_showcase).toEqual(["platformer"]);
    expect(provenance.gallery).toMatchObject({ columns: 3, rows: 2, tiles: 6 });
    for (const item of provenance.samples) {
      const image = readFileSync(join(repo, "docs/images", item.file));
      expect(createHash("sha256").update(image).digest("hex"), item.sample).toBe(item.sha256);
    }
    expect(listSamples()).toEqual([...games, "platformer"].sort());
    expect(existsSync(join(repo, "examples/platformer/main.tscn"))).toBe(true);
    expect(read("project.godot")).toContain('run/main_scene="res://examples/platformer/main.tscn"');
  });

  it.each(["README.md", "README.ja.md", "docs/samples.md", "docs/samples.ja.md", "examples/README.md"])("%s presents the same six games without a highlighted Marble introduction", (path) => {
    const text = read(path);
    const section = /<!-- sample-showcase:start -->\n([\s\S]*?)<!-- sample-showcase:end -->/.exec(text)?.[1];
    expect(section, `${path}: curated table`).toBeDefined();
    const ids = [...(section ?? "").matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((match) => match[1]);
    expect(ids).toEqual(games);
    expect(section).not.toContain("platformer");
    expect(text).not.toMatch(/published 3D sample|公開版の3Dサンプル|## Platformer|### Platformer/);
    if (path.startsWith("README")) expect(text).not.toContain("sample marble-3d");
  });

  it.each(["", ".ja"])("the %s sample guide uses the same six fields for every game", (locale) => {
    const text = read(`docs/samples${locale}.md`);
    const headings = [...text.matchAll(/^## .+ \(`([a-z0-9-]+)`\)$/gm)];
    expect(headings.map((match) => match[1])).toEqual(games);
    const fields = locale ? ["目的", "操作", "再挑戦", "確かめること", "試験", "プロジェクト"] : ["Goal", "Controls", "Retry", "Observe", "Checks", "Project"];
    for (const heading of headings) {
      const start = heading.index! + heading[0].length;
      const end = text.indexOf("\n## ", start);
      const body = text.slice(start, end === -1 ? undefined : end);
      for (const field of fields) expect(body, `${heading[1]}: ${field}`).toContain(`- **${field}:**`);
    }
  });
});

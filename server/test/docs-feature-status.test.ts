import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string): string => readFileSync(join(repo, path), "utf8");

describe("documentation feature availability", () => {
  it.each(["README.md", "README.ja.md", "server/README.md", "docs/tools.md", "docs/art-production.md", "docs/art-production.ja.md"])("%s treats artwork production as released since 0.10.0", (path) => {
    const text = read(path);
    expect(text).not.toMatch(/Artwork production \(development(?:-source addition)?\)|原画・素材制作（開発版）|Development-source addition:|Development-source functionality;|この機能は開発中ソースへの追加|開発中ソースに、制作方針/);
    expect(text).toContain("0.10.0");
  });

  it.each(["", ".ja"])("the %s README routes readers to task-based documentation", (locale) => {
    const text = read(`README${locale}.md`);
    for (const topic of ["getting-started", "architecture", "samples", "sample-upgrades"]) {
      expect(text).toContain(`docs/${topic}${locale}.md`);
    }
    expect(text).not.toContain("res://scenarios/coins.yaml");
    expect(text.match(locale === ".ja" ? /\*\*npm で入れる場合/g : /\*\*With npm/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(text).toContain("48");
    expect(text).toContain("49");
  });

  it.each(["README.md", "README.ja.md", ...["architecture", "getting-started", "samples", "sample-upgrades"].flatMap((topic) => [`docs/${topic}.md`, `docs/${topic}.ja.md`])])("%s has real local link targets and no private machine paths", (path) => {
    const text = read(path);
    expect(text).not.toMatch(/\/(?:Users|home)\/[^/\s)]+\//);
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const link = match[1]!.split("#")[0]!;
      if (!link || /^[a-z][a-z0-9+.-]*:/i.test(link)) continue;
      expect(existsSync(resolve(repo, dirname(path), decodeURIComponent(link))), `${path}: ${link}`).toBe(true);
    }
  });
});

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GodotConnection } from "../src/connection.js";
import { connectClient } from "./helpers.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string): string => readFileSync(join(repo, rel), "utf8");

describe("documentation lists every tool", () => {
  it.each(["docs/tools.md", "README.md", "README.ja.md", "server/README.md"])("%s", async (file) => {
    const conn = new GodotConnection({ projectPath: "/unused" });
    const client = await connectClient(conn);
    const names = (await client.listTools()).tools.map((t) => t.name);
    await client.close();
    const text = read(file);
    const missing = names.filter((n) => !text.includes(`\`${n}\``));
    expect(missing).toEqual([]);
    if (file === "docs/tools.md") expect(text).toContain(`${names.length} tools,`);
  });
});

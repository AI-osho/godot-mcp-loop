import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Guards the #26 fix for every tool, not just the ones that go through registerForwardTool. */
const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

describe("every tool rejects undeclared arguments", () => {
  let client: Client;

  beforeAll(async () => {
    const project = mkdtempSync(join(tmpdir(), "gml-strict-"));
    const transport = new StdioClientTransport({ command: process.execPath, args: [DIST, "--project", project] });
    client = new Client({ name: "strictness", version: "1" }, { capabilities: {} });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
  });

  it("no tool silently drops an unknown key", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(30);
    const accepted: string[] = [];
    for (const tool of tools) {
      const res = await client
        .callTool({ name: tool.name, arguments: { __undeclared__: 1 } })
        .catch((e: unknown) => ({ content: [{ type: "text", text: String(e) }] }));
      const text = ((res as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join(" ");
      if (!/unrecognized key|invalid arguments|invalid_type/i.test(text)) accepted.push(`${tool.name}: ${text.slice(0, 100)}`);
    }
    expect(accepted).toEqual([]);
  }, 120_000);
});

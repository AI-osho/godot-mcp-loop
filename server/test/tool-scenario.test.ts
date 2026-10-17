import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GodotConnection } from "../src/connection.js";
import { FakeAddon } from "./fake-addon.js";
import { connectClient, textOf } from "./helpers.js";

describe("scenario_run tool", () => {
  let addon: FakeAddon;
  let conn: GodotConnection;
  let client: Client;
  let project: string;

  beforeEach(async () => {
    project = mkdtempSync(join(tmpdir(), "gml-scn-"));
    addon = new FakeAddon();
    const port = await addon.start();
    for (const [m, r] of Object.entries({
      "game.run": { running: true },
      "game.stop": { stopped: true },
      "logs.read": { entries: [], next: 1 },
      "game.wait_for": { met: true, value: 1 },
      screenshot: { png_base64: "QUJD", width: 4, height: 4, target: "game" },
    })) {
      addon.handlers.set(m, () => ({ ok: true, result: r }));
    }
    conn = new GodotConnection({
      projectPath: project,
      readSession: () => ({ port, token: addon.token, protocol: 1, pid: process.pid }),
    });
    client = await connectClient(conn);
  });

  afterEach(async () => {
    await client.close();
    conn.close();
    await addon.stop();
    rmSync(project, { recursive: true, force: true });
  });

  function write(rel: string, text: string): void {
    mkdirSync(join(project, rel, ".."), { recursive: true });
    writeFileSync(join(project, rel), text);
  }

  it("runs a scenario file by res:// path and summarises the result", async () => {
    write("tests/move.yaml", "name: move\nsteps:\n  - assert: { node: Player, property: x, op: '>', value: 0 }\n  - screenshot: end\n");
    const res = await client.callTool({ name: "scenario_run", arguments: { path: "res://tests/move.yaml" } });
    expect(res.isError).toBeFalsy();
    const content = res.content as Array<{ type: string; text?: string; data?: string }>;
    expect(content[0]!.text).toMatch(/Scenario "move": PASSED/);
    expect(content.some((c) => c.type === "image" && c.data === "QUJD")).toBe(true);
    const json = JSON.parse(content[1]!.text!);
    expect(json.passed).toBe(true);
    expect(JSON.stringify(json)).not.toContain("QUJD"); // images are not duplicated in JSON
  });

  it("accepts an inline scenario object", async () => {
    const res = await client.callTool({
      name: "scenario_run",
      arguments: { scenario: { name: "inline", steps: [{ wait_ms: 1 }] }, include_screenshots: false },
    });
    expect(textOf(res)).toMatch(/Scenario "inline": PASSED/);
  });

  it("reports failures without marking the tool call as an error", async () => {
    addon.handlers.set("game.wait_for", () => ({ ok: false, error: { code: "TIMEOUT", message: "Last value: 3" } }));
    const res = await client.callTool({
      name: "scenario_run",
      arguments: { scenario: "name: f\nsteps:\n  - assert: { node: P, property: x, op: '>', value: 9 }\n" },
    });
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toMatch(/FAILED/);
    expect(textOf(res)).toContain("Last value: 3");
  });

  it("refuses paths outside the project", async () => {
    const res = await client.callTool({ name: "scenario_run", arguments: { path: "../../etc/passwd" } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("PATH_FORBIDDEN");
  });

  it("requires exactly one of path or scenario", async () => {
    const res = await client.callTool({ name: "scenario_run", arguments: {} });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("INVALID_PARAMS");
  });

  it("returns validation errors for a malformed scenario", async () => {
    const res = await client.callTool({ name: "scenario_run", arguments: { scenario: { name: "x", steps: [{ fly: 1 }] } } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("Invalid scenario");
  });
});

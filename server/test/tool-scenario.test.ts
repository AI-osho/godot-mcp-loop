import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
    const res = await client.callTool({ name: "scenario_run", arguments: { path: "res://tests/move.yaml", report: "full" } });
    expect(res.isError).toBeFalsy();
    const content = res.content as Array<{ type: string; text?: string; data?: string }>;
    expect(content[0]!.text).toMatch(/Scenario "move": PASSED/);
    expect(content[0]!.text).toMatch(/1\. assert Player\.x > 0 .*→ 1/); // condition and observed value
    expect(content.some((c) => c.type === "image" && c.data === "QUJD")).toBe(true);
    const json = JSON.parse(content[1]!.text!);
    expect(json.passed).toBe(true);
    expect(JSON.stringify(json)).not.toContain("QUJD"); // images are not duplicated in JSON
  });

  it("returns only the summary (and images) by default; the JSON report needs report: full", async () => {
    write("tests/move.yaml", "name: move\nsteps:\n  - assert: { node: Player, property: x, op: '>', value: 0 }\n  - screenshot: end\n");
    const res = await client.callTool({ name: "scenario_run", arguments: { path: "res://tests/move.yaml" } });
    const content = res.content as Array<{ type: string; text?: string }>;
    const texts = content.filter((c) => c.type === "text");
    expect(texts).toHaveLength(1);
    expect(texts[0]!.text).toMatch(/PASSED/);
    expect(content.some((c) => c.type === "image")).toBe(true);
  });

  it("the summary lists the game's first errors", async () => {
    addon.handlers.set("logs.read", (p) =>
      p.min_level === "error"
        ? { ok: true, result: { entries: [{ level: "error", message: "boom at line 3" }], next: 1 } }
        : { ok: true, result: { entries: [], next: 1 } },
    );
    const res = await client.callTool({ name: "scenario_run", arguments: { scenario: { name: "e", steps: [{ wait_ms: 1 }] } } });
    expect(textOf(res)).toContain("boom at line 3");
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

  it("refuses a symlink inside the project that points outside", async () => {
    const outside = mkdtempSync(join(tmpdir(), "gml-outside-"));
    writeFileSync(join(outside, "s.yaml"), "name: x\nsteps:\n  - wait_ms: 1\n");
    symlinkSync(outside, join(project, "linked"));
    const res = await client.callTool({ name: "scenario_run", arguments: { path: "res://linked/s.yaml" } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("PATH_FORBIDDEN");
    rmSync(outside, { recursive: true, force: true });
  });

  it("refuses .godot/ and .git/ like the addon does (the session token lives in .godot/)", async () => {
    mkdirSync(join(project, ".godot", "mcp_loop"), { recursive: true });
    writeFileSync(join(project, ".godot", "mcp_loop", "session.json"), '{"port": 1, "token": "secret-token-value", "pid": 1}');
    mkdirSync(join(project, ".git"), { recursive: true });
    writeFileSync(join(project, ".git", "config"), "[core]\n");
    for (const path of ["res://.godot/mcp_loop/session.json", ".godot/mcp_loop/session.json", "res://./.godot/mcp_loop/session.json", "res://.git/config"]) {
      const res = await client.callTool({ name: "scenario_run", arguments: { path } });
      expect(res.isError).toBe(true);
      expect(textOf(res)).toContain("PATH_FORBIDDEN");
      expect(textOf(res)).not.toContain("secret-token-value");
    }
  });

  describe("folders and lists (#8)", () => {
    beforeEach(() => {
      addon.handlers.set("game.wait_for", (p) =>
        (p as { property?: string }).property === "bad"
          ? { ok: false, error: { code: "TIMEOUT", message: "Last value: 3" } }
          : { ok: true, result: { met: true, value: 1 } },
      );
      const ok = (n: string) => `name: ${n}\nsteps:\n  - assert: { node: P, property: x, op: '>', value: 0 }\n  - screenshot: end_${n}\n`;
      write("tests/s/2_b.yaml", ok("b"));
      write("tests/s/1_a.yaml", ok("a"));
      write("tests/s/3_bad.yml", "name: bad\nsteps:\n  - assert: { node: P, property: bad, op: '>', value: 9 }\n");
      write("tests/s/notes.txt", "not a scenario");
    });

    it("runs every scenario in a folder in name order and summarises", async () => {
      const res = await client.callTool({ name: "scenario_run", arguments: { path: "res://tests/s" } });
      expect(res.isError).toBeFalsy();
      const text = textOf(res);
      expect(text.split("\n")[0]).toMatch(/^Scenarios: 2\/3 passed/);
      expect(text.indexOf("1_a.yaml")).toBeLessThan(text.indexOf("2_b.yaml"));
      expect(text.indexOf("2_b.yaml")).toBeLessThan(text.indexOf("3_bad.yml"));
      expect(text).not.toContain("notes.txt");
      expect(text).toContain("Last value: 3"); // details of the failure
      // Only the failure screenshot is attached in a batch by default.
      const images = (res.content as Array<{ type: string }>).filter((c) => c.type === "image");
      expect(images).toHaveLength(1);
    });

    it("stop_on_failure leaves the rest unrun; paths keeps the given order", async () => {
      write("tests/s/0_bad.yaml", "name: first\nsteps:\n  - assert: { node: P, property: bad, op: '>', value: 9 }\n");
      const stopped = textOf(await client.callTool({ name: "scenario_run", arguments: { path: "tests/s", stop_on_failure: true } }));
      expect(stopped.split("\n")[0]).toMatch(/^Scenarios: 0\/4 passed/);
      expect(stopped).toMatch(/1_a\.yaml.*not run/);
      const listed = textOf(await client.callTool({ name: "scenario_run", arguments: { paths: ["res://tests/s/2_b.yaml", "res://tests/s/1_a.yaml"] } }));
      expect(listed.split("\n")[0]).toMatch(/^Scenarios: 2\/2 passed/);
      expect(listed.indexOf("2_b.yaml")).toBeLessThan(listed.indexOf("1_a.yaml"));
    });

    it("reports a broken or forbidden file inside the batch and keeps going", async () => {
      write("tests/s/4_broken.yaml", "name: broken\nsteps:\n  - fly: 1\n");
      const outside = mkdtempSync(join(tmpdir(), "gml-outside-"));
      writeFileSync(join(outside, "x.yaml"), "name: x\nsteps:\n  - wait_ms: 1\n");
      symlinkSync(join(outside, "x.yaml"), join(project, "tests", "s", "5_link.yaml"));
      const res = await client.callTool({ name: "scenario_run", arguments: { path: "res://tests/s" } });
      expect(res.isError).toBeFalsy();
      const text = textOf(res);
      expect(text.split("\n")[0]).toMatch(/^Scenarios: 2\/5 passed/);
      expect(text).toMatch(/4_broken\.yaml.*Invalid scenario/);
      expect(text).toMatch(/5_link\.yaml.*PATH_FORBIDDEN/);
      rmSync(outside, { recursive: true, force: true });
    });

    it("reports progress per scenario so clients can keep long batches alive", async () => {
      const seen: Array<{ progress: number; total?: number; message?: string }> = [];
      await client.callTool({ name: "scenario_run", arguments: { path: "res://tests/s" } }, undefined, {
        onprogress: (p) => seen.push(p),
      });
      expect(seen.map((p) => p.progress)).toEqual([0, 1, 2, 3]);
      expect(seen.every((p) => p.total === 3)).toBe(true);
      expect(seen[1]!.message).toMatch(/1_a\.yaml.*passed/);
      expect(seen[3]!.message).toMatch(/3_bad\.yml.*failed/);
    });

    it("refuses protected folders, empty folders, and mixed arguments", async () => {
      mkdirSync(join(project, ".godot"), { recursive: true });
      writeFileSync(join(project, ".godot", "s.yaml"), "name: x\nsteps:\n  - wait_ms: 1\n");
      for (const args of [{ path: "res://.godot" }, { paths: ["res://.godot/s.yaml"] }]) {
        const res = await client.callTool({ name: "scenario_run", arguments: args });
        expect(textOf(res)).toContain("PATH_FORBIDDEN");
      }
      mkdirSync(join(project, "empty"));
      const empty = await client.callTool({ name: "scenario_run", arguments: { path: "res://empty" } });
      expect(empty.isError).toBe(true);
      expect(textOf(empty)).toContain("No scenario files");
      const both = await client.callTool({ name: "scenario_run", arguments: { path: "res://tests/s", paths: ["res://tests/s/1_a.yaml"] } });
      expect(both.isError).toBe(true);
    });
  });

  describe("save_to: evidence on disk (#13)", () => {
    it("saves the screenshots and a report for one scenario and says where", async () => {
      write("tests/move.yaml", "name: move\nsteps:\n  - screenshot: start\n  - screenshot: end\n");
      const res = await client.callTool({ name: "scenario_run", arguments: { path: "res://tests/move.yaml", save_to: "res://qa/move" } });
      expect(res.isError).toBeFalsy();
      expect(textOf(res)).toMatch(/Evidence saved: res:\/\/qa\/move \(2 screenshots, report\.md\)/);
      expect(readFileSync(join(project, "qa/move/01-start.png"), "utf8")).toBe("ABC"); // "QUJD" decoded
      expect(readFileSync(join(project, "qa/move/report.md"), "utf8")).toContain('Scenario "move": PASSED');
    });

    it("saves a folder run as one folder per scenario plus a summary", async () => {
      write("tests/s/1_a.yaml", "name: a\nsteps:\n  - screenshot: a\n");
      write("tests/s/2_b.yaml", "name: b\nsteps:\n  - screenshot: b\n");
      const res = await client.callTool({ name: "scenario_run", arguments: { path: "res://tests/s", save_to: "res://qa/all" } });
      expect(textOf(res)).toMatch(/Evidence saved: res:\/\/qa\/all \(2 screenshots, summary\.md\)/);
      expect(existsSync(join(project, "qa/all/1_a/01-a.png"))).toBe(true);
      expect(readFileSync(join(project, "qa/all/summary.md"), "utf8")).toContain("[report](2_b/report.md)");
    });

    it("checks the folder before starting the game", async () => {
      write("tests/move.yaml", "name: move\nsteps:\n  - screenshot: start\n");
      for (const save_to of ["res://.godot/ev", "res://../ev", "res://"]) {
        const before = addon.received.length;
        const res = await client.callTool({ name: "scenario_run", arguments: { path: "res://tests/move.yaml", save_to } });
        expect(res.isError).toBe(true);
        expect(textOf(res)).toContain("PATH_FORBIDDEN");
        expect(addon.received.length).toBe(before); // nothing sent to the editor
      }
    });
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

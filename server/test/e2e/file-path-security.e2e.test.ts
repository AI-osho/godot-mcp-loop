import { linkSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectClient, textOf } from "../helpers.js";
import { startHeadlessEditor, type GodotHarness } from "./godot-harness.js";

describe("e2e: file writes and delayed undo never follow aliases", () => {
  let h: GodotHarness;
  let client: Client;
  let outside: string;
  beforeAll(async () => {
    outside = mkdtempSync(join(tmpdir(), "gml-undo-outside-"));
    h = await startHeadlessEditor({
      extraFiles: { "qa/keep.txt": "ORIGINAL", "probe.tscn": '[gd_scene format=3]\n[node name="Probe" type="Node"]\n' },
      projectGodotExtra: '[editor]\nrun/main_run_args="--headless"\n',
    });
    client = await connectClient(h.conn);
  });
  afterAll(async () => { await client?.close(); await h?.stop(); rmSync(outside, { recursive: true, force: true }); });

  it("replaces a hard-linked script without overwriting its external inode", async () => {
    const sentinel = join(outside, "keep.gd");
    const old = "extends Node\n# KEEP\n";
    writeFileSync(sentinel, old); linkSync(sentinel, join(h.projectPath, "linked.gd"));
    const result = await client.callTool({ name: "script_write", arguments: { path: "res://linked.gd", content: "extends Node\n# NEW\n" } });
    expect(readFileSync(sentinel, "utf8")).toBe(old);
    expect(result.isError, textOf(result)).toBeFalsy();
    expect(readFileSync(join(h.projectPath, "linked.gd"), "utf8")).toContain("# NEW");
  });

  it("method conditions really can mutate game state, so their annotation is conservative", async () => {
    const run = await client.callTool({ name: "game_run", arguments: { scene: "res://probe.tscn" } });
    expect(run.isError, textOf(run)).toBeFalsy();
    try {
      const wait = await client.callTool({ name: "game_wait_for", arguments: {
        node: ".", method: "set_meta", args: ["audit_fixture", 123], op: "==", value: null, timeout_ms: 0,
      } });
      expect(wait.isError, textOf(wait)).toBeFalsy();
      const read = await client.callTool({ name: "game_call", arguments: { node: ".", method: "get_meta", args: ["audit_fixture"] } });
      expect(JSON.parse(textOf(read)).returned).toBe(123);
    } finally { await client.callTool({ name: "game_stop", arguments: {} }); }
  });

  it("revalidates a file action before undo, after its parent became a symlink", async () => {
    const sentinel = join(outside, "keep.txt"); writeFileSync(sentinel, "KEEP");
    const written = await client.callTool({ name: "file_write", arguments: { path: "res://qa/keep.txt", content: "CHANGED" } });
    expect(written.isError, textOf(written)).toBeFalsy();
    const original = join(h.projectPath, "qa-original");
    const alias = join(h.projectPath, "qa");
    renameSync(alias, original); symlinkSync(outside, alias, "dir");
    try {
      const result = await client.callTool({ name: "edit_undo", arguments: {} });
      expect(readFileSync(sentinel, "utf8")).toBe("KEEP");
      expect(result.isError, textOf(result)).toBe(true);
      expect(textOf(result)).toMatch(/PATH_FORBIDDEN.*File path changed.*link/i);
    } finally {
      rmSync(alias); renameSync(original, alias);
    }
    const retry = await client.callTool({ name: "edit_undo", arguments: {} });
    expect(retry.isError, textOf(retry)).toBeFalsy();
    expect(readFileSync(join(alias, "keep.txt"), "utf8")).toBe("ORIGINAL");
  });
});

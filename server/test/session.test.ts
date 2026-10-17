import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSession, sessionFilePath } from "../src/session.js";

describe("readSession", () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "gml-session-"));
  });
  afterEach(() => rmSync(project, { recursive: true, force: true }));

  function write(data: unknown): void {
    mkdirSync(join(project, ".godot", "mcp_loop"), { recursive: true });
    writeFileSync(sessionFilePath(project), JSON.stringify(data));
  }

  it("reads port and token of a live editor", () => {
    write({ port: 6511, token: "t", protocol: 1, pid: process.pid, godot_version: "4.7.2" });
    expect(readSession(project)).toMatchObject({ port: 6511, token: "t", pid: process.pid });
  });

  it("throws GODOT_NOT_RUNNING when the session file is missing", () => {
    expect(() => readSession(project)).toThrowError(expect.objectContaining({ code: "GODOT_NOT_RUNNING" }));
  });

  it("the not-running hint names the minimum supported Godot version (4.5+)", () => {
    expect(() => readSession(project)).toThrowError(expect.objectContaining({ hint: expect.stringContaining("4.5+") }));
  });

  it("throws GODOT_NOT_RUNNING for a stale file whose pid is dead", () => {
    write({ port: 6511, token: "t", protocol: 1, pid: 2 ** 22 + 12345 });
    expect(() => readSession(project)).toThrowError(expect.objectContaining({ code: "GODOT_NOT_RUNNING" }));
  });

  it("throws BAD_SESSION_FILE on malformed content", () => {
    write({ port: "nope" });
    expect(() => readSession(project)).toThrowError(expect.objectContaining({ code: "BAD_SESSION_FILE" }));
  });
});

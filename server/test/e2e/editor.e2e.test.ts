import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionFilePath } from "../../src/session.js";
import { textOf } from "../helpers.js";
import { createTestProject, GODOT_BIN } from "./godot-harness.js";

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("e2e: editor_launch / editor_quit with the built server", () => {
  let project: string;
  let client: Client;
  let pid: number | undefined;

  beforeAll(async () => {
    project = createTestProject();
    // An absolute GODOT_BIN (CI) is passed with --godot; otherwise the server finds Godot on PATH by itself.
    const args = [join(SERVER_DIR, "dist", "index.js"), "--project", project, ...(isAbsolute(GODOT_BIN) ? ["--godot", GODOT_BIN] : [])];
    const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
    env.MCP_LOOP_PORT = String(17510 + Math.floor(Math.random() * 400) * 10);
    client = new Client({ name: "e2e", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args, env, stderr: "pipe" }));
  });

  afterAll(async () => {
    await client?.close();
    if (pid !== undefined && alive(pid)) process.kill(pid, "SIGKILL");
    rmSync(project, { recursive: true, force: true });
  });

  it("opens a headless editor on the project, then closes it", async () => {
    const before = await client.callTool({ name: "godot_status", arguments: {} });
    expect(textOf(before)).toMatch(/GODOT_NOT_RUNNING/);

    const res = await client.callTool({ name: "editor_launch", arguments: { headless: true, timeout_ms: 90_000 } }, undefined, { timeout: 120_000 });
    expect(res.isError, textOf(res)).toBeFalsy();
    const launched = JSON.parse(textOf(res));
    expect(launched).toMatchObject({ launched: true, connected: true, project_name: "e2e" });
    pid = launched.pid as number;
    expect(alive(pid)).toBe(true);

    const again = JSON.parse(textOf(await client.callTool({ name: "editor_launch", arguments: { headless: true } })));
    expect(again).toMatchObject({ launched: false, already_running: true });

    const quit = await client.callTool({ name: "editor_quit", arguments: {} }, undefined, { timeout: 60_000 });
    expect(quit.isError, textOf(quit)).toBeFalsy();
    expect(JSON.parse(textOf(quit))).toMatchObject({ quit: true, saved: true });
    expect(JSON.parse(textOf(quit)).killed).toBeUndefined();
    expect(alive(pid)).toBe(false);
    expect(existsSync(sessionFilePath(project))).toBe(false);
  }, 180_000);
});

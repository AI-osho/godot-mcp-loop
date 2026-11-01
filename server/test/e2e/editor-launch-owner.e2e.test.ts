import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { expect, it } from "vitest";
import { GodotConnection } from "../../src/connection.js";
import { EditorLauncher } from "../../src/editor-launcher.js";
import { connectClient, jsonOf, textOf } from "../helpers.js";
import { createTestProject } from "./godot-harness.js";

it("keeps one real editor owner through timeout, retry, delayed publication and graceful quit", async () => {
  const plugin = readFileSync(new URL("../../../addons/mcp_loop/plugin.gd", import.meta.url), "utf8");
  const portProbe = createServer();
  await new Promise<void>((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
  const port = (portProbe.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => portProbe.close((e) => e ? reject(e) : resolve()));
  const project = createTestProject({ extraFiles: {
    "addons/mcp_loop/plugin.gd": plugin.replace('preload("res://addons/mcp_loop/bridge/session_file.gd")', 'preload("res://addons/mcp_loop/qa_delayed_session.gd")'),
    "addons/mcp_loop/qa_delayed_session.gd": `extends "res://addons/mcp_loop/bridge/session_file.gd"
# Only this private fixture delays publication; the eventual writer is the production SessionFile.
func write(port: int, token: String) -> Error:
  EditorInterface.get_base_control().get_tree().create_timer(3.0).timeout.connect(_publish.bind(port, token), CONNECT_ONE_SHOT)
  return OK
func _publish(port: int, token: String) -> void:
  if super.write(port, token) != OK:
    push_error("Delayed fixture session publication failed")
`,
  } });
  const children: Array<{ proc: ChildProcess; exit: Promise<void> }> = [];
  const launcher = new EditorLauncher({ pollMs: 25, spawn: (cmd, args, opts) => {
    const proc = spawn(cmd, args, { ...opts, env: { ...process.env, MCP_LOOP_PORT: String(port) } });
    children.push({ proc, exit: new Promise<void>((resolve) => proc.once("exit", () => resolve())) });
    return proc;
  } });
  const conn = new GodotConnection({ projectPath: project });
  let client: Client | undefined;
  try {
    client = await connectClient(conn, { launcher });
    const first = await client.callTool({ name: "editor_launch", arguments: { headless: true, timeout_ms: 1000 } });
    expect(first.isError, textOf(first)).toBe(true);
    expect(textOf(first)).toContain("TIMEOUT");
    expect(children).toHaveLength(1);
    expect(children[0]!.proc.exitCode).toBeNull();
    const retry = await client.callTool({ name: "editor_launch", arguments: { headless: true, timeout_ms: 1000 } });
    expect(retry.isError, textOf(retry)).toBe(true);
    expect(textOf(retry)).toContain("BUSY");
    expect(children).toHaveLength(1);
    const deadline = Date.now() + 20_000;
    let ready = false;
    while (Date.now() < deadline) {
      try { await conn.call("ping", {}, { timeoutMs: 1000 }); ready = true; break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
    }
    expect(ready, "the delayed production session must eventually authenticate").toBe(true);
    const quit = await client.callTool({ name: "editor_quit", arguments: { save: false, timeout_ms: 5000 } });
    expect(quit.isError, textOf(quit)).toBeFalsy();
    expect(jsonOf(quit)).toMatchObject({ quit: true, saved: false });
    expect(jsonOf(quit).killed).toBeUndefined();
    expect(children[0]!.proc.exitCode).toBe(0);
    const gone = await client.callTool({ name: "editor_quit", arguments: { save: false, timeout_ms: 1000 } });
    expect(gone.isError, textOf(gone)).toBe(true);
    expect(textOf(gone)).toContain("GODOT_NOT_RUNNING");
  } finally {
    try { await client?.close(); } finally {
      conn.close();
      for (const child of children) {
        if (child.proc.exitCode === null && child.proc.signalCode === null) {
          child.proc.kill("SIGKILL");
          await Promise.race([child.exit, new Promise((_, reject) => setTimeout(() => reject(new Error("fixture editor exit was not confirmed")), 5000))]);
        }
      }
      rmSync(project, { recursive: true, force: true });
    }
  }
}, 120_000);

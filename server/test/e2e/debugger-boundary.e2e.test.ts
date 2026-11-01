import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { connectClient, jsonOf, textOf } from "../helpers.js";
import { startHeadlessEditor } from "./godot-harness.js";

function boundaryFiles(): Record<string, string> {
  const cfg = readFileSync(new URL("../../../addons/mcp_loop/plugin.cfg", import.meta.url), "utf8");
  return {
    "addons/mcp_loop/plugin.cfg": cfg.replace('script="plugin.gd"', 'script="qa_debugger.gd"'),
    "addons/mcp_loop/qa_debugger.gd": `@tool
extends "res://addons/mcp_loop/plugin.gd"
const ProbeBridge = preload("res://addons/mcp_loop/debugger/debugger_bridge.gd")
func _enter_tree() -> void:
  super()
  _router.register("qa.debugger", _qa_debugger)
  _router.register("qa.runtime", _qa_runtime)
func _qa_runtime(p: Dictionary) -> Dictionary:
  if p.get("op") == "timeout":
    return await _debugger.call_runtime(get_tree(), "wait_for", {"node": ".", "property": "ready_value", "op": "==", "value": true, "timeout_ms": 250}, 25)
  if p.get("op") == "inject":
    var deadline := Time.get_ticks_msec() + 5000
    while _debugger._pending.is_empty() and Time.get_ticks_msec() < deadline:
      await get_tree().process_frame
    if _debugger._pending.is_empty():
      return {"ok": false, "error": {"code": "TIMEOUT", "message": "No live runtime request appeared in the fixture"}}
    var request_id: int = _debugger._pending.keys()[0]
    _debugger._capture("mcp_loop:response", [{"id": request_id, "ok": true, "result": {"marker": "foreign"}}], _debugger.session_id + 9)
  if p.get("op") == "settle":
    await get_tree().create_timer(0.6).timeout
  if p.get("op") == "late":
    _debugger._capture("mcp_loop:response", [{"id": _debugger._next_id - 1, "ok": true, "result": {"marker": "late"}}], _debugger.session_id)
  return {"ok": true, "result": {"pending": _debugger._pending.size(), "responses": _debugger._responses.size(), "generation": _debugger._generation, "next_id": _debugger._next_id}}
func _qa_debugger(p: Dictionary) -> Dictionary:
  var bridge := ProbeBridge.new()
  bridge.session_id = 7
  bridge.ready = true
  if p.get("op") == "state":
    bridge.pause_on_error = true
    bridge.runtime_info = {"scene": "owned"}
    bridge.paused = true
    bridge._on_continued(9)
    var foreign_continued_ignored := bridge.paused
    bridge.paused = false
    bridge._capture("mcp_loop:logs", [[{"level": "error", "message": "foreign"}]], 9)
    bridge._on_breaked(false, 9)
    bridge._on_stopped(9)
    bridge._capture("mcp_loop:hello", [{"scene": "foreign"}], 9)
    return {"ok": true, "result": {"session": bridge.session_id, "scene": bridge.runtime_info.get("scene"), "paused": bridge.paused, "breaks": bridge.break_count, "logs": bridge.game_logs.count("error"), "foreign_continued_ignored": foreign_continued_ignored}}
  if p.get("op") == "old_hello":
    bridge.reset_for_run(false)
    bridge._capture("mcp_loop:hello", [{"scene": "old"}], 7)
    return {"ok": true, "result": {"ready": bridge.ready, "session": bridge.session_id, "info": bridge.runtime_info}}
  if p.get("op") == "pending":
    bridge._pending[12] = {"session": 7, "generation": bridge._generation}
    bridge._pending[14] = {"session": 7, "generation": bridge._generation - 1}
    bridge._capture("mcp_loop:response", [{"id": 12, "ok": true, "result": "foreign"}], 9)
    bridge._capture("mcp_loop:response", [{"id": 14, "ok": true, "result": "stale"}], 7)
    bridge._capture("mcp_loop:response", [{"id": 12.0, "ok": true, "result": "numeric_alias"}], 7)
    var rejected := bridge._responses.is_empty()
    var reply := {"id": 12, "ok": true, "result": "valid"}
    bridge._capture("mcp_loop:response", [reply], 7)
    reply.result = "mutated"
    bridge._capture("mcp_loop:response", [{"id": 12, "ok": true, "result": "duplicate"}], 7)
    var first_reply: Variant = bridge._responses.get(12, {}).get("result")
    bridge._pending.erase(12)
    bridge._responses.clear()
    bridge._capture("mcp_loop:response", [{"id": 12, "ok": true, "result": "late"}], 7)
    return {"ok": true, "result": {"rejected": rejected, "first_reply": first_reply, "late": bridge._responses.size()}}
  bridge._capture("mcp_loop:response", [{"id": 12, "ok": true, "result": {"marker": "foreign"}}], 9)
  var foreign := bridge._responses.size()
  bridge._responses.clear()
  bridge._capture("mcp_loop:response", [{"id": 13, "ok": true, "result": {"marker": "unsolicited"}}], 7)
  return {"ok": true, "result": {"foreign": foreign, "unsolicited": bridge._responses.size()}}
`,
  };
}

it("does not retain foreign-session or unsolicited runtime responses in a real editor", async () => {
  const h = await startHeadlessEditor({ extraFiles: boundaryFiles() });
  try {
    const result = await h.conn.call("qa.debugger", {});
    expect(result).toEqual({ foreign: 0, unsolicited: 0 });
  } finally { await h.stop(); }
}, 120_000);

it("accepts one exact live request ID and rejects stale, duplicate and post-completion replies", async () => {
  const h = await startHeadlessEditor({ extraFiles: boundaryFiles() });
  try {
    const result = await h.conn.call("qa.debugger", { op: "pending" });
    expect(result).toEqual({ rejected: true, first_reply: "valid", late: 0 });
  } finally { await h.stop(); }
}, 120_000);

it("ignores foreign hello, logs, break and stopped callbacks", async () => {
  const h = await startHeadlessEditor({ extraFiles: boundaryFiles() });
  try {
    const result = await h.conn.call("qa.debugger", { op: "state" });
    expect(result).toEqual({ session: 7, scene: "owned", paused: false, breaks: 0, logs: 0, foreign_continued_ignored: true });
  } finally { await h.stop(); }
}, 120_000);

it("does not adopt an old hello after run reset without a new native session start", async () => {
  const h = await startHeadlessEditor({ extraFiles: boundaryFiles() });
  try {
    const result = await h.conn.call("qa.debugger", { op: "old_hello" });
    expect(result).toEqual({ ready: false, session: -1, info: {} });
  } finally { await h.stop(); }
}, 120_000);

async function startRuntimeFixture() {
  return startHeadlessEditor({
    extraFiles: { ...boundaryFiles(), "main.gd": "extends Node\nvar ready_value := false\n", "main.tscn": '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://main.gd" id="1"]\n[node name="Fixture" type="Node"]\nscript = ExtResource("1")\n' },
    applicationExtra: ['run/main_scene="res://main.tscn"'],
    projectGodotExtra: '[editor]\nrun/main_run_args="--headless"\n',
  });
}

it("ignores an injected foreign reply to an actual live MCP/runtime wait", async () => {
  const h = await startRuntimeFixture();
  const client = await connectClient(h.conn);
  let waiting: ReturnType<typeof client.callTool> | undefined;
  try {
    const run = await client.callTool({ name: "game_run", arguments: {} });
    expect(run.isError, textOf(run)).toBeFalsy();
    waiting = client.callTool({ name: "game_wait_for", arguments: { node: ".", property: "ready_value", op: "==", value: true, timeout_ms: 2500 } });
    const injected = (await h.conn.call("qa.runtime", { op: "inject" })) as { pending: number; responses: number };
    expect(injected.pending).toBe(1);
    expect(injected.responses).toBe(0);
    const result = await waiting;
    expect(result.isError, textOf(result)).toBe(true);
    expect(textOf(result)).toContain("TIMEOUT");
    const after = (await h.conn.call("qa.runtime", {})) as { pending: number; responses: number };
    expect(after).toMatchObject({ pending: 0, responses: 0 });
  } finally {
    await waiting?.catch(() => {});
    await client.close();
    await h.stop();
  }
}, 120_000);

it("cleans timed-out runtime ownership and drops its actual late reply", async () => {
  const h = await startRuntimeFixture();
  const client = await connectClient(h.conn);
  try {
    const run = await client.callTool({ name: "game_run", arguments: {} });
    expect(run.isError, textOf(run)).toBeFalsy();
    await expect(h.conn.call("qa.runtime", { op: "timeout" })).rejects.toMatchObject({ code: "TIMEOUT" });
    const after = (await h.conn.call("qa.runtime", { op: "settle" })) as { pending: number; responses: number };
    expect(after).toMatchObject({ pending: 0, responses: 0 });
    const live = await client.callTool({ name: "game_query", arguments: { node: ".", properties: ["ready_value"] } });
    expect(live.isError, textOf(live)).toBeFalsy();
    expect(jsonOf(live).properties.ready_value).toBe(false);
  } finally { await client.close(); await h.stop(); }
}, 120_000);

it("cancels old waiters on a real stop/restart and correlates concurrent requests in the new run", async () => {
  const h = await startRuntimeFixture();
  const client = await connectClient(h.conn);
  let waiting: ReturnType<typeof client.callTool> | undefined;
  try {
    const run = await client.callTool({ name: "game_run", arguments: {} });
    expect(run.isError, textOf(run)).toBeFalsy();
    const before = (await h.conn.call("qa.runtime", {})) as { generation: number; next_id: number };
    waiting = client.callTool({ name: "game_wait_for", arguments: { node: ".", property: "ready_value", op: "==", value: true, timeout_ms: 10000 } });
    await h.conn.call("qa.runtime", { op: "inject" });
    const stopped = await client.callTool({ name: "game_stop", arguments: {} });
    expect(stopped.isError, textOf(stopped)).toBeFalsy();
    const old = await waiting;
    expect(old.isError, textOf(old)).toBe(true);
    expect(textOf(old)).toContain("GAME_NOT_RUNNING");
    const restarted = await client.callTool({ name: "game_run", arguments: {} });
    expect(restarted.isError, textOf(restarted)).toBeFalsy();
    const late = (await h.conn.call("qa.runtime", { op: "late" })) as { pending: number; responses: number; generation: number; next_id: number };
    expect(late).toMatchObject({ pending: 0, responses: 0 });
    expect(late.generation).toBeGreaterThan(before.generation);
    expect(late.next_id).toBeGreaterThan(before.next_id);
    const queries = await Promise.all(Array.from({ length: 3 }, () => client.callTool({ name: "game_query", arguments: { node: ".", properties: ["ready_value"] } })));
    for (const query of queries) {
      expect(query.isError, textOf(query)).toBeFalsy();
      expect(jsonOf(query).properties.ready_value).toBe(false);
    }
    expect(await h.conn.call("qa.runtime", {})).toMatchObject({ pending: 0, responses: 0 });
  } finally {
    await waiting?.catch(() => {});
    await client.close();
    await h.stop();
  }
}, 120_000);

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge-client.js";
import { BridgeError } from "../src/errors.js";
import { FakeAddon } from "./fake-addon.js";

describe("BridgeClient", () => {
  let addon: FakeAddon;
  let port: number;
  let client: BridgeClient | undefined;

  beforeEach(async () => {
    addon = new FakeAddon();
    port = await addon.start();
  });

  afterEach(async () => {
    client?.close();
    client = undefined;
    await addon.stop();
  });

  it("connects, sends hello with token and protocol 1, returns server info", async () => {
    client = new BridgeClient({ port, token: addon.token });
    const info = await client.connect();
    expect(info.godot_version).toBe("4.7.2-fake");
    expect(addon.received[0]).toMatchObject({ method: "hello", params: { token: addon.token, protocol: 1 } });
    expect(client.isConnected()).toBe(true);
  });

  it("rejects connect with UNAUTHORIZED BridgeError on wrong token", async () => {
    client = new BridgeClient({ port, token: "wrong" });
    await expect(client.connect()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(client.isConnected()).toBe(false);
  });

  it("rejects connect with GODOT_NOT_RUNNING when nothing listens", async () => {
    await addon.stop();
    client = new BridgeClient({ port, token: "x", connectTimeoutMs: 1000 });
    const err = await client.connect().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BridgeError);
    expect((err as BridgeError).code).toBe("GODOT_NOT_RUNNING");
    addon = new FakeAddon();
    port = await addon.start();
  });

  it("request resolves with result", async () => {
    client = new BridgeClient({ port, token: addon.token });
    await client.connect();
    await expect(client.request("ping", {})).resolves.toEqual({ pong: true });
  });

  it("request rejects with BridgeError carrying code, message and hint", async () => {
    addon.handlers.set("node.get", () => ({
      ok: false,
      error: { code: "NODE_NOT_FOUND", message: "No node 'X'.", hint: "Use scene_tree." },
    }));
    client = new BridgeClient({ port, token: addon.token });
    await client.connect();
    const err = await client.request("node.get", { path: "X" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BridgeError);
    expect(err).toMatchObject({ code: "NODE_NOT_FOUND", message: "No node 'X'.", hint: "Use scene_tree." });
  });

  it("matches concurrent responses by id even when answered out of order", async () => {
    addon.handlers.set("slow", async (p) => {
      await new Promise((r) => setTimeout(r, 100));
      return { ok: true, result: { v: p.v } };
    });
    addon.handlers.set("fast", (p) => ({ ok: true, result: { v: p.v } }));
    client = new BridgeClient({ port, token: addon.token });
    await client.connect();
    const [a, b] = await Promise.all([client.request("slow", { v: 1 }), client.request("fast", { v: 2 })]);
    expect(a).toEqual({ v: 1 });
    expect(b).toEqual({ v: 2 });
  });

  it("request times out with TIMEOUT", async () => {
    client = new BridgeClient({ port, token: addon.token });
    await client.connect();
    addon.silent = true;
    await expect(client.request("ping", {}, { timeoutMs: 200 })).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("pending requests reject with DISCONNECTED when the socket drops", async () => {
    client = new BridgeClient({ port, token: addon.token });
    await client.connect();
    addon.silent = true;
    const p = client.request("ping", {}, { timeoutMs: 5000 });
    setTimeout(() => addon.dropAllConnections(), 50);
    await expect(p).rejects.toMatchObject({ code: "DISCONNECTED" });
    expect(client.isConnected()).toBe(false);
  });

  it("request before connect rejects with NOT_CONNECTED", async () => {
    client = new BridgeClient({ port, token: addon.token });
    await expect(client.request("ping", {})).rejects.toMatchObject({ code: "NOT_CONNECTED" });
  });

  it("emits pushed events to listeners", async () => {
    client = new BridgeClient({ port, token: addon.token });
    await client.connect();
    const got = new Promise((resolve) => client!.onEvent((e, d) => resolve({ e, d })));
    addon.pushEvent("game.log", { message: "hi" });
    await expect(got).resolves.toEqual({ e: "game.log", d: { message: "hi" } });
  });
});

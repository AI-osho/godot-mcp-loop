import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GodotConnection } from "../src/connection.js";
import { BridgeError } from "../src/errors.js";
import type { SessionInfo } from "../src/session.js";
import { FakeAddon } from "./fake-addon.js";

describe("GodotConnection", () => {
  let addon: FakeAddon;
  let port: number;
  let conn: GodotConnection;
  let reads: number;

  function session(): SessionInfo {
    reads++;
    return { port, token: addon.token, protocol: 1, pid: process.pid };
  }

  beforeEach(async () => {
    addon = new FakeAddon();
    port = await addon.start();
    reads = 0;
    conn = new GodotConnection({ projectPath: "/unused", readSession: session });
  });

  afterEach(async () => {
    conn.close();
    await addon.stop();
  });

  it("connects lazily on first call", async () => {
    expect(conn.isConnected()).toBe(false);
    await expect(conn.call("ping")).resolves.toEqual({ pong: true });
    expect(conn.isConnected()).toBe(true);
    expect(conn.serverInfo()?.godot_version).toBe("4.7.2-fake");
  });

  it("reuses the session for subsequent calls", async () => {
    await conn.call("ping");
    await conn.call("ping");
    expect(reads).toBe(1);
    expect(addon.received.filter((r) => r.method === "hello")).toHaveLength(1);
  });

  it("reconnects (re-reading the session file) after the editor restarts", async () => {
    await conn.call("ping");
    await addon.stop();
    await vi.waitFor(() => expect(conn.isConnected()).toBe(false));
    addon = new FakeAddon("new-token");
    port = await addon.start();
    await expect(conn.call("ping")).resolves.toEqual({ pong: true });
    expect(reads).toBe(2);
  });

  it("propagates session read errors", async () => {
    conn = new GodotConnection({
      projectPath: "/x",
      readSession: () => {
        throw new BridgeError("GODOT_NOT_RUNNING", "no session");
      },
    });
    await expect(conn.call("ping")).rejects.toMatchObject({ code: "GODOT_NOT_RUNNING" });
  });

  it("forwards pushed events to listeners registered before connecting", async () => {
    const got = new Promise((resolve) => conn.onEvent((e, d) => resolve([e, d])));
    await conn.call("ping");
    addon.pushEvent("game.log", { m: 1 });
    await expect(got).resolves.toEqual(["game.log", { m: 1 }]);
  });
});

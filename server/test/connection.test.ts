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

  it("recovers after the editor was not running (session read failed) once it starts", async () => {
    let editorUp = false;
    conn = new GodotConnection({
      projectPath: "/x",
      readSession: () => {
        if (!editorUp) throw new BridgeError("GODOT_NOT_RUNNING", "session.json is missing");
        return { port, token: addon.token, protocol: 1, pid: process.pid };
      },
    });
    await expect(conn.call("ping")).rejects.toMatchObject({ code: "GODOT_NOT_RUNNING" });
    editorUp = true;
    await expect(conn.call("ping")).resolves.toEqual({ pong: true });
  });

  it("recovers after a failed connect attempt (wrong token) once the session is fixed", async () => {
    let token = "stale";
    conn = new GodotConnection({
      projectPath: "/x",
      readSession: () => ({ port, token, protocol: 1, pid: process.pid }),
    });
    await expect(conn.call("ping")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    token = addon.token;
    await expect(conn.call("ping")).resolves.toEqual({ pong: true });
  });

  it("switchProject drops the connection and the next call reads the new project's session (#12)", async () => {
    const other = new FakeAddon("other-token");
    const otherPort = await other.start();
    const asked: string[] = [];
    conn = new GodotConnection({
      projectPath: "/a",
      readSession: (p) => {
        asked.push(p);
        return p === "/b"
          ? { port: otherPort, token: other.token, protocol: 1, pid: process.pid }
          : { port, token: addon.token, protocol: 1, pid: process.pid };
      },
    });
    try {
      await conn.call("ping");
      conn.switchProject("/b");
      expect(conn.projectPath).toBe("/b");
      expect(conn.isConnected()).toBe(false);
      await conn.call("ping");
      expect(asked).toEqual(["/a", "/b"]);
      expect(other.received.filter((r) => r.method === "ping")).toHaveLength(1);
    } finally {
      conn.close();
      await other.stop();
    }
  });

  it("a connect still in flight for the old project does not become the connection after a switch (#12)", async () => {
    const other = new FakeAddon("other-token");
    const otherPort = await other.start();
    addon.helloDelayMs = 300; // the old editor answers hello only after the switch
    conn = new GodotConnection({
      projectPath: "/a",
      readSession: (p) =>
        p === "/b"
          ? { port: otherPort, token: other.token, protocol: 1, pid: process.pid }
          : { port, token: addon.token, protocol: 1, pid: process.pid },
    });
    try {
      const old = conn.call("ping");
      await vi.waitFor(() => expect(addon.received.some((r) => r.method === "hello")).toBe(true));
      conn.switchProject("/b");
      const next = conn.call("ping");
      await expect(old).rejects.toMatchObject({ code: "DISCONNECTED" });
      await expect(next).resolves.toEqual({ pong: true });
      await expect(conn.call("ping")).resolves.toEqual({ pong: true });
      expect(other.received.filter((r) => r.method === "ping")).toHaveLength(2);
      expect(addon.received.filter((r) => r.method === "ping")).toHaveLength(0);
    } finally {
      conn.close();
      await other.stop();
    }
  });

  it("adds project_list / project_connect to the not-running hint when switching is enabled (#12)", async () => {
    conn = new GodotConnection({
      projectPath: "/x",
      projectsRoots: ["/games"],
      readSession: () => {
        throw new BridgeError("GODOT_NOT_RUNNING", "no session", "Open the project.");
      },
    });
    await expect(conn.call("ping")).rejects.toMatchObject({
      code: "GODOT_NOT_RUNNING",
      hint: expect.stringMatching(/Open the project\..*project_connect/),
    });
  });

  it("forwards pushed events to listeners registered before connecting", async () => {
    const got = new Promise((resolve) => conn.onEvent((e, d) => resolve([e, d])));
    await conn.call("ping");
    addon.pushEvent("game.log", { m: 1 });
    await expect(got).resolves.toEqual(["game.log", { m: 1 }]);
  });
});

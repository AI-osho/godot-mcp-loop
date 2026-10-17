import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "node:net";

export type Handler = (params: Record<string, unknown>) => unknown | Promise<unknown>;

/**
 * Minimal stand-in for the Godot addon's bridge: speaks protocol v1,
 * requires hello+token, then dispatches to registered handlers.
 * Handlers return the full envelope ({ok:true,result} / {ok:false,error}).
 */
export class FakeAddon {
  readonly token: string;
  readonly handlers = new Map<string, Handler>();
  readonly received: Array<Record<string, unknown>> = [];
  private wss!: WebSocketServer;
  private sockets = new Set<WebSocket>();
  /** When true, requests are accepted but never answered. */
  silent = false;

  constructor(token = "fake-token") {
    this.token = token;
    this.handlers.set("ping", () => ({ ok: true, result: { pong: true } }));
  }

  async start(): Promise<number> {
    this.wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((r) => this.wss.once("listening", () => r()));
    this.wss.on("connection", (ws) => {
      this.sockets.add(ws);
      let authed = false;
      ws.on("close", () => this.sockets.delete(ws));
      ws.on("message", async (raw) => {
        const req = JSON.parse(raw.toString()) as Record<string, unknown>;
        this.received.push(req);
        if (this.silent) return;
        const id = req.id ?? null;
        const params = (req.params ?? {}) as Record<string, unknown>;
        let env: unknown;
        if (req.method === "hello") {
          if (params.token !== this.token) {
            env = { ok: false, error: { code: "UNAUTHORIZED", message: "Invalid token." } };
          } else if (params.protocol !== 1) {
            env = { ok: false, error: { code: "PROTOCOL_MISMATCH", message: "bad protocol" } };
          } else {
            authed = true;
            env = { ok: true, result: { protocol: 1, godot_version: "4.7.2-fake", addon_version: "0.2.0" } };
          }
        } else if (!authed) {
          env = { ok: false, error: { code: "UNAUTHORIZED", message: "hello first" } };
        } else {
          const h = this.handlers.get(String(req.method));
          env = h
            ? await h(params)
            : { ok: false, error: { code: "UNKNOWN_METHOD", message: `Unknown method '${String(req.method)}'.` } };
        }
        ws.send(JSON.stringify({ id, ...(env as object) }));
      });
    });
    return (this.wss.address() as AddressInfo).port;
  }

  pushEvent(event: string, data: unknown): void {
    for (const s of this.sockets) s.send(JSON.stringify({ event, data }));
  }

  dropAllConnections(): void {
    for (const s of this.sockets) s.terminate();
  }

  async stop(): Promise<void> {
    this.dropAllConnections();
    await new Promise<void>((r) => this.wss.close(() => r()));
  }
}

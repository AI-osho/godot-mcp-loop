import { SERVER_VERSION } from "../src/server.js";
import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "node:net";

export type Handler = (params: Record<string, unknown>) => unknown | Promise<unknown>;

/**
 * Minimal stand-in for the Godot addon's bridge: speaks protocol v1,
 * requires hello+token, then dispatches to registered handlers.
 * Handlers return the full envelope ({ok:true,result} / {ok:false,error}).
 */
/**
 * Godot's JSON.stringify leaves control characters other than \b \t \n \f \r
 * unescaped (invalid JSON); mimic that.
 */
export function asGodotJson(json: string): string {
  return json.replace(/\\u00([01][0-9a-f])/g, (m, h: string) => String.fromCharCode(parseInt(h, 16)));
}

export class FakeAddon {
  /** Serialize responses like Godot does (raw control characters). */
  godotJson = false;
  /** Version reported in the hello reply; defaults to the server's own version. */
  addonVersion: string = SERVER_VERSION;
  readonly token: string;
  readonly handlers = new Map<string, Handler>();
  readonly received: Array<Record<string, unknown>> = [];
  private wss!: WebSocketServer;
  private sockets = new Set<WebSocket>();
  /** When true, requests are accepted but never answered. */
  silent = false;
  /** Delay before answering hello (e.g. to switch projects while a connect is in flight). */
  helloDelayMs = 0;

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
          if (this.helloDelayMs > 0) await new Promise((r) => setTimeout(r, this.helloDelayMs));
          if (params.token !== this.token) {
            env = { ok: false, error: { code: "UNAUTHORIZED", message: "Invalid token." } };
          } else if (params.protocol !== 1) {
            env = { ok: false, error: { code: "PROTOCOL_MISMATCH", message: "bad protocol" } };
          } else {
            authed = true;
            env = { ok: true, result: { protocol: 1, godot_version: "4.7.2-fake", addon_version: this.addonVersion } };
          }
        } else if (!authed) {
          env = { ok: false, error: { code: "UNAUTHORIZED", message: "hello first" } };
        } else {
          const h = this.handlers.get(String(req.method));
          env = h
            ? await h(params)
            : { ok: false, error: { code: "UNKNOWN_METHOD", message: `Unknown method '${String(req.method)}'.` } };
        }
        const json = JSON.stringify({ id, ...(env as object) });
        ws.send(this.godotJson ? asGodotJson(json) : json);
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

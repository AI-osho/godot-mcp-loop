import WebSocket from "ws";
import { BridgeError } from "./errors.js";

export const PROTOCOL_VERSION = 1;

export interface HelloResult {
  protocol: number;
  godot_version: string;
  addon_version: string;
}

export interface BridgeClientOptions {
  port: number;
  token: string;
  host?: string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: BridgeError) => void;
  timer: NodeJS.Timeout;
}

type EventListener = (event: string, data: unknown) => void;

/** WebSocket client for the addon bridge (protocol v1). One instance = one session. */
export class BridgeClient {
  private readonly opts: Required<BridgeClientOptions>;
  private ws: WebSocket | undefined;
  private connected = false;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<EventListener>();

  constructor(opts: BridgeClientOptions) {
    this.opts = {
      host: "127.0.0.1",
      connectTimeoutMs: 5000,
      requestTimeoutMs: 15000,
      ...opts,
    };
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(): Promise<HelloResult> {
    const url = `ws://${this.opts.host}:${this.opts.port}`;
    const ws = new WebSocket(url, { maxPayload: 64 * 1024 * 1024 });
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.terminate();
        reject(notRunning(url, "timed out"));
      }, this.opts.connectTimeoutMs);
      ws.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once("error", (e) => {
        clearTimeout(timer);
        reject(notRunning(url, e.message));
      });
    });

    ws.on("message", (raw) => this.onMessage(raw.toString()));
    ws.on("close", () => this.onClose());
    ws.on("error", () => {
      /* close handler does the cleanup */
    });

    // hello must succeed before the session is usable.
    this.connected = true;
    try {
      return (await this.request("hello", {
        token: this.opts.token,
        protocol: PROTOCOL_VERSION,
      })) as HelloResult;
    } catch (e) {
      this.close();
      throw e;
    }
  }

  request(method: string, params: Record<string, unknown> = {}, opt: { timeoutMs?: number } = {}): Promise<unknown> {
    if (!this.isConnected() || !this.ws) {
      return Promise.reject(
        new BridgeError("NOT_CONNECTED", "Not connected to the Godot editor.", "Open the project in the Godot editor with the MCP Loop plugin enabled."),
      );
    }
    const id = this.nextId++;
    const timeoutMs = opt.timeoutMs ?? this.opts.requestTimeoutMs;
    const ws = this.ws;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError("TIMEOUT", `Godot did not answer '${method}' within ${timeoutMs} ms.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.connected = false;
    this.ws?.close();
    this.ws = undefined;
    this.failAll(new BridgeError("DISCONNECTED", "Connection to the Godot editor was closed."));
  }

  private onMessage(text: string): void {
    const msg = parseGodotJson(text);
    if (!msg) return;
    if (typeof msg.event === "string") {
      for (const l of this.listeners) l(msg.event, msg.data);
      return;
    }
    const id = typeof msg.id === "number" ? msg.id : NaN;
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (msg.ok === true) {
      p.resolve(msg.result);
    } else if (msg.ok === false && msg.error && typeof msg.error === "object") {
      const e = msg.error as { code?: string; message?: string; hint?: string };
      p.reject(new BridgeError(e.code ?? "INTERNAL", e.message ?? "Unknown error", e.hint));
    } else {
      p.reject(new BridgeError("BAD_RESPONSE", "Malformed response from the Godot addon."));
    }
  }

  private onClose(): void {
    this.connected = false;
    this.ws = undefined;
    this.failAll(
      new BridgeError(
        "DISCONNECTED",
        "Connection to the Godot editor was lost.",
        "The editor may have restarted or reloaded the plugin. Check the editor state (e.g. godot_status) before retrying an edit.",
      ),
    );
  }

  private failAll(err: BridgeError): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }
}

function notRunning(url: string, detail: string): BridgeError {
  return new BridgeError(
    "GODOT_NOT_RUNNING",
    `Could not reach the Godot editor bridge at ${url} (${detail}).`,
    "Open the project in the Godot editor and enable Project > Project Settings > Plugins > MCP Loop.",
  );
}


/**
 * Godot's JSON.stringify leaves control characters other than \b \t \n \f \r
 * unescaped (e.g. ESC from colored log output), which JSON.parse rejects.
 * Escape them and parse again instead of dropping the response.
 */
export function parseGodotJson(text: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    try {
      // Raw control characters can only appear inside strings here: Godot
      // escapes \b \t \n \f \r itself, so escaping the rest is lossless.
      const fixed = text.replace(/[\u0000-\u0008\u000b\u000e-\u001f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
      return JSON.parse(fixed) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
}

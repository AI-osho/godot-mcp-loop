import { BridgeClient, type HelloResult } from "./bridge-client.js";
import { readSession as defaultReadSession, type SessionInfo } from "./session.js";

type EventListener = (event: string, data: unknown) => void;

export interface GodotConnectionOptions {
  projectPath: string;
  readSession?: (projectPath: string) => SessionInfo;
  requestTimeoutMs?: number;
}

/**
 * Lazily connected, self-healing handle to the editor bridge. Each call
 * (re)connects if needed, re-reading the session file so editor restarts
 * (new port/token) are picked up transparently.
 */
export class GodotConnection {
  readonly projectPath: string;
  private readonly readSessionFn: (projectPath: string) => SessionInfo;
  private readonly requestTimeoutMs: number | undefined;
  private client: BridgeClient | undefined;
  private info: HelloResult | undefined;
  private connecting: Promise<BridgeClient> | undefined;
  private readonly listeners = new Set<EventListener>();

  constructor(opts: GodotConnectionOptions) {
    this.projectPath = opts.projectPath;
    this.readSessionFn = opts.readSession ?? defaultReadSession;
    this.requestTimeoutMs = opts.requestTimeoutMs;
  }

  isConnected(): boolean {
    return this.client?.isConnected() ?? false;
  }

  serverInfo(): HelloResult | undefined {
    return this.isConnected() ? this.info : undefined;
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async call(method: string, params: Record<string, unknown> = {}, opt: { timeoutMs?: number } = {}): Promise<unknown> {
    const client = await this.ensureConnected();
    return client.request(method, params, opt);
  }

  close(): void {
    this.client?.close();
    this.client = undefined;
    this.info = undefined;
  }

  private ensureConnected(): Promise<BridgeClient> {
    if (this.client?.isConnected()) return Promise.resolve(this.client);
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      try {
        this.client?.close();
        const s = this.readSessionFn(this.projectPath);
        const client = new BridgeClient({
          port: s.port,
          token: s.token,
          ...(this.requestTimeoutMs !== undefined ? { requestTimeoutMs: this.requestTimeoutMs } : {}),
        });
        client.onEvent((e, d) => {
          for (const l of this.listeners) l(e, d);
        });
        this.info = await client.connect();
        this.client = client;
        return client;
      } finally {
        this.connecting = undefined;
      }
    })();
    return this.connecting;
  }
}

import { BridgeClient, type HelloResult } from "./bridge-client.js";
import { BridgeError } from "./errors.js";
import { readSession as defaultReadSession, type SessionInfo } from "./session.js";
import { SERVER_VERSION } from "./version.js";

type EventListener = (event: string, data: unknown) => void;

export interface GodotConnectionOptions {
  projectPath: string;
  /** Folders whose projects project_connect may switch to (#12); empty = bound to projectPath. */
  projectsRoots?: string[];
  readSession?: (projectPath: string) => SessionInfo;
  requestTimeoutMs?: number;
}

const SWITCH_HINT = "Or switch to another project: project_list shows them, project_connect {path} connects.";

/**
 * Lazily connected, self-healing handle to the editor bridge. Each call
 * (re)connects if needed, re-reading the session file so editor restarts
 * (new port/token) are picked up transparently.
 */
export class GodotConnection {
  readonly projectsRoots: string[];
  private currentProject: string;
  private readonly readSessionFn: (projectPath: string) => SessionInfo;
  private readonly requestTimeoutMs: number | undefined;
  private client: BridgeClient | undefined;
  private info: HelloResult | undefined;
  private connecting: Promise<BridgeClient> | undefined;
  /** Bumped by switchProject, so a connect started for the previous project is discarded. */
  private generation = 0;
  private readonly listeners = new Set<EventListener>();

  constructor(opts: GodotConnectionOptions) {
    this.currentProject = opts.projectPath;
    this.projectsRoots = opts.projectsRoots ?? [];
    this.readSessionFn = opts.readSession ?? defaultReadSession;
    this.requestTimeoutMs = opts.requestTimeoutMs;
  }

  get projectPath(): string {
    return this.currentProject;
  }

  /** Session of any project (used to tell whether its editor runs); throws like readSession. */
  readSessionOf(projectPath: string): SessionInfo {
    return this.readSessionFn(projectPath);
  }

  /** Points the connection at another project: drops the current editor connection; the next call connects anew. */
  switchProject(projectPath: string): void {
    this.generation += 1;
    this.connecting = undefined;
    this.close();
    this.currentProject = projectPath;
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
    const attempt = this.connectOnce();
    this.connecting = attempt;
    // Clear the shared attempt only once it settles. (Clearing inside the async
    // body is wrong: a synchronous failure runs its `finally` before the
    // assignment above, leaving a rejected promise cached forever.)
    const clear = () => {
      if (this.connecting === attempt) this.connecting = undefined;
    };
    attempt.then(clear, clear);
    return attempt;
  }

  private async connectOnce(): Promise<BridgeClient> {
    this.client?.close();
    const generation = this.generation;
    const project = this.currentProject;
    let s: SessionInfo;
    try {
      s = this.readSessionFn(project);
    } catch (e) {
      if (e instanceof BridgeError && e.code === "GODOT_NOT_RUNNING" && this.projectsRoots.length > 0) {
        throw new BridgeError(e.code, e.message, e.hint ? `${e.hint} ${SWITCH_HINT}` : SWITCH_HINT);
      }
      throw e;
    }
    const client = new BridgeClient({
      port: s.port,
      token: s.token,
      ...(this.requestTimeoutMs !== undefined ? { requestTimeoutMs: this.requestTimeoutMs } : {}),
    });
    client.onEvent((e, d) => {
      for (const l of this.listeners) l(e, d);
    });
    const info = await client.connect();
    if (generation !== this.generation) {
      client.close();
      throw new BridgeError(
        "DISCONNECTED",
        `The server was switched from ${project} to ${this.currentProject} while connecting.`,
        "Call the tool again; it now talks to the new project.",
      );
    }
    // Say it once, where the log is, not only in godot_status: a trial once spent an hour on a tool the addon had
    // and the server did not, because both sides carried the same old version number.
    if (info.addon_version !== SERVER_VERSION) {
      console.error(
        `[godot-mcp-loop] version mismatch: the Godot addon is ${info.addon_version}, this MCP server is ${SERVER_VERSION}. ` +
          "Tools may be missing or behave differently — update the older side and restart the server " +
          "(Claude Code: /mcp -> godot-loop -> Reconnect).",
      );
    }
    this.info = info;
    this.client = client;
    return client;
  }
}

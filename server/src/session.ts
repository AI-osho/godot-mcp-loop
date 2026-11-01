import { existsSync, statSync } from "node:fs";
import { readTextFileBounded } from "./bounded-io.js";
import { join } from "node:path";
import { BridgeError } from "./errors.js";
import { projectFilePath } from "./project-path.js";

export interface SessionInfo {
  port: number;
  token: string;
  protocol: number;
  pid: number;
  godot_version?: string;
  project_path?: string;
}

export function sessionFilePath(projectPath: string): string {
  return join(projectPath, ".godot", "mcp_loop", "session.json");
}

const OPEN_HINT =
  "Open this project in the Godot editor (4.5+) with the MCP Loop plugin enabled " +
  "(Project > Project Settings > Plugins), or call editor_launch to open it. Check that --project points at the folder " +
  "containing project.godot.";

/** Reads the session file written by the running editor's addon. */
export function readSession(projectPath: string): SessionInfo {
  const file = existsSync(projectPath)
    ? projectFilePath(projectPath, "res://.godot/mcp_loop/session.json", { write: true, protectedTop: [] }).abs
    : sessionFilePath(projectPath);
  if (!existsSync(file)) {
    throw new BridgeError("GODOT_NOT_RUNNING", `No running Godot editor found for ${projectPath} (${file} is missing).`, OPEN_HINT);
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(readTextFileBounded(file, 64 * 1024)) as Record<string, unknown>;
  } catch {
    throw new BridgeError("BAD_SESSION_FILE", `Could not parse ${file}.`, "Restart the Godot editor to regenerate it.");
  }
  if (data === null || typeof data !== "object" || Array.isArray(data) ||
      typeof data.port !== "number" || !Number.isInteger(data.port) || data.port < 1 || data.port > 65535 ||
      typeof data.token !== "string" || data.token.length === 0 ||
      typeof data.pid !== "number" || !Number.isInteger(data.pid) || data.pid < 1 || data.pid > 0x7fffffff) {
    throw new BridgeError("BAD_SESSION_FILE", `${file} is missing port/token/pid.`, "Restart the Godot editor to regenerate it.");
  }
  try {
    if (typeof data.project_path !== "string") throw new Error("missing project identity");
    const requested = statSync(projectPath);
    const recorded = statSync(data.project_path);
    if (!requested.isDirectory() || !recorded.isDirectory() || requested.dev !== recorded.dev || requested.ino !== recorded.ino) {
      throw new Error("wrong project identity");
    }
  } catch {
    throw new BridgeError("BAD_SESSION_FILE", "The session file does not identify the selected project.", "Open this project again to regenerate its session; do not copy another project's .godot directory.");
  }
  if (!isProcessAlive(data.pid)) {
    throw new BridgeError(
      "GODOT_NOT_RUNNING",
      `The Godot editor that wrote ${file} (pid ${data.pid}) is no longer running.`,
      OPEN_HINT,
    );
  }
  return data as unknown as SessionInfo;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means it exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

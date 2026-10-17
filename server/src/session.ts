import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BridgeError } from "./errors.js";

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
  "Open this project in the Godot editor (4.4+) with the MCP Loop plugin enabled " +
  "(Project > Project Settings > Plugins). Check that --project points at the folder containing project.godot.";

/** Reads the session file written by the running editor's addon. */
export function readSession(projectPath: string): SessionInfo {
  const file = sessionFilePath(projectPath);
  if (!existsSync(file)) {
    throw new BridgeError("GODOT_NOT_RUNNING", `No running Godot editor found for ${projectPath} (${file} is missing).`, OPEN_HINT);
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    throw new BridgeError("BAD_SESSION_FILE", `Could not parse ${file}.`, "Restart the Godot editor to regenerate it.");
  }
  if (typeof data.port !== "number" || typeof data.token !== "string" || typeof data.pid !== "number") {
    throw new BridgeError("BAD_SESSION_FILE", `${file} is missing port/token/pid.`, "Restart the Godot editor to regenerate it.");
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

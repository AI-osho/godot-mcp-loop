import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BridgeError } from "../errors.js";

const running = new Set<string>();
const worker = fileURLToPath(new URL("../../authoring/worker.py", import.meta.url));

/** Fixed script, no shell or model-selected executable; works from src/ and dist/. */
export async function runWorker(project: string, op: "inspect" | "build" | "verify" | "preview", params: object, signal?: AbortSignal): Promise<unknown> {
  const key = realpathSync(project);
  if (signal?.aborted) throw new BridgeError("CANCELLED", "Artwork operation was cancelled.");
  if (running.has(key)) throw new BridgeError("BUSY", "Another artwork operation is running in this project.");
  running.add(key);
  try {
    const input = JSON.stringify({ ...params, op, project: key });
    if (Buffer.byteLength(input) > 512_000) throw new BridgeError("INVALID_PARAMS", "Artwork request exceeds 512 KB.");
    return await new Promise((resolve, reject) => {
      const env: NodeJS.ProcessEnv = {};
      for (const k of ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT", "WINDIR", "LANG", "LC_ALL", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) {
        if (process.env[k] !== undefined) env[k] = process.env[k];
      }
      const python = process.env.GODOT_LOOP_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
      const child = spawn(python, ["-B", "-E", worker], { cwd: key, shell: false, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      let out = "", stderr = "", bytes = 0, failure: BridgeError | undefined;
      const stop = (e: BridgeError) => { failure ??= e; child.kill("SIGKILL"); };
      const abort = () => stop(new BridgeError("CANCELLED", "Artwork operation was cancelled.", "Originals are unchanged; an interrupted stage is not a completed build."));
      const timer = setTimeout(() => stop(new BridgeError("TIMEOUT", "Artwork worker timed out.", "Inspect any incomplete stage; do not call it a successful build.")), op === "build" ? 120_000 : 30_000);
      signal?.addEventListener("abort", abort, { once: true });
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
      child.stdout.on("data", (buf: Buffer) => {
        bytes += buf.length;
        if (bytes > (op === "preview" ? 6_000_000 : 512_000)) stop(new BridgeError("BAD_RESPONSE", "Artwork worker exceeded its response limit."));
        else out += buf.toString("utf8");
      });
      child.stderr.on("data", (buf: Buffer) => { if (stderr.length < 4000) stderr += buf.toString("utf8").slice(0, 4000 - stderr.length); });
      child.stdin.on("error", () => { /* Early process exit is handled by close/error. */ });
      child.once("error", () => { cleanup(); reject(new BridgeError("DEPENDENCY_MISSING", "Cannot start Python for artwork tools.", "Install Python 3.11+/Pillow 13.0.0, or set GODOT_LOOP_PYTHON in the server's own environment. Existing non-art tools do not need it.")); });
      child.once("close", (code) => {
        cleanup();
        if (failure) return reject(failure);
        try {
          const result = JSON.parse(out) as { ok?: boolean; result?: unknown; code?: string; message?: string };
          if (code !== 0 || result.ok !== true) throw new BridgeError(result.code ?? "BAD_RESPONSE", result.message ?? "Artwork worker failed.");
          resolve(result.result);
        } catch (e) { reject(e instanceof BridgeError ? e : new BridgeError("BAD_RESPONSE", `Invalid artwork worker response (exit ${code}). ${stderr}`)); }
      });
      child.stdin.end(input);
      if (signal?.aborted) abort();
    });
  } finally { running.delete(key); }
}

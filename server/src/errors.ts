/**
 * Error raised for any failure talking to the Godot addon. `code` is either a
 * bridge protocol code from the addon (e.g. NODE_NOT_FOUND) or a client-side
 * code: GODOT_NOT_RUNNING, NOT_CONNECTED, DISCONNECTED, TIMEOUT, BAD_RESPONSE.
 */
export class BridgeError extends Error {
  readonly code: string;
  readonly hint?: string;

  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    if (hint !== undefined) this.hint = hint;
  }
}

export interface ToolTextResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/** Converts any thrown value into an MCP tool error result the model can act on. */
export function toToolError(err: unknown): ToolTextResult {
  if (err instanceof BridgeError) {
    const lines = [`Error ${err.code}: ${err.message}`];
    if (err.hint) lines.push(`Hint: ${err.hint}`);
    return { isError: true, content: [{ type: "text", text: lines.join("\n") }] };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text", text: `Error INTERNAL: ${msg}` }] };
}

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { toToolError } from "../errors.js";

export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Wraps a tool body so every failure becomes an actionable MCP error result. */
export function safe<A, E = unknown>(
  fn: (args: A, extra: E) => Promise<CallToolResult>,
): (args: A, extra: E) => Promise<CallToolResult> {
  return async (args: A, extra: E) => {
    try {
      return await fn(args, extra);
    } catch (e) {
      return toToolError(e) as CallToolResult;
    }
  };
}

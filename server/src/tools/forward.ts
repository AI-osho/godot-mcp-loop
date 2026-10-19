import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ZodRawShape } from "zod";
import type { GodotConnection } from "../connection.js";
import { jsonResult, safe } from "./helpers.js";

export interface ForwardToolDef {
  /** MCP tool name, e.g. "node_add". */
  name: string;
  /** Bridge method, e.g. "node.add". */
  method: string;
  title: string;
  description: string;
  input: ZodRawShape;
  readOnly?: boolean;
  destructive?: boolean;
  timeoutMs?: number;
  /** Per-call timeout derived from the arguments (wins over timeoutMs). */
  timeoutFor?: (args: Record<string, unknown>) => number;
  /** Runs before forwarding; throw a BridgeError to reject the call. */
  check?: (args: Record<string, unknown>) => void;
  /** Post-processes the addon's result (e.g. to add warnings). */
  after?: (result: unknown, args: Record<string, unknown>, conn: GodotConnection) => unknown;
}

export function dropUndefined(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
}

/**
 * An argument the tool does not declare is an error, not something to drop:
 * passing `method` to `game_query` (which takes `properties`) used to look like
 * it worked while the value was ignored. A strict object makes the SDK reject it.
 */
function strictSchema(shape: ZodRawShape) {
  return z.strictObject(shape);
}

/** Registers a tool whose arguments are forwarded verbatim to one bridge method. */
export function registerForwardTool(server: McpServer, conn: GodotConnection, def: ForwardToolDef): void {
  server.registerTool(
    def.name,
    {
      title: def.title,
      description: def.description,
      inputSchema: strictSchema(def.input),
      annotations: {
        readOnlyHint: def.readOnly ?? false,
        destructiveHint: def.destructive ?? false,
        openWorldHint: false,
      },
    },
    safe(async (args: Record<string, unknown>) => {
      const clean = dropUndefined(args ?? {});
      def.check?.(clean);
      const timeoutMs = def.timeoutFor ? def.timeoutFor(clean) : def.timeoutMs;
      const result = await conn.call(def.method, clean, timeoutMs !== undefined ? { timeoutMs } : {});
      return jsonResult(def.after ? def.after(result, clean, conn) : result);
    }),
  );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
}

export function dropUndefined(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
}

/** Registers a tool whose arguments are forwarded verbatim to one bridge method. */
export function registerForwardTool(server: McpServer, conn: GodotConnection, def: ForwardToolDef): void {
  server.registerTool(
    def.name,
    {
      title: def.title,
      description: def.description,
      inputSchema: def.input,
      annotations: {
        readOnlyHint: def.readOnly ?? false,
        destructiveHint: def.destructive ?? false,
        openWorldHint: false,
      },
    },
    safe(async (args: Record<string, unknown>) => {
      const clean = dropUndefined(args ?? {});
      const timeoutMs = def.timeoutFor ? def.timeoutFor(clean) : def.timeoutMs;
      return jsonResult(await conn.call(def.method, clean, timeoutMs !== undefined ? { timeoutMs } : {}));
    }),
  );
}

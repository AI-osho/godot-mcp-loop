import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { GodotConnection } from "../src/connection.js";
import { createServer } from "../src/server.js";

/** Wires an in-memory MCP client to a server built on the given connection. */
export async function connectClient(conn: GodotConnection): Promise<Client> {
  const server = createServer(conn);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(ct);
  return client;
}

export function textOf(result: unknown): string {
  const r = result as { content: Array<{ type: string; text?: string }> };
  return r.content.map((c) => c.text ?? "").join("\n");
}

export function jsonOf(result: unknown): any {
  return JSON.parse(textOf(result));
}

import { expect, it } from "vitest";
import { GodotConnection } from "../src/connection.js";
import { connectClient } from "./helpers.js";

it("does not label arbitrary method conditions read-only", async () => {
  const client = await connectClient(new GodotConnection({ projectPath: "/unused" }));
  try {
    const { tools } = await client.listTools();
    const wait = tools.find(t => t.name === "game_wait_for");
    expect(wait?.annotations?.readOnlyHint).toBe(false);
  } finally { await client.close(); }
});

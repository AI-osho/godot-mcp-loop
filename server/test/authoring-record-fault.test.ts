import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { GodotConnection } from "../src/connection.js";
import { connectClient, textOf } from "./helpers.js";

const fault = vi.hoisted(() => ({ armed: false, partialBytes: 0 }));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
    if (fault.armed) {
      fault.armed = false;
      const [path, data, options] = args;
      const bytes = typeof data === "string" ? Buffer.from(data) : Buffer.from(data as Uint8Array);
      const partial = bytes.subarray(0, 11);
      fs.writeFileSync(path, partial, options); fault.partialBytes = partial.length;
      throw Object.assign(new Error("controlled partial write: ENOSPC"), { code: "ENOSPC" });
    }
    return fs.writeFileSync(...args);
  } };
});

it("a real partial write at the mocked storage seam leaves no final record and permits the same revision retry", async () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "gml-art-record-fault-")));
  const conn = new GodotConnection({ projectPath: project }); const client = await connectClient(conn);
  const brief = { title: "Storage fault fixture", goal: "Atomic append-only JSON", controls: "Keys", art_direction: "Original illustration",
    scenes: [{ id: "scene", description: "Scene", assets: ["actor"] }],
    assets: [{ id: "actor", role: "character", description: "Actor", references: [] }] };
  try {
    fault.armed = true;
    const failed = await client.callTool({ name: "production_plan", arguments: { path: "res://production/plan.json", brief } });
    expect(failed.isError, textOf(failed)).toBe(true); expect(fault.partialBytes).toBe(11);
    expect(existsSync(join(project, "production/plan.json"))).toBe(false);
    expect(readdirSync(join(project, "production"))).toEqual([]);
    const retry = await client.callTool({ name: "production_plan", arguments: { path: "res://production/plan.json", brief } });
    expect(retry.isError, textOf(retry)).toBeFalsy();
    expect(JSON.parse(readFileSync(join(project, "production/plan.json"), "utf8")).brief).toEqual(brief);
    expect(readdirSync(join(project, "production"))).toEqual(["plan.json"]);
  } finally { fault.armed = false; await client.close(); conn.close(); rmSync(project, { recursive: true, force: true }); }
});

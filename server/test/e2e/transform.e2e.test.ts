import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectClient, jsonOf, textOf } from "../helpers.js";
import { startHeadlessEditor, type GodotHarness } from "./godot-harness.js";

/** 3D values through the real bridge: read a Transform3D as JSON, write one back, compare a member. */
const SCENE = `[gd_scene format=3]

[node name="Main" type="Node3D"]

[node name="Body" type="Node3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0)
`;

describe("e2e: 3D values", () => {
  let h: GodotHarness;
  let client: Client;

  async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const res = await client.callTool({ name, arguments: args });
    if (res.isError) throw new Error(`${name}: ${textOf(res)}`);
    return jsonOf(res);
  }

  beforeAll(async () => {
    h = await startHeadlessEditor({
      extraFiles: { "scene.tscn": SCENE },
      applicationExtra: ['run/main_scene="res://scene.tscn"'],
      projectGodotExtra: ["[editor]", "", 'run/main_run_args="--headless"', ""].join("\n"),
    });
    client = await connectClient(h.conn);
  }, 120_000);
  afterAll(async () => {
    await client?.close();
    await h?.stop();
  });

  it("reads a Transform3D as a JSON object with origin and basis columns", async () => {
    await call("game_run");
    const q = await call("game_query", { node: "Body", properties: ["transform"] });
    expect(q.properties.transform).toEqual({
      origin: [0, 0, 0],
      basis: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
    });
    await call("game_stop");
  }, 60_000);

  it("writes a Transform3D and reads a member path back", async () => {
    await call("game_run");
    const set = await call("game_set", {
      node: "Body",
      properties: {
        transform: { origin: [1, 2, 3], basis: { x: [0, 1, 0], y: [-1, 0, 0], z: [0, 0, 1] } },
      },
    });
    expect(set.changes.transform.after.origin).toEqual([1, 2, 3]);
    const q = await call("game_query", { node: "Body", properties: ["transform:origin:y", "transform:basis:x"] });
    expect(q.properties["transform:origin:y"]).toBe(2);
    expect(q.properties["transform:basis:x"]).toEqual([0, 1, 0]);
    // A condition compares a member without converting anything by hand.
    const cond = await call("game_wait_for", { node: "Body", property: "transform:origin:y", op: "==", value: 2, timeout_ms: 0 });
    expect(cond.met).toBe(true);
    await call("game_stop");
  }, 60_000);
});

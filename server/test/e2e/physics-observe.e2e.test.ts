import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectClient, jsonOf, textOf } from "../helpers.js";
import { startHeadlessEditor, type GodotHarness } from "./godot-harness.js";

/** A ball over a floor, seen by a camera: the 3D observations the trial had to hand-roll. */
const SCENE = `[gd_scene format=3]

[sub_resource type="BoxShape3D" id="floor_shape"]
size = Vector3(10, 1, 10)

[sub_resource type="SphereShape3D" id="ball_shape"]
radius = 0.5

[node name="Main" type="Node3D"]

[node name="Floor" type="StaticBody3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, -0.5, 0)

[node name="Shape" type="CollisionShape3D" parent="Floor"]
shape = SubResource("floor_shape")

[node name="Ball" type="RigidBody3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0)
contact_monitor = true
max_contacts_reported = 4

[node name="Shape" type="CollisionShape3D" parent="Ball"]
shape = SubResource("ball_shape")

[node name="Camera3D" type="Camera3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 8)
current = true
`;

describe("e2e: 3D observation (in view, rays, contacts)", () => {
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
  afterEach(async () => {
    // Leave no game behind for the next test, even when an assertion failed.
    await client?.callTool({ name: "game_stop", arguments: {} }).catch(() => undefined);
  });

  afterAll(async () => {
    await client?.close();
    await h?.stop();
  });

  it("tells whether a node is in the camera's view, and where", async () => {
    await call("game_run");
    const seen = await call("game_in_view", { node: "Ball" });
    expect(seen.in_view).toBe(true);
    expect(seen.behind).toBe(false);
    expect(seen.viewport).toEqual([1152, 648]);
    expect(Math.abs(seen.screen[0] - 576)).toBeLessThan(6); // roughly the centre
    await call("game_set", { node: "Ball", properties: { position: [0, 2, 20] } });
    const hidden = await call("game_in_view", { node: "Ball" });
    expect(hidden.in_view).toBe(false);
    expect(hidden.behind).toBe(true);
    await call("game_stop");
  }, 60_000);

  it("casts world-space rays and reports the hit", async () => {
    await call("game_run");
    // The ball is in the path, so exclude it (the same recipe as a grounding ray under the player).
    const down = await call("game_ray", { from: [0, 5, 0], to: [0, -5, 0], exclude: "Ball" });
    expect(down.hit).toBe(true);
    expect(down.collider).toContain("Floor");
    expect(down.position[1]).toBeCloseTo(0, 1);
    expect(down.normal[1]).toBeCloseTo(1, 1);
    const miss = await call("game_ray", { from: [20, 5, 0], to: [20, -5, 0] });
    expect(miss.hit).toBe(false);
    await call("game_stop");
  }, 60_000);

  it("lists a resting body's contacts", async () => {
    await call("game_run");
    await call("game_wait_for", { node: "Ball", property: "position:y", op: "<=", value: 0.55, timeout_ms: 5000 });
    const c = await call("game_contacts", { node: "Ball" });
    expect(c.contacts.length).toBeGreaterThanOrEqual(1);
    expect(c.contacts[0].collider).toContain("Floor");
    expect(c.contacts[0].normal[1]).toBeGreaterThan(0.5); // pointing up
    await call("game_stop");
  }, 60_000);
});

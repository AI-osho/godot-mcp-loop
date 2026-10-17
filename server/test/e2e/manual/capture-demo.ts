/**
 * Manual helper (not a test): launches a headless editor with the platformer,
 * runs the game in a window, moves + jumps, and saves a screenshot.
 * Usage: npx tsx test/e2e/manual/capture-demo.ts <out.png>
 */
import { writeFileSync } from "node:fs";

const out = process.argv[2] ?? "demo.png";
process.env.E2E_GAME_WINDOW = "1";
const { PLATFORMER_PROJECT, startHeadlessEditor } = await import("../godot-harness.js");
const h = await startHeadlessEditor(PLATFORMER_PROJECT);
try {
  await h.conn.call("game.run", {}, { timeoutMs: 30000 });
  await h.conn.call("game.wait_for", { node: "Player", property: "position:y", op: ">=", value: 370, timeout_ms: 5000 }, { timeoutMs: 10000 });
  await h.conn.call("game.input", { steps: [{ action: "move_right", hold_ms: 1200 }, { action: "jump", hold_ms: 100 }, { wait_ms: 150 }] }, { timeoutMs: 10000 });
  const r = (await h.conn.call("screenshot", { max_width: 960 }, { timeoutMs: 20000 })) as { png_base64: string; width: number; height: number };
  writeFileSync(out, Buffer.from(r.png_base64, "base64"));
  console.log(`saved ${out} ${r.width}x${r.height}`);
  await h.conn.call("game.stop");
} finally {
  await h.stop();
}

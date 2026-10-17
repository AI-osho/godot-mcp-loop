/** Manual probe: two editors launching games at the same time — does each game reach its own editor? */
import { PLATFORMER_PROJECT, startHeadlessEditor } from "../godot-harness.js";
const [a, b] = await Promise.all([startHeadlessEditor(PLATFORMER_PROJECT), startHeadlessEditor(PLATFORMER_PROJECT)]);
try {
  const results = await Promise.allSettled([
    a.conn.call("game.run", { timeout_ms: 15000 }, { timeoutMs: 20000 }),
    b.conn.call("game.run", { timeout_ms: 15000 }, { timeoutMs: 20000 }),
  ]);
  results.forEach((r, i) => console.log(i, r.status, r.status === "fulfilled" ? JSON.stringify(r.value) : (r.reason as Error).message));
  for (const h of [a, b]) console.log(h.output.filter((l) => /port|listen|debug/i.test(l)).slice(0, 5).join(" | "));
} finally {
  await Promise.all([a.stop(), b.stop()]);
}

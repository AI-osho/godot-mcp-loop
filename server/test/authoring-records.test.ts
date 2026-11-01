import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GodotConnection } from "../src/connection.js";
import { connectClient, jsonOf, textOf } from "./helpers.js";

const brief = {
  title: "原画制作の確認", goal: "人物と背景を分けてゲームへ取り込む", controls: "矢印で移動",
  art_direction: "青い夜、暖かい工房の光。人物の足元と背景の縮尺を揃える。",
  scenes: [{ id: "workshop", description: "工房前", assets: ["bot"] }],
  assets: [{ id: "bot", role: "character", description: "独立した作業ロボット", references: [] }],
};

describe("production records through the real MCP boundary", () => {
  let project: string;
  let conn: GodotConnection;
  let client: Client;
  beforeEach(async () => {
    project = realpathSync(mkdtempSync(join(tmpdir(), "gml-authoring-")));
    conn = new GodotConnection({ projectPath: project });
    client = await connectClient(conn);
  });
  afterEach(async () => {
    await client?.close(); conn?.close();
    rmSync(project, { recursive: true, force: true });
  });

  it("teaches the artwork order and distinguishes generated exports from editor undo", () => {
    const instructions = client.getInstructions() ?? "";
    for (const name of ["production_plan", "art_request", "art_register", "asset_build", "asset_preview", "asset_verify", "asset_scene_add"]) expect(instructions).toContain(name);
    expect(instructions).toContain("does not generate images");
    expect(instructions).toContain("append-only");
    expect(instructions).toContain("ordinary input");
  });

  it.each(["res://../outside.yaml", "res://.git/config", "res://Addons/route.yaml"])("refuses unsafe verification-scenario metadata %s before publishing a plan", async (scenario) => {
    const result = await client.callTool({ name: "production_plan", arguments: { path: "res://plan.json", brief: { ...brief, verification_scenarios: [scenario] } } });
    expect(result.isError).toBe(true); expect(textOf(result)).toMatch(/PATH_FORBIDDEN/);
    expect(existsSync(join(project, "plan.json"))).toBe(false);
  });

  it("creates a production brief without needing a running editor", async () => {
    const result = await client.callTool({ name: "production_plan", arguments: { path: "res://production/plan.json", brief } });
    expect(result.isError, textOf(result)).toBeFalsy();
    const saved = jsonOf(result);
    expect(saved.path).toBe("res://production/plan.json");
    expect(saved.document.schema).toBe("godot-loop-production/v1");
    expect(JSON.parse(readFileSync(join(project, "production/plan.json"), "utf8")).brief).toEqual(brief);
    expect(existsSync(join(project, ".godot"))).toBe(false);
  });

  it("rejects repeated asset IDs before writing a plan", async () => {
    const result = await client.callTool({ name: "production_plan", arguments: {
      path: "res://bad.json", brief: { ...brief, assets: [brief.assets[0], brief.assets[0]] },
    } });
    expect(result.isError).toBe(true);
    expect(existsSync(join(project, "bad.json"))).toBe(false);
  });

  it("rejects unknown scene asset references before writing", async () => {
    const result = await client.callTool({ name: "production_plan", arguments: {
      path: "res://bad.json", brief: { ...brief, scenes: [{ id: "scene", description: "unknown", assets: ["missing"] }] },
    } });
    expect(result.isError).toBe(true);
    expect(existsSync(join(project, "bad.json"))).toBe(false);
  });

  it("rejects a derived request over its consumer prompt limit without publishing an unreadable record", async () => {
    const scenes = Array.from({ length: 64 }, (_, i) => ({ id: `scene_${i}`, description: "x".repeat(2000), assets: ["bot"] }));
    const plan = await client.callTool({ name: "production_plan", arguments: { path: "res://large-plan.json", brief: { ...brief, scenes } } });
    expect(plan.isError, textOf(plan)).toBeFalsy();
    const request = await client.callTool({ name: "art_request", arguments: { plan: "res://large-plan.json", asset_id: "bot", path: "res://large-request.json" } });
    expect(request.isError, textOf(request)).toBe(true);
    expect(textOf(request)).toContain("INVALID_PARAMS");
    expect(existsSync(join(project, "large-request.json"))).toBe(false);
  });

  it("prepares a model-pinned request without claiming an image was generated", async () => {
    await client.callTool({ name: "production_plan", arguments: { path: "res://plan.json", brief } });
    const result = await client.callTool({ name: "art_request", arguments: {
      plan: "res://plan.json", asset_id: "bot", path: "res://requests/bot-01.json", size: "1920x1080",
    } });
    expect(result.isError, textOf(result)).toBeFalsy();
    const doc = jsonOf(result).document;
    expect(doc.generation).toEqual({ provider: "openai-codex", model: "gpt-image-2-medium", quality: "medium", size: "1920x1080" });
    expect(doc.status).toBe("awaiting_external_image");
    expect(doc.prompt).toContain(brief.art_direction);
    expect(doc.prompt).toContain(brief.assets[0]!.description);
    expect(doc.plan.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(jsonOf(result).next_step).toMatch(/existing.*image/i);
  });

  it("records real PNG dimensions and keeps requested medium distinct from reported low", async () => {
    await client.callTool({ name: "production_plan", arguments: { path: "res://plan.json", brief } });
    await client.callTool({ name: "art_request", arguments: { plan: "res://plan.json", asset_id: "bot", path: "res://request.json" } });
    const { encodePng } = await import("../src/media/png.js");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(project, "source.png"), encodePng({ width: 8, height: 12, data: new Uint8Array(8 * 12 * 4).fill(255) }));
    const result = await client.callTool({ name: "art_register", arguments: {
      request: "res://request.json", png: "res://source.png", path: "res://accepted.json", reported_quality: "low", decision: "accepted",
    } });
    expect(result.isError, textOf(result)).toBeFalsy();
    const doc = jsonOf(result).document;
    expect(doc.image).toMatchObject({ path: "res://source.png", width: 8, height: 12 });
    expect(doc.generation.requested.quality).toBe("medium");
    expect(doc.generation.reported).toEqual({ quality: "low", model: null });
    expect(doc.image.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(doc.decision).toBe("accepted");
  });

  it("retains a raw producer response file by exact bytes without inferring missing reported quality", async () => {
    await client.callTool({ name: "production_plan", arguments: { path: "res://plan.json", brief } });
    await client.callTool({ name: "art_request", arguments: { plan: "res://plan.json", asset_id: "bot", path: "res://request.json" } });
    const { encodePng } = await import("../src/media/png.js"); const { writeFileSync } = await import("node:fs");
    writeFileSync(join(project, "source.png"), encodePng({ width: 8, height: 12, data: new Uint8Array(8 * 12 * 4).fill(255) }));
    writeFileSync(join(project, "response.json"), '{"quality":"low"}\n');
    const r = await client.callTool({ name: "art_register", arguments: { request: "res://request.json", png: "res://source.png", path: "res://record.json", response_file: "res://response.json", decision: "accepted" } });
    expect(r.isError, textOf(r)).toBeFalsy();
    expect(jsonOf(r).document.response).toMatchObject({ path: "res://response.json" });
    expect(jsonOf(r).document.response.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(jsonOf(r).document.generation.reported.quality).toBeNull();
  });
});

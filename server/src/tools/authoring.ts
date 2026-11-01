import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GodotConnection } from "../connection.js";
import { artRegister, artRequest, productionPlan } from "../authoring/records.js";
import { Brief, BuildOutputs, BuildRoot, Id, NodeName, Placement, Recipe, ResPath } from "../authoring/schemas.js";
import { assetPath, readDocument } from "../authoring/records.js";
import { BridgeError } from "../errors.js";
import { runWorker } from "../authoring/worker.js";
import { jsonResult, safe, strict } from "./helpers.js";

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;
const ArtworkTarget = z.strictObject({ epoch: z.string().regex(/^[a-f0-9]{32}$/),
  root_id: z.string().regex(/^[0-9]+$/).max(24), parent_id: z.string().regex(/^[0-9]+$/).max(24), scene_path: z.string().max(4096) });

async function artworkOperation<T>(conn: GodotConnection, extra: Extra, run: () => Promise<T>): Promise<T> {
  return conn.withProjectLease(async () => {
    const token = extra._meta?.progressToken;
    const started = Date.now();
    const heartbeat = () => extra.sendNotification({ method: "notifications/progress", params: {
      progressToken: token!, progress: (Date.now() - started) / 1000,
      message: "Artwork operation: elapsed seconds, not completion percentage. No image-model call is being made.",
    } }).catch(() => undefined);
    const timer = token === undefined ? undefined : setInterval(() => { void heartbeat(); }, 2000);
    try { return await run(); }
    finally { if (timer !== undefined) clearInterval(timer); }
  });
}

export function registerAuthoringTools(server: McpServer, conn: GodotConnection): void {
  server.registerTool("production_plan", {
    title: "Record production brief",
    description: "Save a game's goal, controls, art direction, scenes and separate artwork requirements in a new project-local JSON record. Does not generate art, code or a game. Existing records are never overwritten; choose a new revision path. Works without an editor. Use art_request next.",
    inputSchema: strict({ path: ResPath, brief: Brief, dry_run: z.boolean().optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, safe(async (args) => jsonResult(productionPlan(conn.projectPath, args.path, args.brief, args.dry_run))));
  server.registerTool("art_request", {
    title: "Prepare approved artwork request",
    description: "Prepare a separate artwork request from production_plan: references, scene context and focused corrections. Pins existing openai-codex / gpt-image-2-medium, medium requested. Does NOT generate an image or access credentials; pass the returned brief to your existing authorized image tool, then art_register its real PNG. Refuses unknown asset IDs and existing output records.",
    inputSchema: strict({ plan: ResPath, asset_id: Id, path: ResPath,
      size: z.string().regex(/^(auto|[1-9][0-9]{1,3}x[1-9][0-9]{1,3})$/).optional(),
      correction: z.string().max(4000).optional(), dry_run: z.boolean().optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, safe(async (args) => jsonResult(artRequest(conn.projectPath, args))));
  server.registerTool("art_register", {
    title: "Record returned PNG artwork",
    description: "Decode a real project-local PNG and record its actual dimensions and stored-byte hash, linked to art_request. Keep requested quality separate from reported_quality (omitted = unknown); reported model/quality are producer claims, not billing, rights or independent model proof. Does not generate art or overwrite originals/records. Requires Python 3/Pillow for PNG inspection.",
    inputSchema: strict({ request: ResPath, png: ResPath, path: ResPath,
      reported_quality: z.enum(["low", "medium", "high"]).optional(), reported_model: z.string().min(1).max(160).optional(), response_file: ResPath.optional(),
      decision: z.enum(["accepted", "needs_revision", "rejected"]), notes: z.string().max(4000).optional(), dry_run: z.boolean().optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, safe(async (args, extra: Extra) => artworkOperation(conn, extra,async () => jsonResult(await artRegister(conn.projectPath, args, extra.signal)))));
  server.registerTool("asset_build", {
    title: "Build game assets from artwork",
    description: "Process real project-local PNG artwork with a declarative recipe. Pose fitting uses explicit frame_size, foot_anchor and target_height; key is magenta or none. A magenta crop must have empty gutters. Writes only a NEW res://assets/generated/<unique-id> folder, never originals or an existing build. Requires Python 3.11+/Pillow 13.0.0; no model calls or shell. Use asset_verify, asset_preview and asset_scene_add next.",
    inputSchema: strict({ output_root: BuildRoot, recipe: Recipe, dry_run: z.boolean().optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, safe(async (args, extra: Extra) => artworkOperation(conn, extra,async () => {
    assetPath(conn.projectPath, args.output_root, true);
    for (const asset of args.recipe.assets) assetPath(conn.projectPath, asset.source);
    return jsonResult(await runWorker(conn.projectPath, "build", args, extra.signal));
  })));
  server.registerTool("asset_verify", {
    title: "Verify artwork build provenance",
    description: "Read-only check of a completed asset_build manifest: exact source/output bytes, frame inventory, processing code and unexpected files. Changed/missing artifacts return passed:false (a domain report, not a tool error). Normal Godot PNG .import sidecars are allowed, symlinks are not. Not an authenticity, commercial-rights or malicious-same-user guarantee.",
    inputSchema: strict({ manifest: ResPath }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, safe(async (args, extra: Extra) => artworkOperation(conn, extra,async () => {
    assetPath(conn.projectPath, args.manifest);
    return jsonResult(await runWorker(conn.projectPath, "verify", args, extra.signal));
  })));
  server.registerTool("asset_preview", {
    title: "Preview processed artwork",
    description: "Return an asset_build output as an MCP PNG image, optionally one zero-based atlas frame, after verifying source/output provenance. This is a processed-artwork preview, NOT a Godot screenshot; use screenshot after asset_scene_add for engine verification. Nearest-neighbour thumbnail, max_size 64..1024 (default 512), originals unchanged.",
    inputSchema: strict({ manifest: ResPath, asset_id: Id, frame: z.number().int().min(0).max(63).optional(), max_size: z.number().int().min(64).max(1024).optional() }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, safe(async (args, extra: Extra) => artworkOperation(conn, extra,async () => {
    assetPath(conn.projectPath, args.manifest);
    const preview = await runWorker(conn.projectPath, "preview", args, extra.signal) as { data: string; caption: string; width: number; height: number; original_size: number[]; source_sha256: string };
    return { content: [{ type: "text" as const, text: JSON.stringify({ caption: preview.caption, width: preview.width, height: preview.height, original_size: preview.original_size, source_sha256: preview.source_sha256 }) },
      { type: "image" as const, data: preview.data, mimeType: "image/png" }] };
  })));
  server.registerTool("asset_scene_add", {
    title: "Place verified artwork in the edited scene",
    description: "Verify an asset_build manifest, then add explicit 2D placements under one NEW Node2D group in the current scene. Single PNGs become Sprite2D; atlases become standard AnimatedSprite2D/SpriteFrames, with frame and optional play. Position is the recorded anchor (feet for poses); uniform scale, z_index and nearest filtering are explicit. All placements validate first; dry_run does not change the scene, and one edit_undo removes this group only. Does not infer collisions, write game rules or save the scene; call scene_save, game_run and screenshot/scenario_run to verify.",
    inputSchema: strict({ manifest: ResPath, parent: z.string().max(512).optional(), name: NodeName.optional(), placements: z.array(Placement).min(1).max(64), dry_run: z.boolean().optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, safe(async (args, extra: Extra) => artworkOperation(conn, extra,async () => {
    assetPath(conn.projectPath, args.manifest);
    // Capture the actual native target before the worker can yield to scene changes.
    let target: z.infer<typeof ArtworkTarget> | undefined;
    let targetFailure: unknown;
    try { target = ArtworkTarget.parse(await conn.call("asset.scene_target", { parent: args.parent ?? "." })); }
    catch (error) { targetFailure = error; }
    const verified = await runWorker(conn.projectPath, "verify", { manifest: args.manifest }, extra.signal) as { passed: boolean; manifest_sha256: string; failures: string[] };
    if (!verified.passed) throw new BridgeError("ARTIFACT_CHANGED", verified.failures.join("; "), "Rebuild under a new ID before importing.");
    const build = readDocument(conn.projectPath, args.manifest, BuildOutputs);
    if (build.sha256 !== verified.manifest_sha256) throw new BridgeError("ARTIFACT_CHANGED", "Manifest changed during validation.");
    const ids = new Set(args.placements.map((p) => p.asset_id));
    if ([...ids].some((id) => !build.document.outputs.some((a) => a.id === id))) throw new BridgeError("INVALID_PARAMS", "Placement references an unknown exported asset ID.");
    if (target === undefined) throw targetFailure;
    const clean = { assets: build.document.outputs.filter((a) => ids.has(a.id)), placements: args.placements,
      parent: args.parent ?? ".", name: args.name ?? "Artwork", dry_run: args.dry_run ?? false, expected_target: target };
    if (extra.signal.aborted) throw new BridgeError("CANCELLED", "Artwork import was cancelled before dispatch.");
    return jsonResult(await conn.call("asset.scene_add", clean, { timeoutMs: 120_000 }));
  })));
}

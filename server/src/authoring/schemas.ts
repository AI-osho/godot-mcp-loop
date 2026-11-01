import { z } from "zod";

export const Id = z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/);
export const ResPath = z.string().min(7).max(512).startsWith("res://");
export const Size = z.tuple([z.number().int().min(1).max(4096), z.number().int().min(1).max(4096)]);
export const Point = z.tuple([z.number().int().min(0).max(4096), z.number().int().min(0).max(4096)]);
export const Brief = z.strictObject({
  title: z.string().min(1).max(160), goal: z.string().min(1).max(4000),
  controls: z.string().max(2000), art_direction: z.string().min(1).max(8000),
  scenes: z.array(z.strictObject({ id: Id, description: z.string().max(2000), assets: z.array(Id).max(128) })).min(1).max(64),
  assets: z.array(z.strictObject({
    id: Id, role: z.enum(["background", "character", "prop", "state", "ui"]),
    description: z.string().min(1).max(4000), references: z.array(ResPath).max(16),
    frame_size: Size.optional(), foot_anchor: Point.optional(),
  })).min(1).max(128),
  verification_scenarios: z.array(ResPath).max(50).optional(),
});
export const ProductionDocument = z.strictObject({ schema: z.literal("godot-loop-production/v1"), brief: Brief });
export const IMAGE_POLICY = Object.freeze({ provider: "openai-codex", model: "gpt-image-2-medium", quality: "medium" });
const SourceFields = { id: Id, source: ResPath, art_record: ResPath.optional(), export: z.boolean().optional() };
const ProcessFields = { ...SourceFields, key: z.enum(["magenta", "none"]),
  crop: z.tuple([z.number().int().min(0).max(16384), z.number().int().min(0).max(16384), z.number().int().min(1).max(16384), z.number().int().min(1).max(16384)]).optional() };
export const RecipeAsset = z.discriminatedUnion("fit", [
  z.strictObject({ ...ProcessFields, fit: z.literal("pose"), frame_size: Size, foot_anchor: Point, target_height: z.number().int().min(1).max(4096) }),
  z.strictObject({ ...ProcessFields, fit: z.literal("icon"), frame_size: Size, target_extent: z.number().int().min(1).max(4096) }),
  z.strictObject({ ...ProcessFields, fit: z.literal("scaled"), frame_size: Size,
    scale: z.number().positive().max(16).optional(), scale_group: Id.optional(), foot_y: z.number().int().min(0).max(4096).optional(),
  }).refine((a) => (a.scale === undefined) !== (a.scale_group === undefined), { error: "Give exactly one scale or scale_group." }),
  z.strictObject({ ...SourceFields, fit: z.literal("copy"), key: z.literal("none"), foot_anchor: Point.optional() }),
]);
export const Recipe = z.strictObject({ version: z.literal(1), assets: z.array(RecipeAsset).min(1).max(64),
  scale_groups: z.array(z.strictObject({ id: Id, target_height: z.number().int().min(1).max(4096) })).max(16).optional(),
  atlases: z.array(z.strictObject({ id: Id, frames: z.array(Id).min(1).max(64), fps: z.number().positive().max(120).optional(), loop: z.boolean().optional() })).max(16).optional(),
});
export const BuildRoot = z.string().regex(/^res:\/\/assets\/generated\/[a-z][a-z0-9_-]{0,47}$/).describe("A new managed folder, res://assets/generated/<unique-id>. Existing folders are refused.");
export const Digest = z.string().regex(/^[a-f0-9]{64}$/);
export const AssetOutput = z.strictObject({
  id: Id, path: ResPath, sha256: Digest, bytes: z.number().int().min(1).max(32_000_000),
  width: z.number().int().min(1).max(16384), height: z.number().int().min(1).max(4096),
  frame_width: z.number().int().min(1).max(4096), frame_height: z.number().int().min(1).max(4096),
  frames: z.number().int().min(1).max(64), anchor: Point,
  animation: z.strictObject({ fps: z.number().positive().max(120), loop: z.boolean() }),
});
// Deliberately projects only the verified outputs; provenance stays in the worker's full manifest check.
export const BuildOutputs = z.object({ schema: z.literal("godot-loop-assets/v1"), complete: z.literal(true), outputs: z.array(AssetOutput).min(1).max(80) });
export const NodeName = z.string().regex(/^[\p{L}_][\p{L}\p{N}_-]{0,63}$/u);
export const Placement = z.strictObject({ asset_id: Id, name: NodeName,
  position: z.tuple([z.number().min(-1_000_000).max(1_000_000), z.number().min(-1_000_000).max(1_000_000)]),
  z_index: z.number().int().min(-4096).max(4096).optional(),
  scale: z.number().positive().max(16).optional(), frame: z.number().int().min(0).max(63).optional(), play: z.boolean().optional(),
});
export const FileIdentity = z.strictObject({ path: ResPath, sha256: Digest });
export const RequestDocument = z.strictObject({
  schema: z.literal("godot-loop-art-request/v1"), status: z.literal("awaiting_external_image"),
  plan: FileIdentity, asset_id: Id, prompt: z.string().max(24000), references: z.array(FileIdentity).max(16),
  generation: z.strictObject({
    provider: z.literal("openai-codex"), model: z.literal("gpt-image-2-medium"), quality: z.literal("medium"),
    size: z.string().regex(/^(auto|[1-9][0-9]{1,3}x[1-9][0-9]{1,3})$/),
  }),
});

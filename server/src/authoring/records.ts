import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { readFileBounded } from "../bounded-io.js";
import { dirname, join } from "node:path";
import type { z } from "zod";
import { BridgeError } from "../errors.js";
import { projectFilePath } from "../project-path.js";
import { Brief, IMAGE_POLICY, ProductionDocument, RequestDocument } from "./schemas.js";
import { runWorker } from "./worker.js";

const PROTECTED = [".git", ".godot", "addons", ".claude", ".github", "node_modules"];
export function assetPath(project: string, path: string, write = false): { abs: string; res: string } {
  if (path.split("/").some((p) => PROTECTED.includes(p.toLowerCase()))) {
    throw new BridgeError("PATH_FORBIDDEN", "Production files cannot access tool, repository, cache or dependency internals.");
  }
  return projectFilePath(project, path, { write, requireRes: true, allowRoot: false, protectedTop: PROTECTED });
}
export const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

export function writeDocument(project: string, path: string, document: object, dryRun = false): object {
  if (!path.endsWith(".json")) throw new BridgeError("INVALID_PARAMS", "Production records must end in .json.");
  const dest = assetPath(project, path, true);
  const bytes = Buffer.from(JSON.stringify(document, null, 2) + "\n");
  if (bytes.length > 512_000) throw new BridgeError("INVALID_PARAMS", "Production record exceeds 512 KB.");
  if (existsSync(dest.abs)) throw new BridgeError("ALREADY_EXISTS", `Record exists: ${path}.`, "Choose a new revision path.");
  if (!dryRun) {
    mkdirSync(dirname(dest.abs), { recursive: true, mode: 0o700 });
    assetPath(project, path, true);
    const temporary = join(dirname(dest.abs), `.gml-art-record-${randomUUID()}.tmp`);
    let owned = false;
    try {
      const fd = openSync(temporary, "wx", 0o600); owned = true;
      try { writeFileSync(fd, bytes); fsyncSync(fd); }
      finally { closeSync(fd); }
      assetPath(project, path, true);
      // Same-directory atomic, exclusive publication; rename would replace a
      // concurrently-created revision. No partial bytes use the final name.
      linkSync(temporary, dest.abs);
    }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new BridgeError("ALREADY_EXISTS", `Record exists: ${path}.`, "Use a new revision path; originals are not overwritten.");
      throw e;
    }
    finally { if (owned) unlinkSync(temporary); }
  }
  return { path: dest.res, document, sha256: sha256(bytes), dry_run: dryRun };
}

function validateBrief(project: string, brief: z.infer<typeof Brief>): void {
  if (new Set(brief.assets.map((a) => a.id)).size !== brief.assets.length) {
    throw new BridgeError("INVALID_PARAMS", "Asset IDs must be unique.");
  }
  if (new Set(brief.scenes.map((s) => s.id)).size !== brief.scenes.length ||
      brief.scenes.some((s) => s.assets.some((id) => !brief.assets.some((a) => a.id === id)))) {
    throw new BridgeError("INVALID_PARAMS", "Scenes need unique IDs and may reference only declared asset IDs.");
  }
  for (const scenario of brief.verification_scenarios ?? []) assetPath(project, scenario);
  for (const asset of brief.assets) {
    for (const reference of asset.references) assetPath(project, reference);
    if (asset.foot_anchor && (!asset.frame_size || asset.foot_anchor.some((v, i) => v > asset.frame_size![i]!))) {
      throw new BridgeError("INVALID_PARAMS", "A foot anchor must fit inside its declared frame.");
    }
  }
 }

export function productionPlan(project: string, path: string, brief: z.infer<typeof Brief>, dryRun = false): object {
  validateBrief(project, brief);
  return writeDocument(project, path, { schema: "godot-loop-production/v1", brief }, dryRun);
}

export function readDocument<T>(project: string, path: string, schema: z.ZodType<T>): { document: T; path: string; sha256: string } {
  const src = assetPath(project, path);
  if (!existsSync(src.abs)) throw new BridgeError("FILE_NOT_FOUND", `Record not found: ${path}.`);
  const bytes = readFileBounded(src.abs, 512_000);
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw new BridgeError("INVALID_DATA", `Invalid JSON record: ${path}.`); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BridgeError("INVALID_DATA", `Invalid record schema: ${path}.`, parsed.error.message);
  return { document: parsed.data, path: src.res, sha256: sha256(bytes) };
}

export function artRequest(project: string, args: { plan: string; asset_id: string; path: string; size?: string; correction?: string; dry_run?: boolean }): object {
  const plan = readDocument(project, args.plan, ProductionDocument);
  validateBrief(project, plan.document.brief);
  const asset = plan.document.brief.assets.find((a) => a.id === args.asset_id);
  if (!asset) throw new BridgeError("INVALID_PARAMS", `Unknown asset ID: ${args.asset_id}.`);
  const references = asset.references.map((path) => {
    const src = assetPath(project, path);
    if (!path.toLowerCase().endsWith(".png")) throw new BridgeError("INVALID_PARAMS", "Artwork references must be project-local PNG files.");
    return { path: src.res, sha256: sha256(readFileBounded(src.abs, 32_000_000)) };
  });
  const prompt = [
    `Original game: ${plan.document.brief.title}`, `Goal: ${plan.document.brief.goal}`,
    `Art direction: ${plan.document.brief.art_direction}`, `Asset ${asset.id} (${asset.role}): ${asset.description}`,
    ...plan.document.brief.scenes.filter((s) => s.assets.includes(asset.id)).map((s) => `Scene ${s.id}: ${s.description}`),
    asset.frame_size ? `Processed game frame: ${asset.frame_size.join("x")}; foot anchor: ${JSON.stringify(asset.foot_anchor ?? null)}. Author detailed source art, not a pre-baked gameplay screenshot.` : "",
    asset.role === "background" ? "Do not bake characters, moving props or game UI into the background." : "Keep the subject separate. For chroma-key sheets use solid magenta and empty gutters; do not cut off any body part.",
    "Original characters and locations only. Do not copy proprietary characters, logos, maps or text.",
    args.correction ? `Focused correction: ${args.correction}` : "",
  ].filter(Boolean).join("\n");
  const document = { schema: "godot-loop-art-request/v1", status: "awaiting_external_image", plan: { path: plan.path, sha256: plan.sha256 },
    asset_id: asset.id, prompt, references, generation: { ...IMAGE_POLICY, size: args.size ?? "auto" } };
  const checked = RequestDocument.safeParse(document);
  if (!checked.success) throw new BridgeError("INVALID_PARAMS", "Derived artwork request exceeds its record limits; no request was written.", "Reduce the selected scene descriptions or correction; context is not silently truncated.");
  return { ...writeDocument(project, args.path, checked.data, args.dry_run),
    next_step: "Use the client's existing authorized image-generation tool with this prompt and references. Keep the returned original PNG inside this project, then call art_register. This call did not generate an image or contact a provider." };
}

export async function artRegister(project: string, args: { request: string; png: string; path: string; reported_quality?: string; reported_model?: string; response_file?: string; decision: string; notes?: string; dry_run?: boolean }, signal?: AbortSignal): Promise<object> {
  const request = readDocument(project, args.request, RequestDocument);
  assetPath(project, args.png);
  assetPath(project, args.path, true);
  let response: { path: string; sha256: string; bytes: number } | null = null;
  if (args.response_file) {
    if (!/\.(json|txt)$/i.test(args.response_file)) throw new BridgeError("INVALID_PARAMS", "Raw response_file must be a project-local .json or .txt record.");
    const src = assetPath(project, args.response_file);
    const bytes = readFileBounded(src.abs, 512_000);
    response = { path: src.res, sha256: sha256(bytes), bytes: bytes.length };
  }
  const image = await runWorker(project, "inspect", { png: args.png }, signal);
  return writeDocument(project, args.path, { schema: "godot-loop-art/v1", request: { path: request.path, sha256: request.sha256 }, asset_id: request.document.asset_id,
    generation: { requested: request.document.generation, reported: { quality: args.reported_quality ?? null, model: args.reported_model ?? null } },
    image, response, decision: args.decision, notes: args.notes ?? "", producer_claims_are_not_independent_model_or_rights_proof: true }, args.dry_run);
}

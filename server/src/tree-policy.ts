import {existsSync} from "node:fs";
import {basename,dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {z} from "zod";
import {readTextFileBounded,FILE_READ_LIMITS} from "./bounded-io.js";
import {BridgeError} from "./errors.js";

export const TREE_NODE_CLASSES=["Node","Node2D","CharacterBody2D","StaticBody2D","Area2D","Sprite2D","CollisionShape2D","Camera2D","CanvasLayer","Control","ColorRect","Label","Button","PanelContainer","MarginContainer","VBoxContainer","HBoxContainer","CenterContainer","GridContainer"] as const;
export const TREE_RESOURCE_CLASSES=["RectangleShape2D","CircleShape2D","CapsuleShape2D","StyleBoxFlat"] as const;
export const TREE_LIMIT_KEYS=["nodes", "depth", "properties_per_node", "properties_total", "resources", "resource_depth", "array_items", "string_bytes", "name_bytes", "path_bytes", "request_bytes", "reply_bytes", "png_references", "png_bytes", "png_side", "png_pixels_total"] as const;
const numeric={min:z.number(),max:z.number(),exclusive_min:z.boolean().optional(),nonzero:z.boolean().optional()};
const Rule=z.discriminatedUnion("kind",[
  z.strictObject({kind:z.literal("bool")}),
  z.strictObject({kind:z.literal("number"),...numeric}),
  z.strictObject({kind:z.literal("int"),...numeric}),
  z.strictObject({kind:z.literal("vector2"),...numeric}),
  z.strictObject({kind:z.literal("enum"),values:z.array(z.number().int()).min(1).max(32)}),
  z.strictObject({kind:z.literal("text")}),
  z.strictObject({kind:z.literal("color")}),
  z.strictObject({kind:z.literal("texture"),nullable:z.boolean()}),
  z.strictObject({kind:z.literal("resource"),classes:z.array(z.enum(TREE_RESOURCE_CLASSES)).min(1).max(4),nullable:z.boolean()}),
]);
const LIMIT_CEILINGS={"nodes": 64, "depth": 8, "properties_per_node": 32, "properties_total": 512, "resources": 64, "resource_depth": 4, "array_items": 64, "string_bytes": 2048, "name_bytes": 64, "path_bytes": 1024, "request_bytes": 131072, "reply_bytes": 131072, "png_references": 16, "png_bytes": 8388608, "png_side": 4096, "png_pixels_total": 16000000} as const;
const Policy=z.strictObject({
  schema_version:z.literal(1),
  limits:z.record(z.enum(TREE_LIMIT_KEYS),z.number().int().positive()),
  nodes:z.record(z.enum(TREE_NODE_CLASSES),z.record(z.string(),Rule)),
  resources:z.record(z.enum(TREE_RESOURCE_CLASSES),z.record(z.string(),Rule)),
  capsule_defaults:z.strictObject({radius:z.number().positive(),height:z.number().positive()}),
});
export type TreePolicy=z.infer<typeof Policy>;
export type TreePropertyRule=z.infer<typeof Rule>;



/** JSON.parse has already checked syntax; retain object key identity before duplicate keys can be lost. */
function uniquePolicyKeys(text:string):void {
  const objects:Array<Set<string>>=[];
  for (let i=0;i<text.length;i++) {
    const c=text[i];
    if (c==="{") objects.push(new Set());
    else if (c==="}") objects.pop();
    else if (c==='"') {
      const start=i++;
      while(i<text.length) {
        if(text[i]==="\\") {i+=2;continue;}
        if(text[i]==='"') break;
        i++;
      }
      let next=i+1;while(next<text.length&&/[ \t\r\n]/.test(text[next]!))next++;
      if(text[next]!==":")continue;
      const key:string=JSON.parse(text.slice(start,i+1));
      const object=objects.at(-1);
      if(!object||object.has(key)||key==="__proto__"||key==="prototype"||key==="constructor")throw new Error("Invalid policy key.");
      object.add(key);
    }
  }
}

/** Pure decoder for fixed installation data; callers cannot select another policy path. */
export function decodeTreePolicy(text:string):TreePolicy {
  try {
    if(Buffer.byteLength(text,"utf8")>FILE_READ_LIMITS.metadata)throw new Error("Oversized policy.");
    const value:unknown=JSON.parse(text);
    uniquePolicyKeys(text);
    const policy=Policy.parse(value);
    for(const key of TREE_LIMIT_KEYS)if(policy.limits[key]>LIMIT_CEILINGS[key])throw new Error("Invalid policy ceiling.");
    for (const properties of [...Object.values(policy.nodes),...Object.values(policy.resources)]) {
      for (const [key,rule] of Object.entries(properties)) {
        if(!/^[a-z][a-z0-9_\/]*$/.test(key)||["name","owner","script","scene_file_path","resource_path","metadata"].includes(key)||key.startsWith("metadata/"))throw new Error("Invalid policy property identity.");
        if(rule.kind==="enum"&&new Set(rule.values).size!==rule.values.length)throw new Error("Duplicate policy enum alternative.");
        if(rule.kind==="resource"&&new Set(rule.classes).size!==rule.classes.length)throw new Error("Duplicate policy Resource class.");
        if ("min" in rule&&(rule.min>rule.max||(rule.exclusive_min&&rule.min===rule.max)||(rule.nonzero&&rule.min===0&&rule.max===0))) throw new Error("Invalid policy range.");
      }
    }
    if(policy.capsule_defaults.height<2*policy.capsule_defaults.radius)throw new Error("Inconsistent policy defaults.");
    return policy;
  }
  catch { throw new BridgeError("TREE_POLICY_INVALID","The bundled tree policy is missing or invalid."); }
}

/** Fixed installation data only; never resolve policy from a model-supplied project/path. No import-time I/O. */
export function loadTreePolicy():TreePolicy {
  try {
    const pkg=resolve(dirname(fileURLToPath(import.meta.url)),"..");
    const repoAddon=join(pkg,"..","addons","mcp_loop");
    const addon=basename(pkg)==="server"&&existsSync(join(repoAddon,"plugin.cfg"))?repoAddon:join(pkg,"addon","mcp_loop");
    return decodeTreePolicy(readTextFileBounded(join(addon,"commands","tree_build_policy.json"),FILE_READ_LIMITS.metadata));
  } catch {
    throw new BridgeError("TREE_POLICY_INVALID","The bundled tree policy is missing or invalid.","Reinstall the matching server/addon; do not retry with relaxed limits.");
  }
}

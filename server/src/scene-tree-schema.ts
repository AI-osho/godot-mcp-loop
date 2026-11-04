import {z} from "zod";
import {BridgeError} from "./errors.js";
import type {TreePolicy,TreePropertyRule} from "./tree-policy.js";

export type TreeJson=null|boolean|number|string|TreeJson[]|{[key:string]:TreeJson};
/** Explicit JSON types for MCP clients; do not reuse the legacy untyped nested-value schema. */
export const TreeJsonValue:z.ZodType<TreeJson>=z.lazy(()=>z.union([
  z.null(),z.boolean(),z.number(),z.string(),z.array(TreeJsonValue),z.record(z.string(),TreeJsonValue),
]));
const NodeSpec=z.strictObject({
  id:z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),parent_id:z.string().regex(/^[a-z][a-z0-9_]{0,31}$/).optional(),type:z.string(),name:z.string(),
  properties:z.record(z.string(),TreeJsonValue).default(()=>({})),
});
export const TreeRequestSchema=z.strictObject({
  schema_version:z.literal(1),scene:z.string(),nodes:z.array(NodeSpec),dry_run:z.boolean().default(false),
});
export type TreeRequest=z.infer<typeof TreeRequestSchema>;

/** Enum-key records retain strict unknown-key rejection, including __proto__, before Zod can strip it. */
function inputPropertyMap<V>(keys:string[],value:z.ZodType<V>) {
  return z.record(z.enum(keys),value.optional()).transform(object=>
    Object.fromEntries<V>(Object.entries(object).filter((entry):entry is [string,V]=>entry[1]!==undefined)));
}

/** v1 Resources contain scalar/Vector/Color fields, not nested Resource-valued fields. Keep the MCP schema bounded. */
export function createTreeInputSchema(policy:TreePolicy) {
  const scalar=z.union([z.null(),z.boolean(),z.number(),z.string()]);
  const plain=z.union([scalar,z.array(scalar).max(policy.limits.array_items)]);
  const resourceKeys=[...new Set(Object.values(policy.resources).flatMap(properties=>Object.keys(properties)))];
  const resourceProperties=inputPropertyMap(resourceKeys,plain);
  const resource=z.strictObject({new:z.string(),properties:resourceProperties.optional()});
  const reference=z.strictObject({res:z.string()});
  const value=z.union([plain,resource,reference]);
  const nodeKeys=[...new Set(Object.values(policy.nodes).flatMap(properties=>Object.keys(properties)))];
  const properties=inputPropertyMap(nodeKeys,value).default(()=>({}));
  return TreeRequestSchema.extend({nodes:z.array(NodeSpec.extend({properties})).min(1).max(policy.limits.nodes)});
}



export function isTreeResPath(path:string,extension:string,maxBytes:number):boolean {
  if (!path.startsWith("res://")||!path.toLowerCase().endsWith("."+extension)||Buffer.byteLength(path,"utf8")>maxBytes) return false;
  const body=path.slice(6);
  return body.trim()===body&&!/[\u0000-\u001f\u007f\uD800-\uDFFF:\\]/u.test(body)&&body.split("/").every(part=>part!==""&&part!=="."&&part!=="..");
}


function checkRequestBytes(input:unknown,limit:number):void {
  let bytes:number;
  try {
    const json=JSON.stringify(input);
    if (json===undefined) throw new Error("Not JSON.");
    bytes=Buffer.byteLength(json,"utf8");
  } catch {
    throw new BridgeError("INVALID_TREE_PLAN","request must be serializable finite JSON.");
  }
  if (bytes>limit) throw new BridgeError("INVALID_TREE_PLAN","request exceeds its UTF-8 byte budget.");
}



type NumericRule=Extract<TreePropertyRule,{min:number}>;
function validNumber(value:TreeJson,rule:NumericRule):value is number {
  return typeof value==="number"&&Number.isFinite(value)&&value<=rule.max&&(rule.exclusive_min?value>rule.min:value>=rule.min)&&(!rule.nonzero||value!==0)&&(rule.kind!=="int"||Number.isInteger(value));
}

function invalidValue(field:string):never {
  throw new BridgeError("TREE_BUILD_VALIDATION_FAILED",`${field} has an invalid value for its allowed property.`);
}

function treeObject(value:TreeJson|undefined):value is {[key:string]:TreeJson} {
  return value!==null&&typeof value==="object"&&!Array.isArray(value);
}

function validateTreeValue(value:TreeJson,rule:TreePropertyRule,field:string,policy:TreePolicy):void {
  if ((rule.kind==="resource"||rule.kind==="texture")&&value===null) {
    if (!rule.nullable) invalidValue(field);
    return;
  }
  if (rule.kind==="resource") {
    if (!treeObject(value)||typeof value.new!=="string"||!rule.classes.some(cls=>cls===value.new)||Object.keys(value).some(key=>key!=="new"&&key!=="properties")) {
      throw new BridgeError("UNSUPPORTED_PROPERTY",`${field} must use an allowed embedded Resource specification.`);
    }
    if (value.properties!==undefined&&!treeObject(value.properties)) invalidValue(`${field}.properties`);
    const properties=treeObject(value.properties)?value.properties:{};
    const rules=policy.resources[value.new as keyof TreePolicy["resources"]];
    for (const [key,nested] of Object.entries(properties)) {
      const nestedRule=rules[key];
      if (!Object.hasOwn(rules,key)||nestedRule===undefined) throw new BridgeError("UNSUPPORTED_PROPERTY",`${field}.properties contains an unsupported Resource property.`);
      validateTreeValue(nested,nestedRule,`${field}.properties.${key}`,policy);
    }
    if (value.new==="CapsuleShape2D") {
      const radius=properties.radius??policy.capsule_defaults.radius;
      const height=properties.height??policy.capsule_defaults.height;
      if (typeof radius!=="number"||typeof height!=="number"||height<2*radius) invalidValue(`${field}.properties.height`);
    }
  }
  if (rule.kind==="texture"&&(!treeObject(value)||Object.keys(value).length!==1||typeof value.res!=="string"||!isTreeResPath(value.res,"png",policy.limits.path_bytes))) {
    throw new BridgeError("RESOURCE_NOT_READY",`${field} must reference one bounded literal res:// PNG path.`);
  }
  if (rule.kind==="color") {
    const valid=typeof value==="string"?/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value):Array.isArray(value)&&(value.length===3||value.length===4)&&value.every(v=>typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=1);
    if (!valid) invalidValue(field);
  }
  if (rule.kind==="bool"&&typeof value!=="boolean") invalidValue(field);
  if (rule.kind==="text"&&(typeof value!=="string"||Buffer.byteLength(value,"utf8")>policy.limits.string_bytes||/[\u0000\uD800-\uDFFF]/u.test(value))) invalidValue(field);
  if (rule.kind==="enum"&&(typeof value!=="number"||!Number.isInteger(value)||!rule.values.includes(value))) invalidValue(field);
  if (rule.kind==="vector2"&&(!Array.isArray(value)||value.length!==2||!value.every(v=>validNumber(v,rule)))) invalidValue(field);
  if ((rule.kind==="number"||rule.kind==="int")&&!validNumber(value,rule)) invalidValue(field);
}


function checkTreeJsonBudgets(input:unknown,policy:TreePolicy):void {
  const stack:Array<{value:unknown;resourceDepth:number;depth:number}>=[{value:input,resourceDepth:0,depth:0}];
  const references=new Set<string>();
  let properties=0;
  let resources=0;
  while (stack.length) {
    const entry=stack.pop()!;
    if (entry.depth>6+2*policy.limits.resource_depth) throw new BridgeError("INVALID_TREE_PLAN","request exceeds its bounded JSON nesting limit.");
    const value=entry.value;
    if (typeof value==="string"&&(Buffer.byteLength(value,"utf8")>policy.limits.string_bytes||/[\u0000\uD800-\uDFFF]/u.test(value))) throw new BridgeError("INVALID_TREE_PLAN","request exceeds its UTF-8 string byte budget or contains unsupported string data.");
    if (Array.isArray(value)) {
      if (value.length>policy.limits.array_items) throw new BridgeError("INVALID_TREE_PLAN","request exceeds its array count limit.");
      for (const item of value) stack.push({value:item,resourceDepth:entry.resourceDepth,depth:entry.depth+1});
    } else if (value!==null&&typeof value==="object") {
      const object=value as Record<string,unknown>;
      if (Object.keys(object).some(key=>key==="__proto__"||key==="prototype"||key==="constructor")) throw new BridgeError("INVALID_TREE_PLAN","request contains a forbidden object key.");
      const resourceDepth=entry.resourceDepth+(Object.hasOwn(object,"new")?1:0);
      if (Object.hasOwn(object,"new")) resources++;
      if (resources>policy.limits.resources) throw new BridgeError("INVALID_TREE_PLAN","request exceeds its embedded Resource count limit.");
      if (resourceDepth>policy.limits.resource_depth) throw new BridgeError("INVALID_TREE_PLAN","request exceeds its Resource nesting limit.");
      if (Object.hasOwn(object,"properties")&&object.properties!==null&&typeof object.properties==="object"&&!Array.isArray(object.properties)) properties+=Object.keys(object.properties).length;
      if (properties>policy.limits.properties_total) throw new BridgeError("INVALID_TREE_PLAN","request exceeds the total property count limit.");
      if (typeof object.res==="string"&&Object.hasOwn(object,"res")) references.add(object.res);
      if (references.size>policy.limits.png_references) throw new BridgeError("INVALID_TREE_PLAN","request exceeds its distinct PNG reference count limit.");
      for (const item of Object.values(object)) stack.push({value:item,resourceDepth,depth:entry.depth+1});
    }
  }
}

/** Pure input boundary; filesystem/Godot access belongs to registration and the authenticated bridge. */
export function parseTreeRequest(input:unknown,policy:TreePolicy):TreeRequest {
  checkRequestBytes(input,policy.limits.request_bytes);
  checkTreeJsonBudgets(input,policy);
  const decoded=TreeRequestSchema.safeParse(input);
  if (!decoded.success) {
    const path=decoded.error.issues[0]?.path??[];
    const field=path[0]==="nodes"&&typeof path[1]==="number"?`nodes[${path[1]}]`:"request";
    throw new BridgeError("INVALID_TREE_PLAN",`${field} has invalid fields or JSON value types.`);
  }
  const request=decoded.data;
  checkRequestBytes(request,policy.limits.request_bytes);
  if (request.nodes.length<1||request.nodes.length>policy.limits.nodes) throw new BridgeError("INVALID_TREE_PLAN","nodes must contain between one and the policy limit.");
  if (!isTreeResPath(request.scene,"tscn",policy.limits.path_bytes)) throw new BridgeError("INVALID_TREE_PLAN","scene must be a bounded literal res:// .tscn path.");
  const seen=new Set<string>();
  const siblings=new Set<string>();
  const depths=new Map<string,number>();
  for (const [index,node] of request.nodes.entries()) {
    if (seen.has(node.id)) throw new BridgeError("INVALID_TREE_PLAN",`nodes[${index}].id must be unique.`);
    if (!Object.hasOwn(policy.nodes,node.type)) throw new BridgeError("UNSUPPORTED_NODE_TYPE",`nodes[${index}].type is not an allowed native class.`);
    if (index===0&&node.type!=="Node2D"&&node.type!=="Control") throw new BridgeError("UNSUPPORTED_NODE_TYPE","nodes[0].type must be Node2D or Control.");
    if (index>0&&node.parent_id===undefined) {
      throw new BridgeError("INVALID_TREE_PLAN",`nodes[${index}].parent_id is required after the first node.`);
    }
    if (node.parent_id!==undefined&&!seen.has(node.parent_id)) {
      throw new BridgeError("INVALID_TREE_PLAN",`nodes[${index}].parent_id must refer to an earlier node.`);
    }
    if (!node.name||node.name.trim()!==node.name||/[.:@\u002f"%\\\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(node.name)||Buffer.byteLength(node.name,"utf8")>policy.limits.name_bytes) throw new BridgeError("INVALID_TREE_PLAN",`nodes[${index}].name must be a bounded literal Godot node name.`);
    const depth=node.parent_id===undefined?1:(depths.get(node.parent_id)??0)+1;
    if (depth>policy.limits.depth) throw new BridgeError("INVALID_TREE_PLAN",`nodes[${index}] exceeds the hierarchy depth limit.`);
    depths.set(node.id,depth);
    if (Object.keys(node.properties).length>policy.limits.properties_per_node) throw new BridgeError("INVALID_TREE_PLAN",`nodes[${index}] exceeds the per-node property count limit.`);
    const rules=policy.nodes[node.type as keyof TreePolicy["nodes"]];
    for (const [key,value] of Object.entries(node.properties)) {
      const rule=rules[key];
      if (!Object.hasOwn(rules,key)||rule===undefined) throw new BridgeError("UNSUPPORTED_PROPERTY",`nodes[${index}].properties contains a key that is not an allowed property.`);
      validateTreeValue(value,rule,`nodes[${index}].properties.${key}`,policy);
    }
    const siblingKey=JSON.stringify([node.parent_id??null,node.name]);
    if (siblings.has(siblingKey)) throw new BridgeError("INVALID_TREE_PLAN",`nodes[${index}].name must be unique among siblings.`);
    siblings.add(siblingKey);
    seen.add(node.id);
  }
  return request;
}

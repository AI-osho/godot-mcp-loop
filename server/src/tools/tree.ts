import type {CallToolResult} from "@modelcontextprotocol/sdk/types.js";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {GodotConnection} from "../connection.js";
import {z} from "zod";
import {parseTreeRequest,createTreeInputSchema,type TreeRequest} from "../scene-tree-schema.js";
import {loadTreePolicy,type TreePolicy} from "../tree-policy.js";
import {projectFilePath} from "../project-path.js";
import {jsonResult,safe} from "./helpers.js";
import {BridgeError} from "../errors.js";

const REFUSAL_MESSAGES=new Map<string,string>([
  ["TREE_POLICY_INVALID","The bundled tree policy is missing or invalid."],
  ["INVALID_TREE_PLAN","The subtree plan does not satisfy the bounded data contract."],
  ["SCENE_TARGET_MISMATCH","The explicitly selected empty scene is not the current compatible target."],
  ["SCENE_NOT_EMPTY","The target scene already contains child nodes."],
  ["UNSUPPORTED_NODE_TYPE","A node class is outside the native type allowlist."],
  ["UNSUPPORTED_PROPERTY","A property or embedded resource is outside the allowlist."],
  ["RESOURCE_NOT_READY","A referenced PNG is not ready or does not satisfy its declared limits."],
  ["PATH_FORBIDDEN","A scene or PNG reference violates the project path guard."],
  ["TREE_BUILD_VALIDATION_FAILED","Detached native validation or setter readback failed."],
  ["BUSY","The editor or native history is not available for a new subtree."],
  ["UNKNOWN_METHOD","The connected addon does not provide the subtree command."],
]);

function safeTreeField(message:string,policy:TreePolicy):string|undefined {
  const match=/^((?:request|schema_version|scene|dry_run|nodes(?:\[[0-9]{1,2}\])?)(?:\.[a-z][a-z0-9_/]*){0,5})(?:\s|:|$)/.exec(message.slice(0,256));
  if(!match) return undefined;
  const field=match[1]!;
  const index=/^nodes\[([0-9]+)\]/.exec(field);
  if(index&&Number(index[1])>=policy.limits.nodes) return undefined;
  const allowed=new Set(["id","parent_id","type","name","properties",...Object.values(policy.nodes).flatMap(Object.keys),...Object.values(policy.resources).flatMap(Object.keys)]);
  if(field.split(".").slice(1).some(part=>!allowed.has(part))) return undefined;
  return field;
}

function treeFailure(code:string,message:string,applied:false|null,field?:string):CallToolResult {
  const hint=applied===false?"Nothing was applied by this request. Correct the plan or target and preview again.":"Inspect scene_tree and native editor history before retrying. Do not resend the edit automatically.";
  const created_count=applied===false?0:null;
  return {isError:true,structuredContent:{schema_version:1,applied,created_count,disk_saved:false,error:{code,message,hint,...(field===undefined?{}:{field})}},content:[{type:"text",text:`Error ${code}: ${message}\nHint: ${hint}\nTree state: applied=${String(applied)}; created_count=${String(created_count)}; disk_saved=false.`}]};
}

function checkedTreeReply(reply:unknown,request:TreeRequest,policy:TreePolicy) {
  const fail=():never=>{throw new BridgeError("TREE_BUILD_STATE_UNCERTAIN","The complete native subtree result could not be confirmed.");};
  let text:string|undefined;
  try {text=JSON.stringify(reply);} catch {return fail();}
  if(text===undefined||Buffer.byteLength(text,"utf8")>policy.limits.reply_bytes) return fail();
  const rows=z.array(z.strictObject({id:z.string(),type:z.string(),path:z.string()})).max(policy.limits.nodes);
  const common={schema_version:z.literal(1),scene:z.string(),disk_saved:z.literal(false),planned_count:z.number().int().min(1).max(policy.limits.nodes)};
  const schema=z.discriminatedUnion("dry_run",[
    z.strictObject({...common,dry_run:z.literal(true),applied:z.literal(false),created_count:z.literal(0),planned_nodes:rows,undo_action:z.null()}),
    z.strictObject({...common,dry_run:z.literal(false),applied:z.literal(true),created_count:z.number().int().min(1).max(policy.limits.nodes),created_nodes:rows,undo_action:z.string().max(100).regex(/^MCP#[1-9][0-9]*: add subtree$/)}),
  ]);
  const parsed=schema.safeParse(reply);
  if(!parsed.success) return fail();
  const value=parsed.data,list=value.dry_run?value.planned_nodes:value.created_nodes;
  if(value.scene!==request.scene||value.dry_run!==request.dry_run||value.planned_count!==request.nodes.length||list.length!==request.nodes.length||value.created_count!==(request.dry_run?0:request.nodes.length)) return fail();
  const paths=new Map<string,string>();
  for(const [index,spec] of request.nodes.entries()) {
    const path=spec.parent_id===undefined?spec.name:`${paths.get(spec.parent_id)}/${spec.name}`;
    paths.set(spec.id,path);
    const row=list[index];
    if(row===undefined||row.id!==spec.id||row.type!==spec.type||row.path!==path) return fail();
  }
  return value;
}

export function registerTreeTools(server:McpServer,conn:GodotConnection):void {
  const policy=loadTreePolicy();
  server.registerTool("node_add_tree",{
    title:"Add a bounded 2D/UI subtree",
    description:"Validate and add one parent-first native 2D/UI subtree to the explicitly named currently edited empty Node2D/Control scene. Up to 64 nodes, depth 8, 512 total properties including embedded shapes/styles. IDs and names are literal; no scripts, scene instances, external Resource files or numeric-string coercion. Textures may reference ready PNGs. dry_run validates without editing scene/history; an applied tree is one edit_undo action. Does not save: call scene_save separately, then verify the actual game/UI. Do not blindly retry after a disconnect or timeout; inspect the scene first.",
    inputSchema:createTreeInputSchema(policy),
    annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
  },safe(async(args)=>{
    try {
    const request=parseTreeRequest(args,policy);
    return await conn.withProjectLease(async()=>{
      projectFilePath(conn.projectPath,request.scene,{write:true,requireRes:true,allowRoot:false});
      for(const node of request.nodes) {
        const rules=policy.nodes[node.type as keyof typeof policy.nodes];
        for(const [key,value] of Object.entries(node.properties)) {
          if(rules[key]?.kind==="texture"&&value!==null&&typeof value==="object"&&!Array.isArray(value)&&typeof value.res==="string") {
            projectFilePath(conn.projectPath,value.res,{requireRes:true,allowRoot:false});
          }
        }
      }
      try {
        return jsonResult(checkedTreeReply(await conn.call("node.add_tree",request),request,policy));
      } catch(error) {
        if(error instanceof BridgeError&&REFUSAL_MESSAGES.has(error.code)) {
          const message=REFUSAL_MESSAGES.get(error.code)!;
          return treeFailure(error.code,message,false,safeTreeField(error.message,policy));
        }
        const code=error instanceof BridgeError&&["DISCONNECTED","TIMEOUT","BAD_RESPONSE","INTERNAL","TREE_BUILD_STATE_UNCERTAIN"].includes(error.code)?error.code:"TREE_BUILD_STATE_UNCERTAIN";
        return treeFailure(code,"No definitive subtree result was confirmed after dispatch; the applied state is unknown.",null);
      }
    });
    } catch(error) {
      if(error instanceof BridgeError&&REFUSAL_MESSAGES.has(error.code)) {
        return treeFailure(error.code,REFUSAL_MESSAGES.get(error.code)!,false,safeTreeField(error.message,policy));
      }
      throw error;
    }
  }));
}

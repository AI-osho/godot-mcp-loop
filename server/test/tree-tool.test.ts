import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {mkdtempSync,rmSync,writeFileSync,symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {GodotConnection} from "../src/connection.js";
import {FakeAddon} from "./fake-addon.js";
import {connectClient,textOf} from "./helpers.js";

// Protocol-only unit backend. Native Godot acceptance is in the separate e2e file.
describe("node_add_tree MCP boundary",()=>{
  let addon:FakeAddon,conn:GodotConnection,client:Client,project:string;
  beforeEach(async()=>{
    project=mkdtempSync(join(tmpdir(),"gml-tree-unit-"));
    addon=new FakeAddon();const port=await addon.start();
    conn=new GodotConnection({projectPath:project,requestTimeoutMs:200,readSession:()=>({port,token:addon.token,pid:process.pid,protocol:1})});
    client=await connectClient(conn);
    addon.handlers.set("node.add_tree",p=>({ok:true,result:{schema_version:1,scene:p.scene,dry_run:true,applied:false,disk_saved:false,planned_count:1,created_count:0,planned_nodes:[{id:"group",type:"Node2D",path:"Group"}],undo_action:null}}));
  });
  afterEach(async()=>{await client?.close();conn?.close();await addon?.stop();if(project)rmSync(project,{recursive:true,force:true});});
  it("forwards a valid plan in exactly one authenticated bridge request",async()=>{
    const result=await client.callTool({name:"node_add_tree",arguments:{schema_version:1,scene:"res://x.tscn",dry_run:true,nodes:[{id:"group",type:"Node2D",name:"Group"}]}});
    expect(result.isError).toBeFalsy();
    const calls=addon.received.filter(r=>r.method==="node.add_tree");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params).toMatchObject({schema_version:1,scene:"res://x.tscn",dry_run:true,nodes:[{id:"group",type:"Node2D",name:"Group",properties:{}}]});
    expect(JSON.parse(textOf(result))).toMatchObject({applied:false,created_count:0,planned_count:1,disk_saved:false});
  });
  it("holds a project lease throughout the authenticated dispatch",async()=>{
    let entered!:()=>void,release!:()=>void;const dispatched=new Promise<void>(r=>{entered=r;});const barrier=new Promise<void>(r=>{release=r;});
    const original=addon.handlers.get("node.add_tree")!;addon.handlers.set("node.add_tree",async p=>{entered();await barrier;return original(p);});
    const pending=client.callTool({name:"node_add_tree",arguments:{schema_version:1,scene:"res://x.tscn",dry_run:true,nodes:[{id:"group",type:"Node2D",name:"Group"}]}});
    try{await dispatched;expect(()=>conn.switchProject(project)).toThrow(/still running/);}finally{release();await pending.catch(()=>undefined);}
  });
  it("rejects malformed parent references without even connecting to the backend",async()=>{
    const result=await client.callTool({name:"node_add_tree",arguments:{schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group"},{id:"child",parent_id:"missing",type:"Node2D",name:"Child"}]}});
    expect(result.isError).toBe(true);expect(textOf(result)).toContain("INVALID_TREE_PLAN");expect(result.structuredContent).toMatchObject({applied:false,created_count:0,disk_saved:false,error:{code:"INVALID_TREE_PLAN"}});expect(addon.received).toHaveLength(0);
  });
  it("rejects an own prototype key at the real SDK boundary instead of silently dropping it",async()=>{
    const args=JSON.parse('{"schema_version":1,"scene":"res://x.tscn","nodes":[{"id":"group","type":"Node2D","name":"Group","properties":{"__proto__":{"visible":false}}}]}');
    const result=await client.callTool({name:"node_add_tree",arguments:args});
    expect(result.isError).toBe(true);expect(addon.received).toHaveLength(0);
  });
  it("rejects nested prototype keys in embedded Resource properties",async()=>{
    const args=JSON.parse('{"schema_version":1,"scene":"res://x.tscn","nodes":[{"id":"group","type":"Node2D","name":"Group"},{"id":"shape","parent_id":"group","type":"CollisionShape2D","name":"Shape","properties":{"shape":{"new":"CircleShape2D","properties":{"__proto__":{"script":"not-code"}}}}}]}');
    const result=await client.callTool({name:"node_add_tree",arguments:args});expect(result.isError).toBe(true);expect(addon.received).toHaveLength(0);
  });
  it("publishes one typed tool without opening a Godot connection",async()=>{
    const listed=await client.listTools();expect(listed.tools).toHaveLength(49);
    const tool=listed.tools.find(t=>t.name==="node_add_tree");expect(tool?.annotations).toMatchObject({readOnlyHint:false,destructiveHint:false,openWorldHint:false});
    expect(tool?.inputSchema.type).toBe("object");expect(JSON.stringify(tool?.inputSchema)).toContain('"number"');expect(addon.received).toHaveLength(0);
  });
  it("advertises the actual computation node limit in its MCP schema",async()=>{
    const tool=(await client.listTools()).tools.find(t=>t.name==="node_add_tree");
    const properties=tool?.inputSchema.properties as Record<string,{maxItems?:number;minItems?:number}>;expect(properties.nodes?.maxItems).toBe(64);expect(properties.nodes?.minItems).toBe(1);
  });
  it("rejects protected scene destinations before the bridge is contacted",async()=>{
    const result=await client.callTool({name:"node_add_tree",arguments:{schema_version:1,scene:"res://.GiT/x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group"}]}});
    expect(result.isError).toBe(true);expect(textOf(result)).toContain("PATH_FORBIDDEN");expect(addon.received).toHaveLength(0);
  });
  it("rejects symbolic-link PNG references before the bridge is contacted",async()=>{
    writeFileSync(join(project,"owned.png"),"owned guard fixture, not image-validation evidence");symlinkSync(join(project,"owned.png"),join(project,"linked.png"));
    const result=await client.callTool({name:"node_add_tree",arguments:{schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group"},{id:"visual",parent_id:"group",type:"Sprite2D",name:"Visual",properties:{texture:{res:"res://linked.png"}}}]}});
    expect(result.isError).toBe(true);expect(textOf(result)).toContain("PATH_FORBIDDEN");expect(addon.received).toHaveLength(0);
  });
  it.each(["TREE_POLICY_INVALID","INVALID_TREE_PLAN","SCENE_TARGET_MISMATCH","SCENE_NOT_EMPTY","UNSUPPORTED_NODE_TYPE","UNSUPPORTED_PROPERTY","RESOURCE_NOT_READY","PATH_FORBIDDEN","TREE_BUILD_VALIDATION_FAILED","BUSY","UNKNOWN_METHOD"])("reports native %s refusal as unapplied",async(code)=>{
    addon.handlers.set("node.add_tree",()=>({ok:false,error:{code,message:"TREE_SYNTHETIC_PRIVATE_BACKEND_MESSAGE",hint:"TREE_SYNTHETIC_PRIVATE_BACKEND_HINT"}}));
    const result=await client.callTool({name:"node_add_tree",arguments:{schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group"}]}});
    expect(result.isError).toBe(true);expect(textOf(result)).toContain(code);expect(result.structuredContent).toMatchObject({schema_version:1,applied:false,created_count:0,disk_saved:false,error:{code}});expect(JSON.stringify(result)).not.toContain("TREE_SYNTHETIC_PRIVATE_BACKEND_");expect(addon.received.filter(r=>r.method==="node.add_tree")).toHaveLength(1);
  });
  it("does not resend a dispatched tree after disconnect and reports unknown application state",async()=>{
    const original=addon.handlers.get("node.add_tree")!;
    addon.handlers.set("node.add_tree",()=>{addon.dropAllConnections();return new Promise(()=>{});});
    const args={schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group"}]};
    const result=await client.callTool({name:"node_add_tree",arguments:args});
    expect(result.isError).toBe(true);expect(textOf(result)).toContain("DISCONNECTED");expect(result.structuredContent).toMatchObject({applied:null,created_count:null,disk_saved:false,error:{code:"DISCONNECTED"}});expect(addon.received.filter(r=>r.method==="node.add_tree")).toHaveLength(1);
    addon.handlers.set("node.add_tree",original);const recovered=await client.callTool({name:"node_add_tree",arguments:{...args,dry_run:true}});expect(recovered.isError).toBeFalsy();expect(addon.received.filter(r=>r.method==="node.add_tree")).toHaveLength(2);
  });
  it("does not resend a dispatched tree after a real bridge timeout",async()=>{
    let accepted=0;addon.handlers.set("node.add_tree",()=>{accepted++;return new Promise(()=>{});});
    const result=await client.callTool({name:"node_add_tree",arguments:{schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group"}]}});
    expect(result.isError).toBe(true);expect(result.structuredContent).toMatchObject({applied:null,created_count:null,disk_saved:false,error:{code:"TIMEOUT"}});expect(accepted).toBe(1);expect(addon.received.filter(r=>r.method==="node.add_tree")).toHaveLength(1);
  });
  it.each(["TREE_BUILD_STATE_UNCERTAIN","INTERNAL","BAD_RESPONSE","TREE_SYNTHETIC_PRIVATE_CODE"])("keeps ambiguous %s post-dispatch failures unknown and bounded",async(code)=>{
    addon.handlers.set("node.add_tree",()=>code==="BAD_RESPONSE"?{malformed_envelope:true}:{ok:false,error:{code,message:"TREE_SYNTHETIC_PRIVATE_MESSAGE",hint:"TREE_SYNTHETIC_PRIVATE_HINT"}});
    const result=await client.callTool({name:"node_add_tree",arguments:{schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group"}]}});
    const expected=code==="TREE_SYNTHETIC_PRIVATE_CODE"?"TREE_BUILD_STATE_UNCERTAIN":code;
    expect(result.isError).toBe(true);expect(result.structuredContent).toMatchObject({applied:null,created_count:null,disk_saved:false,error:{code:expected}});expect(JSON.stringify(result)).not.toContain("TREE_SYNTHETIC_PRIVATE_");expect(addon.received.filter(r=>r.method==="node.add_tree")).toHaveLength(1);
  });
  it.each([
    ["created count",{created_count:0}], ["planned count",{planned_count:2}], ["missing row",{created_nodes:[]}],
    ["foreign scene",{scene:"res://other.tscn"}], ["mode",{dry_run:true}], ["disk claim",{disk_saved:true}],
    ["history",{undo_action:null}], ["foreign row",{created_nodes:[{id:"different",type:"Node2D",path:"Other"}]}],
    ["unknown output field",{extra:"TREE_SYNTHETIC_PRIVATE_REPLY"}],
  ])("refuses an unconfirmed native success with inconsistent %s",async(_label,changes)=>{
    addon.handlers.set("node.add_tree",()=>({ok:true,result:{schema_version:1,scene:"res://x.tscn",dry_run:false,applied:true,disk_saved:false,planned_count:1,created_count:1,created_nodes:[{id:"group",type:"Node2D",path:"Group"}],undo_action:"MCP#1: add subtree",...changes}}));
    const result=await client.callTool({name:"node_add_tree",arguments:{schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group"}]}});
    expect(result.isError).toBe(true);expect(result.structuredContent).toMatchObject({applied:null,created_count:null,error:{code:"TREE_BUILD_STATE_UNCERTAIN"}});expect(JSON.stringify(result)).not.toContain("TREE_SYNTHETIC_PRIVATE_REPLY");expect(addon.received.filter(r=>r.method==="node.add_tree")).toHaveLength(1);
  });
  it("retains an allowlisted native field location without reflecting backend values",async()=>{
    addon.handlers.set("node.add_tree",()=>({ok:false,error:{code:"TREE_BUILD_VALIDATION_FAILED",message:"nodes[0].properties.position TREE_SYNTHETIC_PRIVATE_VALUE",hint:"TREE_SYNTHETIC_PRIVATE_HINT"}}));
    const result=await client.callTool({name:"node_add_tree",arguments:{schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group"}]}});
    expect(result.structuredContent).toMatchObject({applied:false,error:{code:"TREE_BUILD_VALIDATION_FAILED",field:"nodes[0].properties.position"}});expect(JSON.stringify(result)).not.toContain("TREE_SYNTHETIC_PRIVATE_");
  });
});

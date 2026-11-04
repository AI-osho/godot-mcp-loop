import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from "node:fs";
import {createHash} from "node:crypto";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import type {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {startHeadlessEditor,type GodotHarness} from "./godot-harness.js";
import {connectClient,textOf} from "../helpers.js";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const OWNED_TARGET_SCENES={
 "inherit_base.tscn":'[gd_scene format=3]\n[node name="Base" type="Node2D"]\n',
 "inherited_target.tscn":'[gd_scene load_steps=2 format=3]\n[ext_resource type="PackedScene" path="res://inherit_base.tscn" id="1"]\n[node name="Inherited" instance=ExtResource("1")]\n',
 "plain_target.gd":'extends Node2D\n',
 "scripted_target.tscn":'[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://plain_target.gd" id="1"]\n[node name="Scripted" type="Node2D"]\nscript=ExtResource("1")\n',
 "addons/mcp_loop/protected_target.tscn":'[gd_scene format=3]\n[node name="Protected" type="Node2D"]\n',
};
const sha=(path:string)=>createHash("sha256").update(readFileSync(path)).digest("hex");
const plan={schema_version:1,scene:"res://tree_work.tscn",nodes:[
  {id:"group",type:"Node2D",name:"Group"},
  {id:"body",parent_id:"group",type:"CharacterBody2D",name:"Player",properties:{position:[120,160]}},
  {id:"shape",parent_id:"body",type:"CollisionShape2D",name:"Collision",properties:{shape:{new:"RectangleShape2D",properties:{size:[24,32]}}}},
  {id:"visual",parent_id:"body",type:"Sprite2D",name:"Visual",properties:{texture:{res:"res://assets/shared.png"}}},
  {id:"camera",parent_id:"body",type:"Camera2D",name:"Camera",properties:{zoom:[1,1]}},
]};
let h:GodotHarness,client:Client;
let ownedPID:number|undefined;
function ownedAlive(){if(ownedPID===undefined)return true;try{process.kill(ownedPID,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=="ESRCH";}}
const expectedNativeErrors:string[]=[];
const nativeErrors=(log:string)=>log.replace(/\x1b\[[0-9;]*m/g,"").split(/\r?\n/).filter(line=>/^(?:SCRIPT ERROR|ERROR):/.test(line));
const native=async(method:string,args:Record<string,unknown>={})=>h.conn.call(method,args) as Promise<any>;
function evidence(name:string,data:unknown){const root=process.env.TREE_E2E_EVIDENCE;if(root){mkdirSync(root,{recursive:true});writeFileSync(join(root,name+".json"),JSON.stringify(data,null,2)+"\n");}}
describe("native node_add_tree",()=>{
 beforeAll(async()=>{
  const plugin=readFileSync(join(ROOT,"addons/mcp_loop/plugin.gd"),"utf8").replace('const NodeCommands =', 'const TreeFixture = preload("res://addons/mcp_loop/commands/tree_fixture.gd")\nconst NodeCommands =').replace('NodeCommands.new(_ctx),','NodeCommands.new(_ctx),\n\t\tTreeFixture.new(_ctx),');
  h=await startHeadlessEditor({copyFrom:[{from:join(ROOT,"server/test/fixtures/tree-build"),to:"assets"}],extraFiles:{...OWNED_TARGET_SCENES,"addons/mcp_loop/plugin.gd":plugin,"addons/mcp_loop/commands/tree_fixture.gd":readFileSync(join(ROOT,"server/test/e2e/fixtures/tree_observer.gd"),"utf8"),"tree_png_headers.json":readFileSync(join(ROOT,"server/test/fixtures/tree-png-headers.json"),"utf8"),"forbidden_actor.gd":'@tool\nclass_name TreeFixtureForbiddenActor\nextends Node2D\nfunc _init() -> void:\n\tvar file := FileAccess.open("res://forbidden_actor.marker", FileAccess.WRITE)\n\tfile.store_string("constructed")\n',"forbidden_resource.gd":'@tool\nclass_name TreeFixtureForbiddenResource\nextends Resource\nfunc _init() -> void:\n\tvar file := FileAccess.open("res://forbidden_resource.marker", FileAccess.WRITE)\n\tfile.store_string("constructed")\n'}});
  client=await connectClient(h.conn);
  const created=await client.callTool({name:"scene_create",arguments:{path:plan.scene,root_type:"Node2D",root_name:"OwnedTree"}});expect(created.isError).toBeFalsy();
  ownedPID=(await native("tree_fixture.snapshot")).pid;
 },120000);
 afterAll(async()=>{if(h){let acknowledged=false;try{const reply:any=await Promise.race([native("tree_fixture.quit"),new Promise((_,reject)=>setTimeout(()=>reject(new Error("owned quit acknowledgement timeout")),1500))]);acknowledged=reply.shutdown_requested===true;}catch{}const until=performance.now()+3000;while(ownedAlive()&&performance.now()<until)await new Promise(r=>setTimeout(r,50));const exitedBeforeHarnessStop=!ownedAlive();await client?.close();await h.stop();const log=h.output.join("\n"),root=process.env.TREE_E2E_EVIDENCE;if(root){mkdirSync(root,{recursive:true});writeFileSync(join(root,"native-private.log"),log);}evidence("shutdown-receipt",{pid:ownedPID,acknowledged,exited_before_harness_stop:exitedBeforeHarnessStop,alive_after_stop:ownedAlive(),expected_native_control_errors:expectedNativeErrors.length,expected_headless_thumbnail_errors:expectedNativeErrors.filter(line=>line==='ERROR: Parameter "t" is null.').length});expect(acknowledged).toBe(true);expect(exitedBeforeHarnessStop).toBe(true);expect(ownedAlive()).toBe(false);expect(nativeErrors(log)).toEqual(expectedNativeErrors);expect(log).not.toMatch(/ObjectDB instances leaked|resources still in use/);}},15000);
 it("previews the complete tree without changing native nodes, history, scene bytes or shared PNG",async()=>{
  const before=await native("tree_fixture.snapshot");const scene=join(h.projectPath,"tree_work.tscn"),image=join(h.projectPath,"assets/shared.png");const sceneBefore=sha(scene),imageBefore=sha(image);
  let result:Awaited<ReturnType<Client["callTool"]>>;const until=performance.now()+20000;
  do{result=await client.callTool({name:"node_add_tree",arguments:{...plan,dry_run:true}});if(!result.isError||!textOf(result).includes("RESOURCE_NOT_READY"))break;await new Promise(r=>setTimeout(r,50));}while(performance.now()<until);
  evidence("preview-raw",result);expect(result.isError).toBeFalsy();
  const report=JSON.parse(textOf(result));expect(report).toMatchObject({schema_version:1,applied:false,dry_run:true,disk_saved:false,created_count:0,planned_count:5,undo_action:null});expect(report.planned_nodes).toHaveLength(5);
  expect(await native("tree_fixture.snapshot")).toEqual(before);expect(sha(scene)).toBe(sceneBefore);expect(sha(image)).toBe(imageBefore);evidence("preview-unchanged",{before,scene_sha256:sceneBefore,image_sha256:imageBefore,report});
 },30000);
 it("applies the actual subtree as one owned undo action without saving",async()=>{
  const before=await native("tree_fixture.snapshot");const scene=join(h.projectPath,"tree_work.tscn"),image=join(h.projectPath,"assets/shared.png");const sceneBefore=sha(scene),imageBefore=sha(image);
  const result=await client.callTool({name:"node_add_tree",arguments:{...plan,dry_run:false}});evidence("apply-raw",result);expect(result.isError).toBeFalsy();
  const report=JSON.parse(textOf(result));expect(report).toMatchObject({schema_version:1,applied:true,dry_run:false,disk_saved:false,created_count:5,planned_count:5});expect(report.created_nodes).toHaveLength(5);expect(report.undo_action).toMatch(/^MCP#/);
  const applied=await native("tree_fixture.snapshot");expect(applied.nodes).toHaveLength(6);expect(applied.nodes.slice(1).every((n:any)=>n.owner_is_root)).toBe(true);expect(applied.history_count-before.history_count).toBe(1);expect(applied.history_name).toBe(report.undo_action);expect(sha(scene)).toBe(sceneBefore);expect(sha(image)).toBe(imageBefore);
  const undone=await client.callTool({name:"edit_undo",arguments:{}});expect(undone.isError).toBeFalsy();const after=await native("tree_fixture.snapshot");expect(after.nodes).toEqual(before.nodes);expect(after.root_id).toBe(before.root_id);expect(sha(scene)).toBe(sceneBefore);expect(sha(image)).toBe(imageBefore);evidence("apply-and-undo",{before,applied,after,report});
 },30000);
 it("retains all 64 native nodes, four embedded resource classes and depth-eight ownership across preview, redo and save",async()=>{
  const request=JSON.parse(readFileSync(join(ROOT,"server/test/fixtures/tree-plan-all-types.json"),"utf8"));
  const result=await client.callTool({name:"node_add_tree",arguments:request});evidence("all-types-raw",result);expect(result.isError).toBeFalsy();
  const report=JSON.parse(textOf(result));expect(report.created_count).toBe(64);expect(report.created_nodes).toHaveLength(64);
  const applied=await native("tree_fixture.snapshot");expect(applied.nodes).toHaveLength(65);expect(new Set(applied.nodes.slice(1).map((n:any)=>n.type)).size).toBe(19);expect(applied.nodes.slice(1).every((n:any)=>n.owner_is_root)).toBe(true);expect(Math.max(...applied.nodes.slice(1).map((n:any)=>n.path.split("/").length))).toBe(8);expect(applied.nodes.find((n:any)=>n.path==="Content/Player/Visual").texture).toBe("res://assets/shared.png");expect(applied.nodes.find((n:any)=>n.type==="Label").text).toBe("一括構築の試験 😀");
  const undone=await native("tree_fixture.history",{op:"undo"});expect(undone.nodes).toHaveLength(1);
  const preview=await client.callTool({name:"node_add_tree",arguments:{...request,dry_run:true}});expect(preview.isError).toBeFalsy();expect(await native("tree_fixture.snapshot")).toEqual(undone);
  const redone=await native("tree_fixture.history",{op:"redo"});expect(redone.nodes).toEqual(applied.nodes);expect(redone.history_name).toBe(report.undo_action);
  const saveStart=h.output.length;const saved=await client.callTool({name:"scene_save",arguments:{}});expect(saved.isError).toBeFalsy();await native("tree_fixture.snapshot");
  const saveErrors=nativeErrors(h.output.slice(saveStart).join("\n"));expect(saveErrors.length).toBeLessThanOrEqual(1);expect(saveErrors.every(line=>line==='ERROR: Parameter "t" is null.')).toBe(true);expectedNativeErrors.push(...saveErrors);
  const root=process.env.TREE_E2E_EVIDENCE;if(root){mkdirSync(join(root,"saved/assets"),{recursive:true});copyFileSync(join(h.projectPath,"tree_work.tscn"),join(root,"saved/tree_work.tscn"));copyFileSync(join(h.projectPath,"assets/shared.png"),join(root,"saved/assets/shared.png"));copyFileSync(join(h.projectPath,"assets/shared.png.import"),join(root,"saved/assets/shared.png.import"));}
  evidence("all-types-native",{request,report,applied,undone,redone,save_control:{expected_headless_thumbnail_errors:saveErrors.length},image_sha256:sha(join(h.projectPath,"assets/shared.png"))});
  const cleared=await native("tree_fixture.history",{op:"clear"});expect(cleared.history_count).toBe(0);expect(cleared.nodes).toEqual(redone.nodes);
 },30000);
 it("builds a Control UI without changing the existing Control root properties",async()=>{
  const scene="res://tree_ui.tscn";const created=await client.callTool({name:"scene_create",arguments:{path:scene,root_type:"Control",root_name:"UIRoot"}});expect(created.isError).toBeFalsy();
  const request={schema_version:1,scene,nodes:[{id:"ui",type:"Control",name:"StartUI",properties:{anchor_right:1,anchor_bottom:1,offset_right:640,offset_bottom:360}},{id:"label",parent_id:"ui",type:"Label",name:"説明",properties:{text:"配置して、拠点を守ろう。",autowrap_mode:3,offset_right:400,offset_bottom:60,"theme_override_font_sizes/font_size":18}},{id:"button",parent_id:"ui",type:"Button",name:"Start",properties:{text:"開始",offset_left:20,offset_top:80,offset_right:200,offset_bottom:120,"theme_override_font_sizes/font_size":18}}]};
  const before=await native("tree_fixture.snapshot"),bytes=sha(join(h.projectPath,"tree_ui.tscn"));
  const preview=await client.callTool({name:"node_add_tree",arguments:{...request,dry_run:true}});evidence("control-preview-raw",preview);expect(preview.isError).toBeFalsy();expect(await native("tree_fixture.snapshot")).toEqual(before);
  const applied=await client.callTool({name:"node_add_tree",arguments:request});evidence("control-apply-raw",applied);expect(applied.isError).toBeFalsy();const after=await native("tree_fixture.snapshot");expect(after.root_type).toBe("Control");expect(after.nodes).toHaveLength(4);expect(after.nodes[0]).toEqual(before.nodes[0]);expect(after.nodes.slice(1).every((n:any)=>n.owner_is_root)).toBe(true);expect(sha(join(h.projectPath,"tree_ui.tscn"))).toBe(bytes);evidence("control-native",{before,after});
  const undone=await client.callTool({name:"edit_undo",arguments:{}});expect(undone.isError).toBeFalsy();expect((await native("tree_fixture.snapshot")).nodes).toEqual(before.nodes);
 },30000);
 it("independently refuses native malformed final nodes and forbidden constructors without partial changes",async()=>{
  const scene="res://tree_ui.tscn",before=await native("tree_fixture.snapshot"),sceneBytes=sha(join(h.projectPath,"tree_ui.tscn")),imageBytes=sha(join(h.projectPath,"assets/shared.png"));
  const valid={schema_version:1,scene,nodes:[{id:"top",type:"Node2D",name:"Content"}]};
  const cases:Array<{label:string;code:string;input:Record<string,unknown>}>= [
   {label:"invalid final value",code:"TREE_BUILD_VALIDATION_FAILED",input:{...valid,nodes:[...valid.nodes,{id:"last",parent_id:"top",type:"Node2D",name:"Last",properties:{position:["invalid",0]}}]}},
   {label:"forward parent",code:"INVALID_TREE_PLAN",input:{...valid,nodes:[...valid.nodes,{id:"last",parent_id:"missing",type:"Node2D",name:"Last"}]}},
   {label:"duplicate ID",code:"INVALID_TREE_PLAN",input:{...valid,nodes:[...valid.nodes,{id:"top",parent_id:"top",type:"Node2D",name:"Last"}]}},
   {label:"unknown field",code:"INVALID_TREE_PLAN",input:{...valid,nodes:[{...valid.nodes[0],children:[]}]}},
   {label:"network class",code:"UNSUPPORTED_NODE_TYPE",input:{...valid,nodes:[...valid.nodes,{id:"last",parent_id:"top",type:"HTTPRequest",name:"Last"}]}},
   {label:"custom native node",code:"UNSUPPORTED_NODE_TYPE",input:{...valid,nodes:[...valid.nodes,{id:"last",parent_id:"top",type:"TreeFixtureForbiddenActor",name:"Last"}]}},
   {label:"script property",code:"UNSUPPORTED_PROPERTY",input:{...valid,nodes:[{...valid.nodes[0],properties:{script:{res:"res://forbidden_actor.gd"}}}]}},
   {label:"script resource",code:"UNSUPPORTED_PROPERTY",input:{...valid,nodes:[...valid.nodes,{id:"last",parent_id:"top",type:"CollisionShape2D",name:"Last",properties:{shape:{new:"GDScript"}}}]}},
   {label:"custom resource",code:"UNSUPPORTED_PROPERTY",input:{...valid,nodes:[...valid.nodes,{id:"last",parent_id:"top",type:"CollisionShape2D",name:"Last",properties:{shape:{new:"TreeFixtureForbiddenResource"}}}]}},
  ];
  const checked=[];for(const item of cases){await expect(native("node.add_tree",item.input)).rejects.toMatchObject({code:item.code});expect(await native("tree_fixture.snapshot")).toEqual(before);expect(sha(join(h.projectPath,"tree_ui.tscn"))).toBe(sceneBytes);expect(sha(join(h.projectPath,"assets/shared.png"))).toBe(imageBytes);checked.push({label:item.label,code:item.code,unchanged:true});}
  expect(existsSync(join(h.projectPath,"forbidden_actor.marker"))).toBe(false);expect(existsSync(join(h.projectPath,"forbidden_resource.marker"))).toBe(false);evidence("native-boundary-refusals",{checked,constructors_executed:false,scene_sha256:sceneBytes,image_sha256:imageBytes});
 },30000);
 it("refuses a PNG whose source bytes changed behind an existing ready texture cache",async()=>{
  const probe=await native("tree_fixture.stale_png");evidence("stale-png-native",probe);expect(probe.reply.ok).toBe(false);expect(probe.reply.error.code).toBe("RESOURCE_NOT_READY");expect(probe.after).toEqual(probe.before);expect(probe.restored_sha256).toBe(probe.original_sha256);
 },30000);
 it("observes a real native texture load on a valid PNG positive control",async()=>{
  const probe=await native("tree_fixture.texture_loads");evidence("texture-load-positive",probe);expect(probe.reply.ok).toBe(true);expect(probe.actual_texture_load_calls).toBe(1);
 },30000);
 it.each(["signature","truncated","side","bytes","pixels_total","ihdr_crc","bit_depth","compression","filter","interlace","remap"])("rejects native PNG %s before any texture load",async(kind)=>{
  const probe=await native("tree_fixture.png_fault",{kind});evidence("png-"+kind,probe);expect(probe.reply.ok).toBe(false);expect(probe.reply.error.code).toBe("RESOURCE_NOT_READY");expect(probe.actual_texture_load_calls).toBe(0);expect(probe.after).toEqual(probe.before);expect(probe.source_restored).toBe(true);
 },30000);
 it("refuses mismatched and nonempty native targets without changing either scene",async()=>{
  const empty=await native("tree_fixture.snapshot"),args={schema_version:1,scene:"res://tree_ui.tscn",nodes:[{id:"top",type:"Node2D",name:"Content"}]};
  const mismatch=await client.callTool({name:"node_add_tree",arguments:{...args,scene:"res://missing_target.tscn"}});expect(mismatch.structuredContent).toMatchObject({applied:false,created_count:0,error:{code:"SCENE_TARGET_MISMATCH"}});expect(await native("tree_fixture.snapshot")).toEqual(empty);
  expect((await client.callTool({name:"node_add",arguments:{parent:".",type:"Node2D",name:"Existing"}})).isError).toBeFalsy();const occupied=await native("tree_fixture.snapshot");const refused=await client.callTool({name:"node_add_tree",arguments:args});expect(refused.structuredContent).toMatchObject({applied:false,created_count:0,error:{code:"SCENE_NOT_EMPTY"}});expect(await native("tree_fixture.snapshot")).toEqual(occupied);expect((await client.callTool({name:"edit_undo",arguments:{}})).isError).toBeFalsy();expect((await native("tree_fixture.snapshot")).nodes).toEqual(empty.nodes);
  evidence("target-refusals",{mismatch:mismatch.structuredContent,occupied:refused.structuredContent});
 },30000);
 it.each([["inherited_target.tscn","SCENE_TARGET_MISMATCH"],["scripted_target.tscn","SCENE_TARGET_MISMATCH"],["addons/mcp_loop/protected_target.tscn","PATH_FORBIDDEN"]])("refuses the native target %s",async(file,code)=>{
  try{expect((await client.callTool({name:"scene_open",arguments:{path:"res://"+file}})).isError).toBeFalsy();const before=await native("tree_fixture.snapshot"),bytes=sha(join(h.projectPath,file));await expect(native("node.add_tree",{schema_version:1,scene:"res://"+file,nodes:[{id:"top",type:"Node2D",name:"Content"}]})).rejects.toMatchObject({code});expect(await native("tree_fixture.snapshot")).toEqual(before);expect(sha(join(h.projectPath,file))).toBe(bytes);evidence("target-"+file.replaceAll("/","_"),{code,unchanged:true});}
  finally{expect((await client.callTool({name:"scene_open",arguments:{path:"res://tree_ui.tscn"}})).isError).toBeFalsy();}
 },30000);
 it("does not undo a later human edit in the tree's native history",async()=>{
  const before=await native("tree_fixture.snapshot");const added=await client.callTool({name:"node_add_tree",arguments:{schema_version:1,scene:"res://tree_ui.tscn",nodes:[{id:"top",type:"Control",name:"Content"}]}});expect(added.isError).toBeFalsy();const human=await native("tree_fixture.human");expect(human.nodes[0].visible).toBe(false);const refused=await client.callTool({name:"edit_undo",arguments:{}});expect(refused.isError).toBe(true);expect(textOf(refused)).toContain("NOTHING_TO_UNDO");expect(await native("tree_fixture.snapshot")).toEqual(human);await native("tree_fixture.history",{op:"undo"});await native("tree_fixture.history",{op:"undo"});expect((await native("tree_fixture.snapshot")).nodes).toEqual(before.nodes);evidence("human-history-preserved",{before,human,refused_code:"NOTHING_TO_UNDO"});
 },30000);
 it("detects scoped native errors even when the old global log buffer already dropped entries",async()=>{
  const start=h.output.length,probe=await native("tree_fixture.scope_error");await native("tree_fixture.snapshot");const errors=nativeErrors(h.output.slice(start).join("\n"));expect(errors).toEqual(["ERROR: TREE_EXPECTED_SCOPE_CONTROL"]);expectedNativeErrors.push(...errors);expect(probe.global_dropped).toBe(true);expect(probe.clean_preview.ok).toBe(true);expect(probe.fault_preview.ok).toBe(false);expect(probe.fault_preview.error.code).toBe("TREE_BUILD_VALIDATION_FAILED");expect(probe.after).toEqual(probe.before);evidence("scoped-native-error-control",probe);
 },30000);
 it("preserves a concurrent human edit and refuses its now-stale staged tree",async()=>{
  const probe=await native("tree_fixture.stage_change",{kind:"human"});expect(probe.reply.ok).toBe(false);expect(probe.reply.error.code).toBe("SCENE_TARGET_MISMATCH");expect(probe.after.nodes).toHaveLength(1);expect(probe.after.nodes[0].visible).toBe(false);expect(probe.after.history_name).toBe("Tree fixture concurrent human edit");await native("tree_fixture.history",{op:"undo"});expect((await native("tree_fixture.snapshot")).nodes).toEqual(probe.before.nodes);evidence("concurrent-human-preserved",probe);
 },30000);
 it("refuses a staged tree after the actual edited-root object switches",async()=>{
  try{const probe=await native("tree_fixture.stage_change",{kind:"switch"});expect(probe.reply.ok).toBe(false);expect(probe.reply.error.code).toBe("SCENE_TARGET_MISMATCH");expect(probe.after.root_id).not.toBe(probe.before.root_id);expect(probe.after.nodes).toHaveLength(1);evidence("edited-root-switch",probe);}finally{expect((await client.callTool({name:"scene_open",arguments:{path:"res://tree_ui.tscn"}})).isError).toBeFalsy();}
 },30000);
 it("reports a real post-commit mismatch as unknown and never rolls it back automatically",async()=>{
  const before=await native("tree_fixture.snapshot");await native("tree_fixture.arm_rename");const result=await client.callTool({name:"node_add_tree",arguments:{schema_version:1,scene:"res://tree_ui.tscn",nodes:[{id:"top",type:"Node2D",name:"Content"}]}});expect(result.isError).toBe(true);expect(result.structuredContent).toMatchObject({applied:null,created_count:null,error:{code:"TREE_BUILD_STATE_UNCERTAIN"}});const after=await native("tree_fixture.snapshot");expect(after.nodes).toHaveLength(2);expect(after.nodes[1].name).toBe("ExternallyRenamed");evidence("post-commit-before-assert",{before,after,result:result.structuredContent});expect(after.history_cursor-before.history_cursor).toBe(1);expect(after.history_count).toBe(after.history_cursor+1);expect(after.history_name).toMatch(/^MCP#[0-9]+: add subtree$/);evidence("post-commit-uncertain",{before,after,result:result.structuredContent});await native("tree_fixture.history",{op:"undo"});expect((await native("tree_fixture.snapshot")).nodes).toEqual(before.nodes);
 },30000);
});

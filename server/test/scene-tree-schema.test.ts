import {describe,expect,it} from "vitest";
import {parseTreeRequest} from "../src/scene-tree-schema.js";
import {loadTreePolicy} from "../src/tree-policy.js";

describe("scene tree request",()=>{
  it("accepts one parent-first tree under the bundled native-checked policy",()=>{
    const policy=loadTreePolicy();
    const result=parseTreeRequest({schema_version:1,scene:"res://scenes/example.tscn",dry_run:true,nodes:[
      {id:"group",type:"Node2D",name:"Group"},
      {id:"body",parent_id:"group",type:"CharacterBody2D",name:"プレイヤー"},
    ]},policy);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[1]?.name).toBe("プレイヤー");
    expect(result.dry_run).toBe(true);
  });

  it("rejects a parent that has not appeared before its child",()=>{
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://scenes/example.tscn",nodes:[
      {id:"group",type:"Node2D",name:"Group"},
      {id:"child",parent_id:"missing",type:"Node2D",name:"Child"},
    ]},loadTreePolicy())).toThrow();
  });
  it("rejects a second root",()=>{
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"a",type:"Node2D",name:"A"},{id:"b",type:"Node2D",name:"B"}]},loadTreePolicy())).toThrow();
  });
  it("rejects duplicate IDs",()=>{
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group"},{id:"group",parent_id:"group",type:"Node2D",name:"Child"}]},loadTreePolicy())).toThrow();
  });
  it("rejects malformed literal IDs without repairing them",()=>{
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"bad-id",type:"Node2D",name:"Group"}]},loadTreePolicy())).toThrow();
  });
  it("rejects node classes outside the fixed native policy",()=>{
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"HTTPRequest",name:"Group"}]},loadTreePolicy())).toThrow();
  });
  it("rejects same-named siblings",()=>{
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group"},{id:"a",parent_id:"group",type:"Node2D",name:"Same"},{id:"b",parent_id:"group",type:"Node2D",name:"Same"}]},loadTreePolicy())).toThrow();
  });
  it("requires the new top node to be Node2D or Control",()=>{
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"body",type:"CharacterBody2D",name:"Body"}]},loadTreePolicy())).toThrow();
  });
  it("rejects a request above the node computation limit",()=>{
    const nodes=[{id:"group",type:"Node2D",name:"Group"},...Array.from({length:64},(_,i)=>({id:`n${i}`,parent_id:"group",type:"Node2D",name:`N${i}`}))];
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes},loadTreePolicy())).toThrow();
  });
  it("rejects a hierarchy deeper than the computation limit",()=>{
    const nodes=Array.from({length:9},(_,i)=>({id:`n${i}`,type:"Node2D",name:`N${i}`,...(i?{parent_id:`n${i-1}`}:{})}));
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes},loadTreePolicy())).toThrow();
  });
  it("rejects names that Godot would repair instead of silently renaming",()=>{
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Not/A/Name"}]},loadTreePolicy())).toThrow();
  });
  it("rejects nonliteral scene paths instead of normalizing traversal",()=>{
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://levels/../x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group"}]},loadTreePolicy())).toThrow();
  });
  it("reports malformed fields with a bounded domain error, not raw schema diagnostics",()=>{
    let error:unknown;try{parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[],unexpected:"not-to-be-echoed"},loadTreePolicy());}catch(e){error=e;}
    expect(error).toHaveProperty("code","INVALID_TREE_PLAN");expect((error as Error).message).not.toContain("not-to-be-echoed");
  });
  it("counts the request byte budget in UTF-8 before schema traversal",()=>{
    const input={schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group",properties:{unused:"あ".repeat(45000)}}]};
    expect(()=>parseTreeRequest(input,loadTreePolicy())).toThrow(/byte budget/);
  });
  it("bounds specified properties on each node before interpreting them",()=>{
    const properties=Object.fromEntries(Array.from({length:33},(_,i)=>[`p${i}`,i]));
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group",properties}]},loadTreePolicy())).toThrow(/property count/);
  });
  it("rejects properties outside the node class policy",()=>{
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group",properties:{script:"res://arbitrary.gd"}}]},loadTreePolicy())).toThrow(/UNSUPPORTED_PROPERTY|not an allowed property/);
  });
  it("does not coerce a string into a boolean property",()=>{
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group",properties:{visible:"false"}}]},loadTreePolicy())).toThrow();
  });
  it("does not interpret numeric strings as numeric property values",()=>{
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group",properties:{rotation:"0.5"}}]},loadTreePolicy())).toThrow();
  });
  it("requires Vector2 to contain two finite numeric components",()=>{
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group",properties:{position:["10",20]}}]},loadTreePolicy())).toThrow();
  });
  it("rejects enum values outside the explicit native set",()=>{
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Control",name:"Group",properties:{mouse_filter:999}}]},loadTreePolicy())).toThrow();
  });
  it("bounds literal text by UTF-8 bytes rather than character count",()=>{
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Control",name:"Group"},{id:"label",parent_id:"group",type:"Label",name:"Label",properties:{text:"あ".repeat(683)}}]},loadTreePolicy())).toThrow();
  });
  it("rejects named Color expressions while retaining the documented hex/array formats",()=>{
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group"},{id:"visual",parent_id:"group",type:"Sprite2D",name:"Visual",properties:{modulate:"red"}}]},loadTreePolicy())).toThrow();
  });
  it("refuses Script and unsupported classes in an embedded Resource",()=>{
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group"},{id:"shape",parent_id:"group",type:"CollisionShape2D",name:"Shape",properties:{shape:{new:"GDScript",properties:{}}}}]},loadTreePolicy())).toThrow();
  });
  it("validates embedded Resource properties before any native decoding",()=>{
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group"},{id:"shape",parent_id:"group",type:"CollisionShape2D",name:"Shape",properties:{shape:{new:"RectangleShape2D",properties:{size:"Vector2(24,32)"}}}}]},loadTreePolicy())).toThrow();
  });
  it("checks capsule diameter and height together against native defaults",()=>{
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group"},{id:"shape",parent_id:"group",type:"CollisionShape2D",name:"Shape",properties:{shape:{new:"CapsuleShape2D",properties:{radius:10,height:10}}}}]},loadTreePolicy())).toThrow();
  });
  it("permits only literal PNG reference specifications for textures",()=>{
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group"},{id:"visual",parent_id:"group",type:"Sprite2D",name:"Visual",properties:{texture:{res:"res://assets/payload.tres"}}}]},loadTreePolicy())).toThrow();
  });
  it("enforces the total property computation budget before individual property interpretation",()=>{
    const properties={anchor_left:0,anchor_top:0,anchor_right:0,anchor_bottom:0,offset_left:0,offset_top:0,offset_right:0,offset_bottom:0,custom_minimum_size:[0,0],size_flags_horizontal:0,size_flags_vertical:0,mouse_filter:0,visible:true,text:"Label",horizontal_alignment:0,vertical_alignment:0,autowrap_mode:0,"theme_override_colors/font_color":"#ffffff","theme_override_font_sizes/font_size":16};
    expect(Object.keys(properties)).toHaveLength(19);
    const nodes=[{id:"group",type:"Control",name:"Group"},...Array.from({length:28},(_,i)=>({id:`label${i}`,parent_id:"group",type:"Label",name:`Label${i}`,properties}))];
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes},loadTreePolicy())).toThrow(/total property count/);
  });
  it("bounds distinct PNG paths across the complete request",()=>{
    const nodes=[{id:"group",type:"Node2D",name:"Group"},...Array.from({length:17},(_,i)=>({id:`sprite${i}`,parent_id:"group",type:"Sprite2D",name:`Sprite${i}`,properties:{texture:{res:`res://assets/image${i}.png`}}}))];
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes},loadTreePolicy())).toThrow(/PNG reference count/);
  });
  it("includes embedded Resource properties in the total computation budget",()=>{
    const input={schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group",properties:{position:[0,0]}},{id:"shape",parent_id:"group",type:"CollisionShape2D",name:"Shape",properties:{shape:{new:"RectangleShape2D",properties:{size:[24,32]}}}}]};
    const allowed=loadTreePolicy();allowed.limits.properties_total=3;expect(parseTreeRequest(input,allowed).nodes).toHaveLength(2);
    const tight=loadTreePolicy();tight.limits.properties_total=2;expect(()=>parseTreeRequest(input,tight)).toThrow(/total property count/);
  });
  it("counts each embedded Resource rather than counting only returned nodes",()=>{
    const input={schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group"},...Array.from({length:2},(_,i)=>({id:`shape${i}`,parent_id:"group",type:"CollisionShape2D",name:`Shape${i}`,properties:{shape:{new:"CircleShape2D",properties:{radius:6}}}}))]};
    const allowed=loadTreePolicy();allowed.limits.resources=2;expect(parseTreeRequest(input,allowed).nodes).toHaveLength(3);
    const tight=loadTreePolicy();tight.limits.resources=1;expect(()=>parseTreeRequest(input,tight)).toThrow(/Resource count/);
  });
  it("rejects excessive Resource nesting before interpreting an invalid leaf",()=>{
    let value:Record<string,unknown>={new:"StyleBoxFlat",properties:{bg_color:"#ffffff"}};for(let i=0;i<4;i++)value={new:"StyleBoxFlat",properties:{bg_color:value}};
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Control",name:"Group"},{id:"panel",parent_id:"group",type:"PanelContainer",name:"Panel",properties:{"theme_override_styles/panel":value}}]},loadTreePolicy())).toThrow(/Resource nesting/);
  });
  it("bounds ordinary arrays before interpreting a typed Vector2",()=>{
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group",properties:{position:Array(65).fill(0)}}]},loadTreePolicy())).toThrow(/array count/);
  });
  it("bounds every string before interpreting unsupported metadata",()=>{
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"N".repeat(2049),name:"Group"}]},loadTreePolicy())).toThrow(/string byte budget/);
  });
  it("bounds generic JSON nesting before recursive schema validation",()=>{
    let value:Record<string,unknown>={};for(let i=0;i<40;i++)value={nested:value};
    expect(()=>parseTreeRequest({schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group",properties:{position:value}}]},loadTreePolicy())).toThrow(/JSON nesting/);
  });
  it("rejects dangerous object keys instead of letting a schema silently drop them",()=>{
    const input=JSON.parse('{"schema_version":1,"scene":"res://x.tscn","nodes":[{"id":"group","type":"Node2D","name":"Group","properties":{"__proto__":{"visible":false}}}]}');
    expect(()=>parseTreeRequest(input,loadTreePolicy())).toThrow();
  });
  it("keeps constructor as a literal ID and allows equal names under different parents",()=>{
    const input={schema_version:1,scene:"res://日本語/x.tscn",nodes:[{id:"constructor",type:"Node2D",name:"ゲーム"},{id:"left",parent_id:"constructor",type:"Node2D",name:"Left"},{id:"right",parent_id:"constructor",type:"Node2D",name:"Right"},{id:"left_item",parent_id:"left",type:"Node2D",name:"同じ"},{id:"right_item",parent_id:"right",type:"Node2D",name:"同じ"}]};
    const result=parseTreeRequest(input,loadTreePolicy());expect(result.nodes[0]?.id).toBe("constructor");expect(result.scene).toBe(input.scene);expect(result.nodes).toHaveLength(5);
  });
  it("preserves typed 2D values, private shapes and PNG references",()=>{
    const input={schema_version:1,scene:"res://x.tscn",nodes:[{id:"group",type:"Node2D",name:"Group",properties:{position:[0.1,-20],scale:[-1,1],rotation:0.5,visible:false,z_index:2}},{id:"shape",parent_id:"group",type:"CollisionShape2D",name:"Shape",properties:{shape:{new:"CapsuleShape2D",properties:{height:15,radius:6}},disabled:false}},{id:"visual",parent_id:"group",type:"Sprite2D",name:"Visual",properties:{texture:{res:"res://assets/絵.png"},modulate:[0.25,0.5,0.75,1]}}]};
    const result=parseTreeRequest(input,loadTreePolicy());expect(result.nodes).toEqual(input.nodes);expect(result.dry_run).toBe(false);
  });
});

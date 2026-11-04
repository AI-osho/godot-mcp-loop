import {describe,expect,it} from "vitest";
import {decodeTreePolicy,loadTreePolicy} from "../src/tree-policy.js";

describe("bundled tree policy",()=>{
  it("decodes the complete native-checked policy through a pure text boundary",()=>{
    const policy=loadTreePolicy();
    expect(decodeTreePolicy(JSON.stringify(policy))).toEqual(policy);
    expect(Object.keys(policy.nodes)).toHaveLength(19);
    expect(Object.keys(policy.resources)).toHaveLength(4);
  });
  it("rejects duplicate JSON keys rather than accepting the last value",()=>{
    const text=JSON.stringify(loadTreePolicy()).replace('"schema_version":1','"schema_version":1,"schema_version":1');
    expect(()=>decodeTreePolicy(text)).toThrow();
  });
  it("rejects policy limits above the fixed version-one safety ceiling",()=>{
    const policy=loadTreePolicy();policy.limits.nodes=65;
    expect(()=>decodeTreePolicy(JSON.stringify(policy))).toThrow();
  });
  it("rejects impossible numeric policy ranges",()=>{
    const policy=loadTreePolicy();const rule=policy.nodes.Node2D.position;
    expect(rule?.kind).toBe("vector2");if(rule&&"min" in rule){rule.min=1;rule.max=0;}
    expect(()=>decodeTreePolicy(JSON.stringify(policy))).toThrow();
  });
  it("bounds decoded policy text before parsing it",()=>{
    const text=" ".repeat(65537)+JSON.stringify(loadTreePolicy());
    expect(()=>decodeTreePolicy(text)).toThrow();
  });
  it("rejects identity and code fields in a malformed bundled property policy",()=>{
    const policy=loadTreePolicy();policy.nodes.Node2D.script={kind:"text"};
    expect(()=>decodeTreePolicy(JSON.stringify(policy))).toThrow();
  });
  it("rejects duplicate enum alternatives in policy data",()=>{
    const policy=loadTreePolicy();const rule=policy.nodes.Control.mouse_filter;
    expect(rule?.kind).toBe("enum");if(rule?.kind==="enum")rule.values.push(rule.values[0]!);
    expect(()=>decodeTreePolicy(JSON.stringify(policy))).toThrow();
  });
  it("rejects inconsistent stored capsule defaults",()=>{
    const policy=loadTreePolicy();policy.capsule_defaults.height=1;
    expect(()=>decodeTreePolicy(JSON.stringify(policy))).toThrow();
  });
});

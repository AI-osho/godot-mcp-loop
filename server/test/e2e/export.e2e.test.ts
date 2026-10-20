import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkTemplates } from "../../src/export.js";
import { findGodot } from "../../src/editor-launcher.js";
import { textOf } from "../helpers.js";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "index.js");

const PREVIEW = `[gd_scene format=3]

[node name="Main" type="Node2D"]
`;

const PRESETS = `[preset.0]

name="Web"
platform="Web"
runnable=true
advanced_options=false
dedicated_server=false
custom_features=""
export_filter="all_resources"
include_filter=""
exclude_filter=""
export_path="build/web/index.html"
patches=PackedStringArray()
encryption_include_filters=""
encryption_exclude_filters=""
seed=0
encrypt_pck=false
encrypt_directory=false
script_export_mode=2

[preset.0.options]
`;

/** A real export needs export templates; skip cleanly when this machine has none. */
async function hasTemplates(): Promise<boolean> {
  try {
    const godot = await findGodot();
    checkTemplates(godot.version);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!(await hasTemplates()))("e2e: project_export", () => {
  let client: Client;
  let project: string;

  beforeAll(async () => {
    project = mkdtempSync(join(tmpdir(), "gml-export-e2e-"));
    writeFileSync(
      join(project, "project.godot"),
      'config_version=5\n\n[application]\n\nconfig/name="Export E2E"\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.7", "GL Compatibility")\n\n[rendering]\n\nrenderer/rendering_method="gl_compatibility"\n',
    );
    writeFileSync(join(project, "main.tscn"), PREVIEW);
    writeFileSync(join(project, "export_presets.cfg"), PRESETS);
    const transport = new StdioClientTransport({ command: process.execPath, args: [DIST, "--project", project] });
    client = new Client({ name: "export", version: "1" }, { capabilities: {} });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
  });

  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });

  it("shows the command on dry_run without exporting", async () => {
    const res = await call("project_export", { preset: "Web", dry_run: true });
    expect(res.isError).toBeFalsy();
    const out = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(out.output).toBe("res://build/web/index.html");
    expect(out.command.slice(1)).toEqual(["--headless", "--path", project, "--export-release", "Web", join(project, "build/web/index.html")]);
    expect(out.dry_run).toBe(true);
  });

  it("exports a Web build into res://build/", async () => {
    const res = await call("project_export", { preset: "Web" });
    expect(res.isError, textOf(res)).toBeFalsy();
    const out = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(out.preset).toBe("Web");
    expect(out.output).toBe("res://build/web/index.html");
    const names = out.files.map((f: { path: string }) => f.path.split("/").pop());
    expect(names).toContain("index.html");
    expect(names.some((n: string) => n.endsWith(".wasm"))).toBe(true);
    expect(out.bytes).toBeGreaterThan(1000);
  }, 180_000);

  it("names the presets it has when the name is wrong", async () => {
    const res = await call("project_export", { preset: "Nope" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("PRESET_NOT_FOUND");
    expect(textOf(res)).toContain("Web");
  });

  it("refuses an output outside res://build/", async () => {
    const res = await call("project_export", { preset: "Web", path: "res://web/index.html" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("PATH_FORBIDDEN");
  });
});

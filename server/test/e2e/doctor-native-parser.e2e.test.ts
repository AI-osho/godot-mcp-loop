import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { diagnose } from "../../src/doctor.js";
import { SERVER_VERSION } from "../../src/version.js";
import { GODOT_BIN } from "./godot-harness.js";

const markerText = 'config_version=5\n[editor_plugins]\nenabled=PackedStringArray("res://addons/mcp_loop/plugin.cfg")\n';
const metadataText = `[plugin]\nversion="${SERVER_VERSION}"\nscript="plugin.gd"\n`;
const probes = { findGodot: async () => ({ path: "/controlled-not-executed", version: "4.7.2.stable.control", source: "default" as const }) };
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function project(marker = markerText, metadata = metadataText): string {
  const root = mkdtempSync(join(tmpdir(), "gml-doctor-native-")); roots.push(root);
  mkdirSync(join(root, "addons/mcp_loop/runtime"), { recursive: true });
  writeFileSync(join(root, "project.godot"), marker);
  writeFileSync(join(root, "addons/mcp_loop/plugin.cfg"), metadata);
  // Presence fixtures only. Native probes never load these project/addon scripts.
  writeFileSync(join(root, "addons/mcp_loop/plugin.gd"), "# controlled presence stub\n");
  writeFileSync(join(root, "addons/mcp_loop/runtime/runtime_agent.gd"), "# controlled presence stub\n");
  return root;
}

function native(root: string, script: string, args: string[], completion: string): { stdout: string; stderr: string } {
  const scriptPath = join(root, "native-oracle.gd");
  writeFileSync(scriptPath, script);
  const result = spawnSync(GODOT_BIN, ["--headless", "--path", root, "--script", scriptPath, "--", ...args], {
    cwd: root, encoding: "utf8", timeout: 15000, maxBuffer: 128 * 1024,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout + result.stderr).not.toContain("SCRIPT ERROR:");
  expect(result.stdout).toContain(completion);
  return { stdout: result.stdout, stderr: result.stderr };
}

it("keeps doctor aligned with native ConfigFile literal syntax without decoding objects or project code", async () => {
  const cases: Array<{ id: string; root: string; file: string; field: string; supported: boolean; quoted?: boolean }> = [];
  const add = (id: string, marker: string, metadata: string, field: string, supported: boolean, quoted = false) => {
    const root = project(marker, metadata);
    cases.push({ id, root, file: join(root, field === "version" ? "addons/mcp_loop/plugin.cfg" : "project.godot"), field, supported, quoted });
  };
  add("ordinary", markerText, metadataText, "enabled", true);
  const description = "説明 \u00a0\u3000\ufeff";
  add("quoted-Unicode", markerText, metadataText + `description="${description}"\n`, "version", true, true);
  // Strictly authored scalar/string/array literals only: native Variant parsing can construct Objects/Resources.
  for (const [label, space] of [["nbsp", "\u00a0"], ["narrow-nbsp", "\u202f"], ["em-space", "\u2003"], ["fullwidth", "\u3000"], ["interior-bom", "\ufeff"]]) {
    add(label + "-key", markerText.replace("enabled=", `enabled${space}=`), metadataText, "enabled", false);
    add(label + "-value", markerText.replace("enabled=", `enabled=${space}`), metadataText, "enabled", false);
    add(label + "-metadata", markerText, metadataText.replace("version=", `version${space}=`), "version", false);
  }
  add("ConfigFile-leading-BOM", markerText, "\ufeff" + metadataText, "version", false);
  const neutral = project("config_version=5\n"), input = join(neutral, "inputs.json"), output = join(neutral, "result.json");
  writeFileSync(input, JSON.stringify(cases));
  const streams = native(neutral, `extends SceneTree
func _init() -> void:
    var args := OS.get_cmdline_user_args()
    var parser := JSON.new()
    if args.size() != 2 or parser.parse(FileAccess.get_file_as_string(args[0])) != OK or not parser.data is Array:
        quit(2)
        return
    var rows: Array = []
    for item in parser.data:
        var config := ConfigFile.new()
        var error := config.load(item["file"])
        var matched := false
        if item["field"] == "enabled" and config.has_section_key("editor_plugins", "enabled"):
            var value: Variant = config.get_value("editor_plugins", "enabled")
            matched = typeof(value) == TYPE_PACKED_STRING_ARRAY and Array(value).has("res://addons/mcp_loop/plugin.cfg")
        elif item["field"] == "version" and config.has_section_key("plugin", "version"):
            var value: Variant = config.get_value("plugin", "version")
            matched = typeof(value) == TYPE_STRING and value == "${SERVER_VERSION}"
        var quoted_matches := true
        if item["quoted"]:
            var value: Variant = config.get_value("plugin", "description", "")
            quoted_matches = typeof(value) == TYPE_STRING and value == "${description}"
        rows.append({"id": item["id"], "error": error, "matched": error == OK and matched, "quoted_matches": quoted_matches})
    var out := FileAccess.open(args[1], FileAccess.WRITE)
    if out == null:
        quit(2)
        return
    out.store_string(JSON.stringify({"rows": rows, "parse_error": ERR_PARSE_ERROR, "editor_hint": Engine.is_editor_hint()}))
    out.close()
    print("DOCTOR_NATIVE_CONFIG_COMPLETE")
    quit(0)
`, [input, output], "DOCTOR_NATIVE_CONFIG_COMPLETE");
  const data = JSON.parse(readFileSync(output, "utf8")) as { rows: Array<{ id: string; error: number; matched: boolean; quoted_matches: boolean }>; parse_error: number; editor_hint: boolean };
  expect(data.editor_hint).toBe(false);
  expect(data.rows.map(row => row.id).sort()).toEqual(cases.map(c => c.id).sort());
  // Only deliberate ConfigFile data parse errors are allowed, not arbitrary native/runtime failures.
  const errors = (streams.stdout + streams.stderr).split(/\r?\n/).filter(line => line.startsWith("ERROR:"));
  expect(errors.every(line => line.startsWith("ERROR: ConfigFile parse error at "))).toBe(true);
  expect(errors.length).toBe(data.rows.filter(row => row.error !== 0).length);
  for (const c of cases) {
    const row = data.rows.find(row => row.id === c.id)!;
    expect([0, data.parse_error], c.id).toContain(row.error);
    expect(row.matched, c.id).toBe(c.supported);
    expect(row.quoted_matches, c.id).toBe(true);
    const before = [readFileSync(join(c.root, "project.godot")), readFileSync(join(c.root, "addons/mcp_loop/plugin.cfg"))];
    const report = await diagnose(c.root, {}, probes);
    expect(report.status, c.id).toBe(c.supported ? "ok" : "not_checked");
    expect(report.runtime.status, c.id).toBe("not_checked");
    expect([readFileSync(join(c.root, "project.godot")), readFileSync(join(c.root, "addons/mcp_loop/plugin.cfg"))]).toEqual(before);
  }
});

it("matches actual ProjectSettings for a valid marker, project BOM and literal NBSP key", async () => {
  for (const [id, marker, supported] of [["ordinary", markerText, true], ["project-BOM", "\ufeff" + markerText, true], ["NBSP-key", markerText.replace("enabled=", "enabled\u00a0="), false]] as const) {
    // All three are syntactically loadable project files; never bootstrap a malformed project into the editor fallback.
    const root = project(marker), output = join(root, "settings.json");
    const streams = native(root, `extends SceneTree
func _init() -> void:
    var args := OS.get_cmdline_user_args()
    if args.size() != 1:
        quit(2)
        return
    var value: Variant = ProjectSettings.get_setting("editor_plugins/enabled", null)
    var enabled := false
    if typeof(value) == TYPE_PACKED_STRING_ARRAY:
        enabled = Array(value).has("res://addons/mcp_loop/plugin.cfg")
    var out := FileAccess.open(args[0], FileAccess.WRITE)
    if out == null:
        quit(2)
        return
    out.store_string(JSON.stringify({"enabled": enabled, "editor_hint": Engine.is_editor_hint()}))
    out.close()
    print("DOCTOR_NATIVE_SETTINGS_COMPLETE")
    quit(0)
`, [output], "DOCTOR_NATIVE_SETTINGS_COMPLETE");
    expect(streams.stdout + streams.stderr, id).not.toMatch(/\bERROR:/);
    const actual = JSON.parse(readFileSync(output, "utf8")) as { enabled: boolean; editor_hint: boolean };
    expect(actual.editor_hint, id).toBe(false);
    expect(actual.enabled, id).toBe(supported);
    const report = await diagnose(root, {}, probes);
    expect(report.status, id).toBe(supported ? "ok" : "not_checked");
    expect(report.checks.some(c => c.code === "ADDON_ENABLED"), id).toBe(supported);
  }
});

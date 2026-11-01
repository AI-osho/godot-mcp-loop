import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

function workerProbe(body: string): Record<string, unknown> {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "gml-art-generation-")));
  try {
    const bootstrap = String.raw`
import hashlib, importlib.util, io, json, pathlib, sys
from PIL import Image
worker, project = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
sys.path.insert(0, str(worker.parent))
spec = importlib.util.spec_from_file_location("candidate_worker", worker)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
Image.new("RGBA", (4,4), (220,30,60,255)).save(project / "source.png")
def build(name):
    return m.build({"project":str(project),"output_root":"res://assets/generated/"+name,
        "recipe":{"version":1,"assets":[{"id":"actor","source":"res://source.png","fit":"copy","key":"none"}]}})
def alternate():
    buf = io.BytesIO()
    Image.new("RGBA", (4,4), (20,80,230,255)).save(buf, format="PNG")
    return buf.getvalue()
`;
    const python = process.env.GODOT_LOOP_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
    return JSON.parse(execFileSync(python, ["-B", "-E", "-c", bootstrap + body,
      fileURLToPath(new URL("../authoring/worker.py", import.meta.url)), project], { encoding: "utf8", timeout: 20000 }));
  } finally { rmSync(project, { recursive: true, force: true }); }
}

it("decodes the exact byte generation whose checksum verify accepted", () => {
  const result = workerProbe(String.raw`
built = build("snapshot")
output = project / "assets/generated/snapshot/actor.png"
replacement = alternate()
replacement_hash = hashlib.sha256(replacement).hexdigest()
real_open, real_decode = pathlib.Path.open, Image.open
injected, decoded = [False], []
class SwappingRead:
    def __init__(self, file): self.file = file
    def __enter__(self): self.file.__enter__(); return self
    def __exit__(self, *args): return self.file.__exit__(*args)
    def __getattr__(self, name): return getattr(self.file, name)
    def read(self, *args):
        data = self.file.read(*args)
        if not injected[0]:
            injected[0] = True
            with real_open(output, "wb") as other: other.write(replacement)
        return data

def swap_after_capture(path, mode="r", *args, **kwargs):
    file = real_open(path, mode, *args, **kwargs)
    return SwappingRead(file) if path == output and mode == "rb" and not injected[0] else file

def observe_decode(source, *args, **kwargs):
    if isinstance(source, io.BytesIO): decoded.append(hashlib.sha256(source.getvalue()).hexdigest())
    return real_decode(source, *args, **kwargs)
pathlib.Path.open, Image.open = swap_after_capture, observe_decode
report = m.verify({"project":str(project),"manifest":built["manifest"]})
assert injected[0], "Fault injection never reached the actual output read"
assert report["passed"], report
assert replacement_hash not in decoded, "PNG decoder consumed unchecked replacement bytes after checksum validation"
assert built["outputs"][0]["sha256"] in decoded
print(json.dumps({"injected":True,"snapshot_checked":True,"unchecked_decode":False}))
`);
  expect(result).toEqual({ injected: true, snapshot_checked: true, unchecked_decode: false });
});

it("refuses reparse-point metadata before opening any artwork bytes", () => {
  const result = workerProbe(String.raw`
art = project / "art"
art.mkdir()
source = art / "source.png"
source.write_bytes((project / "source.png").read_bytes())
real_lstat, real_open = pathlib.Path.lstat, pathlib.Path.open
opened = []
class ReparseStat:
    st_reparse_tag = 0xA0000003
    st_file_attributes = 0x400
    def __init__(self, native): self.native = native
    def __getattr__(self, key): return getattr(self.native, key)
def reparse_metadata(path, *args, **kwargs):
    native = real_lstat(path, *args, **kwargs)
    return ReparseStat(native) if path == art else native
def observe_open(path, *args, **kwargs):
    if path == source: opened.append(str(path))
    return real_open(path, *args, **kwargs)
pathlib.Path.lstat, pathlib.Path.open = reparse_metadata, observe_open
error = None
try:
    m.load_png(str(project), "res://art/source.png")
except m.Failure as exc:
    error = exc.code
assert error == "PATH_FORBIDDEN", error
assert not opened, "Source bytes were opened through reparse metadata"
pathlib.Path.lstat = real_lstat
image, identity, _ = m.load_png(str(project), "res://art/source.png")
assert image.size == (4,4) and len(opened) == 1
print(json.dumps({"code":error,"rejected_before_open":True,"ordinary_path_passed":True}))
`);
  expect(result).toEqual({ code: "PATH_FORBIDDEN", rejected_before_open: true, ordinary_path_passed: true });
});

it.skipIf(process.platform === "win32")("preserves a directory claimed after the final build path check", () => {
  const result = workerProbe(String.raw`
import os, stat
out_res = "res://assets/generated/claimed"
out = project / "assets/generated/claimed"
real_safe = m.safe_path
claim = []
def claim_after_final_check(root, value):
    path = real_safe(root, value)
    if value == out_res and out.parent.exists() and not claim:
        complete_stage = any((entry / "manifest.sha256").exists() for entry in out.parent.iterdir() if entry.name.startswith(".gml-assets-"))
        if complete_stage:
            out.mkdir(mode=0o700)
            claim.append((out.stat().st_ino, stat.S_IMODE(out.stat().st_mode)))
    return path
m.safe_path = claim_after_final_check
error = None
try:
    build("claimed")
except m.Failure as exc:
    error = exc.code
assert claim, "The final publication boundary was not exercised"
assert error == "ALREADY_EXISTS", "A concurrently claimed empty output directory was replaced: %s" % error
assert (out.stat().st_ino, stat.S_IMODE(out.stat().st_mode)) == claim[0]
assert list(out.iterdir()) == []
assert not any(entry.name.startswith(".gml-assets-") for entry in out.parent.iterdir())
m.safe_path = real_safe
positive = build("unclaimed")
assert m.verify({"project":str(project),"manifest":positive["manifest"]})["passed"]
print(json.dumps({"code":error,"claim_preserved":True,"positive_passed":True}))
`);
  expect(result).toEqual({ code: "ALREADY_EXISTS", claim_preserved: true, positive_passed: true });
});

it.each(["png", "manifest"])("rejects preview generation changes after verification (%s)", (change) => {
  const result = workerProbe(String.raw`
change = ${JSON.stringify(change)}
built = build("preview")
output = project / "assets/generated/preview/actor.png"
original = output.read_bytes()
real_verify = m.verify
injected = [False]
def change_after_verified(request):
    report = real_verify(request)
    assert report["passed"], report
    injected[0] = True
    if change == "png":
        output.write_bytes(alternate())
    else:
        manifest = project / "assets/generated/preview/manifest.json"
        doc = json.loads(manifest.read_bytes())
        doc["note"] = "Controlled concurrent metadata edit"
        manifest.write_text(json.dumps(doc))
    return report
m.verify = change_after_verified
error = None
try:
    m.preview({"project":str(project),"manifest":built["manifest"],"asset_id":"actor"})
except m.Failure as exc:
    error = exc.code
assert injected[0], "The real verification path was not exercised"
assert error == "ARTIFACT_CHANGED", (change, error)
m.verify = real_verify
if change == "png":
    output.write_bytes(original)
    good = m.preview({"project":str(project),"manifest":built["manifest"],"asset_id":"actor"})
    assert good["source_sha256"] == built["outputs"][0]["sha256"]
print(json.dumps({"changed":change,"code":error}))
`);
  expect(result).toEqual({ changed: change, code: "ARTIFACT_CHANGED" });
});

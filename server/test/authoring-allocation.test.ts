import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { encodePng } from "../src/media/png.js";

it("refuses impossible pose geometry before an oversized intermediate resize, while retaining a fitting pose", () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "gml-art-allocation-")));
  try {
    writeFileSync(join(project, "wide.png"), encodePng({ width: 16, height: 1, data: new Uint8Array(64).fill(255) }));
    const script = String.raw`
import importlib.util, json, pathlib, sys
from PIL import Image
worker, project = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
sys.path.insert(0, str(worker.parent))
spec = importlib.util.spec_from_file_location("candidate_worker", worker)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
resize = Image.Image.resize
oversized = []
def bounded(image, size, *args, **kwargs):
    if size[0] * size[1] > m.MAX_PIXELS:
        oversized.append(list(size))
        raise RuntimeError("CONTROLLED unsafe intermediate resize; no allocation performed")
    return resize(image, size, *args, **kwargs)
Image.Image.resize = bounded
bad = {"id":"wide","source":"res://wide.png","fit":"pose","key":"none","frame_size":[4000,4000],"foot_anchor":[2000,4000],"target_height":4000}
error = None
try:
    m.build({"project":str(project),"output_root":"res://assets/generated/bad","recipe":{"version":1,"assets":[bad]}})
except Exception as exc:
    error = {"code":getattr(exc,"code",None),"message":str(exc)}
assert not oversized, "Oversized intermediate resize was reached: %s" % oversized
assert error and error["code"] == "INVALID_RECIPE", error
assert not (project / "assets").exists()
good = {**bad,"frame_size":[64,32],"foot_anchor":[32,30],"target_height":2}
built = m.build({"project":str(project),"output_root":"res://assets/generated/good","recipe":{"version":1,"assets":[good]}})
assert len(built["outputs"]) == 1
assert built["outputs"][0]["width"] == 64 and built["outputs"][0]["height"] == 32
assert not oversized
print(json.dumps({"rejected":error,"oversized_resize_attempts":oversized,"positive_dimensions":[64,32]}))
`;
    const python = process.env.GODOT_LOOP_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
    const result = JSON.parse(execFileSync(python, ["-B", "-E", "-c", script,
      fileURLToPath(new URL("../authoring/worker.py", import.meta.url)), project], { encoding: "utf8", timeout: 20000 }));
    expect(result.rejected.code).toBe("INVALID_RECIPE");
    expect(result.oversized_resize_attempts).toEqual([]);
    expect(result.positive_dimensions).toEqual([64, 32]);
    expect(existsSync(join(project, "assets/generated/bad"))).toBe(false);
  } finally { rmSync(project, { recursive: true, force: true }); }
});

it("bounds retained source selections before repeated full-image copies and still accepts a smaller batch", () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "gml-art-selection-")));
  try {
    const script = String.raw`
import importlib.util, json, pathlib, sys
from PIL import Image
worker, project = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
sys.path.insert(0, str(worker.parent))
spec = importlib.util.spec_from_file_location("candidate_worker", worker)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
Image.new("RGBA", (4000,4000), (30,80,120,255)).save(project / "large.png")
real_load, real_copy = m.load_png, Image.Image.copy
source_ids, attempts = set(), []
def remember(*args):
    result = real_load(*args)
    source_ids.add(id(result[0]))
    return result
def no_large_copy(image, *args, **kwargs):
    if id(image) in source_ids and sys._getframe(1).f_code.co_name == "build":
        attempts.append(image.width * image.height)
        if sum(attempts) > 64_000_000:
            raise RuntimeError("CONTROLLED excessive retained selection; duplicate allocation not performed")
        return image  # Count the requested selection without allocating repeated 64 MB copies.
    return real_copy(image, *args, **kwargs)
m.load_png, Image.Image.copy = remember, no_large_copy
def assets(n):
    return [{"id":"pose%d"%i,"source":"res://large.png","fit":"pose","key":"none","frame_size":[2,2],"foot_anchor":[1,2],"target_height":1} for i in range(n)]
error = None
try:
    m.build({"project":str(project),"output_root":"res://assets/generated/bad","recipe":{"version":1,"assets":assets(5)}})
except Exception as exc:
    error = {"code":getattr(exc,"code",None),"message":str(exc)}
assert sum(attempts) <= 64_000_000, "Excess retained source selections were reached: %s" % attempts
assert error and error["code"] == "INVALID_RECIPE", error
assert not (project / "assets").exists()
rejected_attempts = list(attempts)
source_ids.clear(); attempts.clear()
built = m.build({"project":str(project),"output_root":"res://assets/generated/good","recipe":{"version":1,"assets":assets(2)}})
assert len(built["outputs"]) == 2
print(json.dumps({"rejected":error,"rejected_selection_pixels":sum(rejected_attempts),"positive_output_count":2}))
`;
    const python = process.env.GODOT_LOOP_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
    const result = JSON.parse(execFileSync(python, ["-B", "-E", "-c", script,
      fileURLToPath(new URL("../authoring/worker.py", import.meta.url)), project], { encoding: "utf8", timeout: 20000 }));
    expect(result.rejected.code).toBe("INVALID_RECIPE");
    expect(result.rejected_selection_pixels).toBeLessThanOrEqual(64_000_000);
    expect(result.positive_output_count).toBe(2);
    expect(existsSync(join(project, "assets/generated/bad"))).toBe(false);
  } finally { rmSync(project, { recursive: true, force: true }); }
});

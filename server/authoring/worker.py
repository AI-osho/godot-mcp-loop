"""Fixed, JSON-only image worker. No network, shell or model authentication."""
import base64
import ctypes
import errno
import hashlib
import io
import json
import os
import pathlib
import re
import shutil
import tempfile
import stat
import sys
import warnings

MAX_BYTES = 32_000_000
MAX_PIXELS = 16_000_000
REQUIRED_PILLOW = "13.0.0"
PROTECTED = {".git", ".godot", "addons", ".claude", ".github", "node_modules"}


class Failure(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def safe_path(project, value):
    if not isinstance(value, str) or not value.startswith("res://"):
        raise Failure("PATH_FORBIDDEN", "Use a project-local res:// path")
    parts = value[6:].split("/")
    if not parts or any(not p or p in (".", "..") or p.lower() in PROTECTED or
                        p.endswith((".", " ")) or any(ord(c) < 32 or c in "\\:\ufffd" for c in p) for p in parts):
        raise Failure("PATH_FORBIDDEN", "Unsafe production path")
    root = pathlib.Path(project).resolve(strict=True)
    current = root
    protected = [root / p for p in PROTECTED if (root / p).exists()]
    for part in parts:
        current = current / part
        try:
            entry = current.lstat()
        except FileNotFoundError:
            entry = None
        if entry is not None and (stat.S_ISLNK(entry.st_mode) or getattr(entry, "st_reparse_tag", 0) or
                                  getattr(entry, "st_file_attributes", 0) & 0x400):
            raise Failure("PATH_FORBIDDEN", "Symlinks and reparse points are not production inputs or outputs")
        if current.exists():
            if any(current.samefile(p) for p in protected):
                raise Failure("PATH_FORBIDDEN", "Physical alias of a protected folder")
            if not (current.is_dir() or current.is_file()):
                raise Failure("PATH_FORBIDDEN", "Special files are not allowed")
    if not current.resolve(strict=False).is_relative_to(root):
        raise Failure("PATH_FORBIDDEN", "Path escapes project")
    return current


def load_png(project, value):
    path = safe_path(project, value)
    with path.open("rb") as f:
        st = os.fstat(f.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_size > MAX_BYTES:
            raise Failure("INVALID_IMAGE", "PNG must be a regular file of at most 32 MB")
        data = f.read(MAX_BYTES + 1)
    return decode_png(value, data)


def decode_png(value, data):
    """Decode only the captured byte generation used for identity validation."""
    from PIL import Image
    if len(data) > MAX_BYTES or not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise Failure("INVALID_IMAGE", "Expected PNG bytes")
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(data)) as image:
            if image.format != "PNG" or image.width * image.height > MAX_PIXELS or getattr(image, "n_frames", 1) != 1:
                raise Failure("INVALID_IMAGE", "Expected one bounded PNG image, not an animation")
            image.load()
            rgba = image.convert("RGBA")
    identity = {"path": value, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "width": rgba.width, "height": rgba.height}
    return rgba, identity, data


def toolchain():
    import PIL
    here = pathlib.Path(__file__).resolve().parent
    return {"pillow": PIL.__version__, "python": sys.version.split()[0], "files": {
        name: hashlib.sha256((here / name).read_bytes()).hexdigest()
        for name in ("worker.py", "core/images.py", "core/atlas.py", "requirements.txt")}}


def file_identity(project, path):
    file = safe_path(project, path)
    with file.open("rb") as f:
        st = os.fstat(f.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_size > MAX_BYTES:
            raise Failure("INVALID_DATA", "Unbounded or special provenance file")
        data = f.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise Failure("INVALID_DATA", "Provenance file grew beyond its limit")
    return {"path": path, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


def art_provenance(project, path, image_identity):
    record, record_identity = read_json(project, path)
    if not isinstance(record, dict) or record.get("schema") != "godot-loop-art/v1" or record.get("decision") != "accepted" or record.get("image") != image_identity:
        raise Failure("ARTIFACT_CHANGED", "Artwork record must accept and match the actual source PNG")
    request_ref = record.get("request")
    if not isinstance(request_ref, dict):
        raise Failure("INVALID_DATA", "Invalid artwork request identity")
    request, request_identity = read_json(project, request_ref["path"])
    if request_identity["sha256"] != request_ref.get("sha256") or not isinstance(request, dict) or request.get("schema") != "godot-loop-art-request/v1":
        raise Failure("ARTIFACT_CHANGED", "Artwork request changed")
    generation = request.get("generation")
    if not isinstance(generation, dict) or any(generation.get(k) != v for k, v in {"provider": "openai-codex", "model": "gpt-image-2-medium", "quality": "medium"}.items()):
        raise Failure("INVALID_DATA", "Artwork request does not match the approved generation policy")
    recorded_generation = record.get("generation")
    if not isinstance(recorded_generation, dict) or recorded_generation.get("requested") != generation:
        raise Failure("INVALID_DATA", "Recorded request policy does not match its request")
    plan_ref = request.get("plan")
    if not isinstance(plan_ref, dict):
        raise Failure("INVALID_DATA", "Missing production-plan identity")
    plan, plan_identity = read_json(project, plan_ref["path"])
    if plan_identity["sha256"] != plan_ref.get("sha256") or not isinstance(plan, dict) or plan.get("schema") != "godot-loop-production/v1":
        raise Failure("ARTIFACT_CHANGED", "Production plan changed")
    metadata = [record_identity, request_identity, plan_identity]
    response = record.get("response")
    if response is not None:
        if not isinstance(response, dict):
            raise Failure("INVALID_DATA", "Invalid raw response identity")
        response_identity = file_identity(project, response["path"])
        if response_identity != response:
            raise Failure("ARTIFACT_CHANGED", "Raw producer response changed")
        metadata.append(response_identity)
    for reference in request.get("references", []):
        identity = file_identity(project, reference["path"])
        if identity["sha256"] != reference.get("sha256"):
            raise Failure("ARTIFACT_CHANGED", "Artwork reference changed")
        metadata.append(identity)
    return metadata, {"record": path, "source": image_identity["path"], "asset_id": record.get("asset_id"),
                      "generation": recorded_generation, "decision": record["decision"], "claims_are_not_independent_model_or_rights_proof": True}


def frame_anchor(asset, image):
    return asset.get("foot_anchor", [0, 0] if asset["fit"] == "copy" else [image.width // 2, asset.get("foot_y", image.height // 2)])


def publish_directory_once(stage, out):
    """Atomically publish a completed directory without replacing any claimant."""
    try:
        if sys.platform == "win32":
            # Windows rename refuses an existing destination (including empty dirs).
            os.rename(stage, out)
            return
        libc = ctypes.CDLL(None, use_errno=True)
        if sys.platform == "darwin" and hasattr(libc, "renamex_np"):
            rename = libc.renamex_np
            rename.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
            rename.restype = ctypes.c_int
            result = rename(os.fsencode(stage), os.fsencode(out), 4)  # RENAME_EXCL
        elif sys.platform.startswith("linux") and hasattr(libc, "renameat2"):
            rename = libc.renameat2
            rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
            rename.restype = ctypes.c_int
            result = rename(-100, os.fsencode(stage), -100, os.fsencode(out), 1)  # AT_FDCWD, RENAME_NOREPLACE
        else:
            raise Failure("DEPENDENCY_MISSING", "This platform lacks atomic no-replace directory publication")
        if result != 0:
            code = ctypes.get_errno()
            raise OSError(code, os.strerror(code))
    except OSError as error:
        if error.errno in (errno.EEXIST, errno.ENOTEMPTY):
            raise Failure("ALREADY_EXISTS", "Build output was claimed by another writer") from error
        raise


def build(request):
    from core.images import fit_pose, fit_icon, fit_scaled_frame, keyed_crop, key_magenta_background
    project, out_res = request["project"], request["output_root"]
    if not re.fullmatch(r"res://assets/generated/[a-z][a-z0-9_-]{0,47}", out_res):
        raise Failure("PATH_FORBIDDEN", "Use a new res://assets/generated/<unique-id> folder")
    out = safe_path(project, out_res)
    if out.exists():
        raise Failure("ALREADY_EXISTS", "Build output already exists; choose a new build ID")
    recipe = request["recipe"]
    if recipe.get("version") != 1 or not isinstance(recipe.get("assets"), list) or not 1 <= len(recipe["assets"]) <= 64:
        raise Failure("INVALID_RECIPE", "Expected recipe version 1 with 1..64 assets")
    ids, sources, prepared, selected_assets = set(), {}, [], []
    pixels, selected_pixels = 0, 0
    metadata, generation_records = {}, {}
    for asset in recipe["assets"]:
        name = asset["id"]
        if not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{0,47}", name) or name in ids:
            raise Failure("INVALID_RECIPE", "Asset IDs must be safe and unique")
        ids.add(name)
        src = asset["source"]
        if src not in sources:
            sources[src] = load_png(project, src)
            if sum(x[0].width * x[0].height for x in sources.values()) > 64_000_000:
                raise Failure("INVALID_RECIPE", "Source images exceed the aggregate pixel limit")
        if asset.get("art_record"):
            identities, generation = art_provenance(project, asset["art_record"], sources[src][1])
            for identity in identities:
                metadata[identity["path"]] = identity
            generation_records[asset["art_record"]] = generation
        original = sources[src][0]
        size = list(original.size) if asset["fit"] == "copy" else asset.get("frame_size")
        if not isinstance(size, list) or len(size) != 2 or any(type(v) is not int or not 1 <= v <= 4096 for v in size):
            raise Failure("INVALID_RECIPE", "Invalid frame size")
        if size[0] * size[1] > MAX_PIXELS:
            raise Failure("INVALID_RECIPE", "Output frame exceeds the 16 million pixel PNG limit")
        pixels += size[0] * size[1]
        if pixels > 64_000_000:
            raise Failure("INVALID_RECIPE", "Output frames exceed the aggregate pixel limit")
        if asset["fit"] == "copy" and (asset["key"] != "none" or asset.get("crop") is not None):
            raise Failure("INVALID_RECIPE", "copy preserves the complete original PNG; do not key or crop")
        crop = asset.get("crop")
        if crop is not None:
            if len(crop) != 4 or not all(type(v) is int for v in crop) or not (0 <= crop[0] < crop[2] <= original.width and 0 <= crop[1] < crop[3] <= original.height):
                raise Failure("INVALID_RECIPE", "Crop outside source image")
        selected_pixels += (crop[2] - crop[0]) * (crop[3] - crop[1]) if crop is not None else original.width * original.height
        if selected_pixels > 64_000_000:
            raise Failure("INVALID_RECIPE", "Selected artwork exceeds the aggregate working pixel limit")
        if crop is not None:
            selected = keyed_crop(original, crop) if asset["key"] == "magenta" else original.crop(crop)
        else:
            selected = key_magenta_background(original) if asset["key"] == "magenta" else original.copy()
        if asset["fit"] != "copy" and selected.getchannel("A").getbbox() is None:
            raise Failure("INVALID_RECIPE", "Empty artwork after keying or crop")
        selected_assets.append((asset, selected, size))
    group_scales = {}
    for group in recipe.get("scale_groups", []):
        name = group["id"]
        if name in group_scales or type(group["target_height"]) is not int or not 1 <= group["target_height"] <= 4096:
            raise Failure("INVALID_RECIPE", "Invalid or repeated scale group")
        heights = []
        for asset, selected, _size in selected_assets:
            if asset.get("scale_group") == name:
                bounds = selected.getchannel("A").getbbox()
                heights.append(bounds[3] - bounds[1])
        if not heights:
            raise Failure("INVALID_RECIPE", "Unused scale group")
        group_scales[name] = group["target_height"] / max(heights)
    for asset, selected, size in selected_assets:
        if asset["fit"] == "copy":
            frame = selected
        elif asset["fit"] == "pose":
            bounds = selected.getchannel("A").getbbox()
            target_height = asset["target_height"]
            width = max(1, round((bounds[2] - bounds[0]) * target_height / (bounds[3] - bounds[1])))
            if width > size[0] or target_height > size[1]:
                raise Failure("INVALID_RECIPE", "Pose would be clipped by its frame; resize was not allocated")
            frame = fit_pose(selected, frame_size=tuple(size), foot_anchor=tuple(asset["foot_anchor"]), target_height=target_height)
        elif asset["fit"] == "icon":
            frame = fit_icon(selected, tuple(size), target_extent=asset["target_extent"])
        elif asset["fit"] == "scaled":
            scale = asset.get("scale")
            name = asset.get("scale_group")
            if (scale is None) == (name is None) or (name is not None and name not in group_scales):
                raise Failure("INVALID_RECIPE", "scaled requires exactly one explicit scale or declared scale_group")
            frame = fit_scaled_frame(selected, tuple(size), group_scales[name] if name is not None else scale, foot_y=asset.get("foot_y"))
        else:
            raise Failure("INVALID_RECIPE", "Unsupported fit")
        prepared.append((asset, frame))
    from core.atlas import horizontal_atlas
    frame_map = {a["id"]: (a, frame) for a, frame in prepared}
    for atlas in recipe.get("atlases", []):
        name = atlas["id"]
        if not re.fullmatch(r"[a-z][a-z0-9_-]{0,47}", name) or name in ids or not 1 <= len(atlas["frames"]) <= 64:
            raise Failure("INVALID_RECIPE", "Invalid or repeated atlas ID")
        ids.add(name)
        if any(name not in frame_map for name in atlas["frames"]):
            raise Failure("INVALID_RECIPE", "Atlas references an unknown frame")
        entries = [frame_map[name] for name in atlas["frames"]]
        anchors = [frame_anchor(a, image) for a, image in entries]
        if any(anchor != anchors[0] for anchor in anchors):
            raise Failure("INVALID_RECIPE", "Atlas frames must use the same anchor")
        width = entries[0][1].width * len(entries)
        height = entries[0][1].height
        pixels += width * height
        if width > 16384 or width * height > MAX_PIXELS or pixels > 64_000_000:
            raise Failure("INVALID_RECIPE", "Atlas exceeds the image or aggregate pixel limit")
        frame = horizontal_atlas([image for _a, image in entries])
        prepared.append(({"id": atlas["id"], "fit": "atlas", "foot_anchor": anchors[0],
                         "_frames": len(entries), "_fps": atlas.get("fps", 6), "_loop": atlas.get("loop", True)}, frame))
    outputs, payloads = [], {}
    for asset, frame in prepared:
        if not asset.get("export", True):
            continue
        name = asset["id"] + ".png"
        buffer = io.BytesIO()
        frame.save(buffer, format="PNG")
        data = sources[asset["source"]][2] if asset["fit"] == "copy" else buffer.getvalue()
        if len(data) > MAX_BYTES:
            raise Failure("INVALID_IMAGE", "Encoded PNG exceeds the 32 MB byte limit")
        payloads[name] = data
        anchor = frame_anchor(asset, frame)
        fw = frame.width // asset.get("_frames", 1)
        if len(anchor) != 2 or any(type(v) is not int for v in anchor) or not (0 <= anchor[0] <= fw and 0 <= anchor[1] <= frame.height):
            raise Failure("INVALID_RECIPE", "Frame anchor is outside the real frame")
        outputs.append({"id": asset["id"], "path": out_res + "/" + name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
            "width": frame.width, "height": frame.height, "frame_width": frame.width // asset.get("_frames", 1), "frame_height": frame.height,
            "frames": asset.get("_frames", 1), "anchor": anchor,
            "animation": {"fps": asset.get("_fps", 6), "loop": asset.get("_loop", True)}})
    if not outputs:
        raise Failure("INVALID_RECIPE", "A build must export at least one PNG")
    manifest = {"schema": "godot-loop-assets/v1", "complete": True, "recipe": recipe,
                "sources": [value[1] for value in sources.values()], "metadata": list(metadata.values()), "generation_records": list(generation_records.values()),
                "unregistered_sources": sorted(set(sources) - {r["source"] for r in generation_records.values()}), "outputs": outputs, "toolchain": toolchain()}
    text = json.dumps(manifest, indent=2, ensure_ascii=True, allow_nan=False) + "\n"
    if len(text.encode()) > 512_000:
        raise Failure("INVALID_RECIPE", "Build manifest exceeds 512 KB")
    if request.get("dry_run"):
        return {"dry_run": True, "manifest": out_res + "/manifest.json", "outputs": outputs}
    out.parent.mkdir(parents=True, exist_ok=True)
    safe_path(project, out_res)
    stage = pathlib.Path(tempfile.mkdtemp(prefix=".gml-assets-", dir=out.parent))
    try:
        for name, data in payloads.items():
            (stage / name).write_bytes(data)
        (stage / "manifest.json").write_text(text, encoding="utf-8")
        # Separate publish-once checksum: ordinary metadata edits cannot silently
        # redefine the original build. This is change detection, not a signature.
        seal = stage / "manifest.sha256"
        seal.write_text(hashlib.sha256(text.encode()).hexdigest() + "\n", encoding="ascii")
        seal.chmod(0o400)
        if out.exists():
            raise Failure("ALREADY_EXISTS", "Build output appeared during processing")
        safe_path(project, out_res)
        publish_directory_once(stage, out)
        return {"manifest": out_res + "/manifest.json", "manifest_sha256": hashlib.sha256(text.encode()).hexdigest(), "outputs": outputs, "dry_run": False}
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def read_json(project, path):
    source = safe_path(project, path)
    with source.open("rb") as f:
        st = os.fstat(f.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_size > 512_000:
            raise Failure("INVALID_DATA", "Manifest/record must be a regular JSON file of at most 512 KB")
        data = f.read(512_001)
    if len(data) > 512_000:
        raise Failure("INVALID_DATA", "JSON record exceeds 512 KB")
    return json.loads(data), {"path": path, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


def verify(request):
    project, path = request["project"], request["manifest"]
    if not re.fullmatch(r"res://assets/generated/[a-z][a-z0-9_-]{0,47}/manifest\.json", path):
        raise Failure("INVALID_DATA", "Choose a managed build's manifest.json")
    document, identity = read_json(project, path)
    if not isinstance(document, dict) or document.get("schema") != "godot-loop-assets/v1" or document.get("complete") is not True:
        raise Failure("INVALID_DATA", "Not a completed asset manifest")
    outputs, sources = document.get("outputs"), document.get("sources")
    if not isinstance(outputs, list) or not 1 <= len(outputs) <= 80 or not isinstance(sources, list) or not 1 <= len(sources) <= 64:
        raise Failure("INVALID_DATA", "Invalid source/output inventory")
    recipe = document.get("recipe")
    if not isinstance(recipe, dict) or not isinstance(recipe.get("assets"), list):
        raise Failure("INVALID_DATA", "Missing declarative recipe")
    expected_sources = {a["source"] for a in recipe["assets"]}
    if {s["path"] for s in sources} != expected_sources or len(sources) != len(expected_sources):
        raise Failure("INVALID_DATA", "Source inventory does not match the recipe")
    expected_ids = [a["id"] for a in recipe["assets"] if a.get("export", True)] + [a["id"] for a in recipe.get("atlases", [])]
    if sorted(o["id"] for o in outputs) != sorted(expected_ids) or len(set(expected_ids)) != len(expected_ids):
        raise Failure("INVALID_DATA", "Output inventory does not match the recipe")
    out_res = path.rsplit("/", 1)[0]
    failures, allowed = [], {"manifest.json", "manifest.sha256"}
    try:
        with safe_path(project, out_res + "/manifest.sha256").open("rb") as f:
            st = os.fstat(f.fileno())
            seal = f.read(66) if stat.S_ISREG(st.st_mode) and st.st_size == 65 else b""
        if seal != (identity["sha256"] + "\n").encode("ascii"):
            failures.append("Manifest changed from its original build checksum")
    except FileNotFoundError:
        failures.append("Original build checksum missing; rebuild under a new ID")
    source_map = {s["path"]: s for s in sources}
    expected = {}
    for asset in recipe["assets"]:
        source = source_map[asset["source"]]
        size = [source["width"], source["height"]] if asset["fit"] == "copy" else asset["frame_size"]
        anchor = asset.get("foot_anchor", [0, 0] if asset["fit"] == "copy" else [size[0] // 2, asset.get("foot_y", size[1] // 2)])
        expected[asset["id"]] = {"width": size[0], "height": size[1], "frame_width": size[0], "frame_height": size[1], "frames": 1, "anchor": anchor,
                                 "animation": {"fps": 6, "loop": True}}
    for atlas in recipe.get("atlases", []):
        frame = expected[atlas["frames"][0]]
        expected[atlas["id"]] = {**frame, "width": frame["width"] * len(atlas["frames"]), "frames": len(atlas["frames"]),
                                  "animation": {"fps": atlas.get("fps", 6), "loop": atlas.get("loop", True)}}
    for output in outputs:
        if any(output.get(k) != v for k, v in expected[output["id"]].items()):
            failures.append(output["path"] + " frame layout/anchor disagrees with the recipe")
    for output in outputs:
        name = output.get("id")
        if not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{0,47}", name) or output.get("path") != out_res + "/" + name + ".png":
            raise Failure("INVALID_DATA", "Invalid output identity")
        width, height, fw, fh, frames = [output.get(k) for k in ("width", "height", "frame_width", "frame_height", "frames")]
        if any(type(v) is not int or v <= 0 for v in (width, height, fw, fh, frames)) or width != fw * frames or height != fh or width * height > MAX_PIXELS:
            raise Failure("INVALID_DATA", "Invalid frame layout")
        anchor = output.get("anchor")
        if not isinstance(anchor, list) or len(anchor) != 2 or any(type(v) is not int for v in anchor) or not (0 <= anchor[0] <= fw and 0 <= anchor[1] <= fh):
            raise Failure("INVALID_DATA", "Invalid frame anchor")
        allowed.update((name + ".png", name + ".png.import"))
    expected_metadata, expected_generation = {}, {}
    for asset in recipe["assets"]:
        if asset.get("art_record"):
            try:
                identities, generation = art_provenance(project, asset["art_record"], source_map[asset["source"]])
                for metadata_identity in identities:
                    expected_metadata[metadata_identity["path"]] = metadata_identity
                expected_generation[asset["art_record"]] = generation
            except (Failure, FileNotFoundError, ValueError) as error:
                failures.append("Artwork provenance changed: " + str(error))
    recorded_metadata = document.get("metadata")
    recorded_generation = document.get("generation_records")
    if not isinstance(recorded_metadata, list) or not isinstance(recorded_generation, list):
        raise Failure("INVALID_DATA", "Missing artwork provenance inventory")
    if {m["path"]: m for m in recorded_metadata} != expected_metadata or len(recorded_metadata) != len(expected_metadata):
        failures.append("Provenance file inventory disagrees with original artwork receipts")
    if sorted(recorded_generation, key=lambda r: r["record"]) != sorted(expected_generation.values(), key=lambda r: r["record"]):
        failures.append("Recorded generation claims disagree with original artwork receipts")
    if document.get("unregistered_sources") != sorted(set(source_map) - {g["source"] for g in expected_generation.values()}):
        failures.append("Unregistered-source inventory disagrees with artwork receipts")
    for item in sources + outputs + recorded_metadata:
        item_path = item.get("path")
        if not isinstance(item_path, str) or not isinstance(item.get("sha256"), str) or not re.fullmatch(r"[a-f0-9]{64}", item["sha256"]):
            raise Failure("INVALID_DATA", "Invalid stored-byte identity")
        try:
            file = safe_path(project, item_path)
            with file.open("rb") as f:
                st = os.fstat(f.fileno())
                if not stat.S_ISREG(st.st_mode) or st.st_size > MAX_BYTES:
                    raise Failure("INVALID_DATA", "Unbounded or special input")
                data = f.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES or hashlib.sha256(data).hexdigest() != item["sha256"] or len(data) != item.get("bytes"):
                failures.append(item_path + " changed")
            elif item in sources + outputs:
                _image, actual, _bytes = decode_png(item_path, data)
                if actual["width"] != item.get("width") or actual["height"] != item.get("height"):
                    failures.append(item_path + " dimensions disagree with PNG bytes")
        except FileNotFoundError:
            failures.append(item_path + " missing")
    # scandir is streaming; Path.iterdir/os.listdir can materialize the whole
    # directory before a loop-level cap gets a chance to stop enumeration.
    with os.scandir(safe_path(project, out_res)) as entries:
        for i, entry in enumerate(entries):
            if i >= 256:
                failures.append("Build directory exceeds the 256 entry limit")
                break
            if entry.is_symlink() or not entry.is_file(follow_symlinks=False) or entry.name not in allowed:
                failures.append("Unexpected build entry: " + entry.name)
    current = toolchain()
    if not isinstance(document.get("toolchain"), dict) or document["toolchain"].get("files") != current["files"]:
        failures.append("Processing code changed; rebuild under a new ID")
    for environment in ("pillow", "python"):
        if document.get("toolchain", {}).get(environment) != current[environment]:
            failures.append("Processing %s environment changed; rebuild under a new ID" % environment)
    return {"passed": not failures, "manifest": path, "manifest_sha256": identity["sha256"], "source_count": len(sources), "output_count": len(outputs),
            "failures": failures, "pillow_matches": document.get("toolchain", {}).get("pillow") == current["pillow"],
            "non_guarantees": "Local change detection, not a signature, rights check or protection from a malicious same-user writer."}


def preview(request):
    from PIL import Image
    report = verify(request)
    if not report["passed"]:
        raise Failure("ARTIFACT_CHANGED", "; ".join(report["failures"]))
    document, manifest_identity = read_json(request["project"], request["manifest"])
    if manifest_identity["sha256"] != report["manifest_sha256"]:
        raise Failure("ARTIFACT_CHANGED", "Manifest changed after verification")
    output = next((o for o in document["outputs"] if o["id"] == request["asset_id"]), None)
    if output is None:
        raise Failure("INVALID_PARAMS", "Unknown exported asset ID")
    image, identity, _raw = load_png(request["project"], output["path"])
    if any(identity[key] != output.get(key) for key in ("sha256", "bytes", "width", "height")):
        raise Failure("ARTIFACT_CHANGED", "Preview PNG changed after verification")
    if "frame" in request:
        frame = request["frame"]
        if type(frame) is not int or not 0 <= frame < output["frames"]:
            raise Failure("INVALID_PARAMS", "Frame index outside atlas")
        left = frame * output["frame_width"]
        image = image.crop((left, 0, left + output["frame_width"], output["frame_height"]))
    original_size = list(image.size)
    size = request.get("max_size", 512)
    if type(size) is not int or not 64 <= size <= 1024:
        raise Failure("INVALID_PARAMS", "Preview maximum is 64..1024 pixels")
    image.thumbnail((size, size), Image.Resampling.NEAREST)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return {"data": base64.b64encode(buffer.getvalue()).decode("ascii"), "width": image.width, "height": image.height,
            "original_size": original_size, "source_sha256": identity["sha256"],
            "caption": "Processed artwork preview, NOT a Godot/game screenshot. Nearest-neighbour thumbnail; original PNG is unchanged."}


def dispatch(request):
    if request.get("op") == "inspect":
        return load_png(request["project"], request["png"])[1]
    if request.get("op") == "build":
        return build(request)
    if request.get("op") == "verify":
        return verify(request)
    if request.get("op") == "preview":
        return preview(request)
    raise Failure("INVALID_PARAMS", "Unknown fixed image operation")


def main():
    try:
        if sys.version_info < (3, 11):
            raise Failure("DEPENDENCY_MISSING", "Python 3.11+ is required for artwork tools")
        import PIL
        if PIL.__version__ != REQUIRED_PILLOW:
            raise Failure("DEPENDENCY_MISSING", "Pillow==%s is required; found %s. No dependency was installed." % (REQUIRED_PILLOW, PIL.__version__))
        raw = sys.stdin.buffer.read(512_001)
        if len(raw) > 512_000:
            raise Failure("INVALID_PARAMS", "Worker request is too large")
        request = json.loads(raw)
        if not isinstance(request, dict):
            raise Failure("INVALID_PARAMS", "Expected an object")
        result = {"ok": True, "result": dispatch(request)}
    except ImportError:
        result = {"ok": False, "code": "DEPENDENCY_MISSING", "message": "Python 3.11+ and Pillow 13.0.0 are required for artwork tools; no dependency was installed."}
    except Exception as error:
        result = {"ok": False, "code": getattr(error, "code", "INVALID_DATA"), "message": str(error)}
    print(json.dumps(result, ensure_ascii=True, allow_nan=False))


if __name__ == "__main__":
    main()

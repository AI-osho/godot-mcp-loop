# Artwork production through the existing game loop

Released since 0.10.0 and included in 0.12.0. These seven optional tools are separate from node_add_tree (added in 0.12.0). [Architecture](architecture.md) · [Getting started](getting-started.md).

The production workflow is **brief → artwork request → real PNG receipt → reproducible build → native scene → ordinary-input verification**. This extends the existing editor/runtime loop rather than adding a second game engine, map editor or automatic game generator. Game rules, story and project-specific input routes remain the coding agent's work.

## Boundaries and requirements

- `production_plan` and `art_request` only handle local JSON records and need no running editor or Python.
- The PNG tools require Python 3.11+ and Pillow 13.0.0 (verified locally with Python 3.13). Use the server's `authoring/requirements.txt` in an environment you control. Nothing is automatically installed. `GODOT_LOOP_PYTHON` may select an executable in the server operator's environment; it is not a model-controlled tool argument. Existing editing/runtime tools still work without Pillow.
- `art_request` prepares instructions, not images. The approved request is `openai-codex` / `gpt-image-2-medium`, quality `medium`. Your client must use its existing authorized image producer, or you must supply existing PNGs. No credentials are copied or queried, no image API is called here, no provider/high-quality fallback is made.
- Requested `size` is a production request, not a guarantee of the producer's dimensions or a parameter every client image tool accepts. Map it to the actual producer's supported arguments; record actual dimensions separately.
- Model/quality returned by a producer are reported claims, not independent model, billing, quota or commercial-rights proof. Missing reported values stay `null`, not the requested value.
- Files stay inside the selected project's `res://` boundary. Repository/cache/addon/agent-instruction/dependency folders and symlinked paths are refused. Records are new JSON files; use new revision paths. Builds require a new `res://assets/generated/<unique-id>` directory.
- Build publication requires a native atomic no-replace directory operation (Darwin, Linux libc `renameat2`, or Windows rename). Unsupported systems fail closed rather than replacing an existing directory. Reparse metadata and physical escapes are refused; this is not native Windows certification.
- These are trusted-local-user, single-writer accident guards, not a malicious same-user sandbox or a signed provenance system. Existing project code/importers remain trusted code.

## Tools

| Tool | Required input | Result / next step |
|---|---|---|
| `production_plan` | `path`, `brief` | New `godot-loop-production/v1` JSON record. Brief: title, goal, controls, art direction, scenes and assets. Scene/asset IDs are unique; references are explicit project-local PNGs. |
| `art_request` | `plan`, `asset_id`, new `path` | Request prompt, reference hashes and approved generation policy. Optional `size` and focused `correction`; status remains `awaiting_external_image`. Give this to the client's existing image producer. |
| `art_register` | `request`, real project-local `png`, new `path`, `decision` | Decoded actual PNG dimensions and stored-byte hash. Optional `reported_quality`, `reported_model`, `response_file` (.json/.txt) and notes. Decision is `accepted`, `needs_revision` or `rejected`. Raw producer response is kept by exact hash when supplied. |
| `asset_build` | new `output_root`, `recipe` | PNGs and completed `manifest.json`; deterministic transforms, frame metadata, original/request/response/code fingerprints. No image generation or model calls. |
| `asset_preview` | `manifest`, `asset_id` | MCP image block, not a base64 text dump. Optional zero-based `frame`, `max_size` 64..1024 (default 512). Nearest-neighbour thumbnail; explicitly NOT a Godot screenshot. |
| `asset_verify` | `manifest` | Read-only `passed` report with failures, counts and exact manifest digest. Changed/missing artifacts are a failed domain report, not automatically an MCP transport error. Malformed/unsafe inputs are tool errors. |
| `asset_scene_add` | `manifest`, explicit `placements` | New undoable Node2D group in the edited scene. Optional parent, name, dry_run. Single PNG → Sprite2D; horizontal atlas → standard AnimatedSprite2D/SpriteFrames. Does not save or invent collisions/game rules. |

`production_plan`, `art_request`, `art_register`, `asset_build` and `asset_scene_add` accept `dry_run`. Production records/builds are append-only export artifacts, not editor undo entries. `edit_undo` removes a scene placement group but does not delete original artwork, receipts or built PNGs. `scene_save` is a separate explicit action.

## Minimal recipe with an existing PNG

This example copies an already available original without changing stored bytes. Put the actual PNG in the project first; no image is fabricated by this recipe.

`asset_build` arguments:

```json
{
  "output_root": "res://assets/generated/art01",
  "recipe": {
    "version": 1,
    "assets": [
      {"id": "background", "source": "res://art/source/background.png", "key": "none", "fit": "copy"}
    ]
  }
}
```

Then call `asset_verify` with `manifest: "res://assets/generated/art01/manifest.json"` and `asset_preview` with that manifest plus `asset_id: "background"`.

For a pose, use observed source/crop values, not these dimensions blindly:

```json
{
  "id": "actor",
  "source": "res://art/source/actor.png",
  "key": "magenta",
  "fit": "pose",
  "frame_size": [128, 176],
  "foot_anchor": [64, 170],
  "target_height": 156,
  "art_record": "res://production/actor-accepted.json"
}
```

`art_record` is optional for existing/user-authored PNGs. When supplied, the accepted receipt must match the exact source PNG and its request/plan/references/raw response. The build explicitly lists unregistered sources instead of inventing generation history.

## Fit modes and atlases

- `copy`: `key: "none"`, no crop. Preserves the entire stored PNG, including metadata. Default anchor [0,0]; optional `foot_anchor` must fit the real dimensions.
- `pose`: `frame_size`, `foot_anchor`, `target_height`. Nearest scaling, visible foot-band alignment. Cropped/empty/clipped artwork is refused.
- `icon`: `frame_size`, `target_extent`. Fits the largest visible extent and centres it; not foot alignment.
- `scaled`: `frame_size`, exactly one positive `scale` or `scale_group`, optional `foot_y`. Preserves relative size across states. A `scale_groups` entry `{id, target_height}` derives one factor from the tallest visible member, rather than normalising every state separately.
- `crop` is [left, top, right, bottom]. A magenta-keyed crop requires actual empty gutters on every side. Coordinates and anchor numbers must come from inspecting the real source.
- `export: false` retains a processed frame for atlas packing without publishing an intermediate PNG.
- `atlases: [{id, frames: ["idle", "loaded"], fps: 6, loop: false}]` packs equal-sized frames in order, preserving RGBA bytes and a shared anchor. It does not generate animation poses.

Per-call safety limits include 64 source-asset entries, 16 atlases, 64 frames per atlas, 32 MB per PNG, 16 million pixels per PNG, frame sides up to 4096, atlas width up to 16384 and aggregate processing pixel limits. Requests/manifests are bounded separately. These are not an overall disk or host-memory quota. The validated environment is not a promise of byte-identical zlib/Pillow output on every OS.

## Native placement and verification

With a Node2D or Control scene open:

```json
{
  "manifest": "res://assets/generated/art01/manifest.json",
  "name": "Artwork",
  "placements": [
    {"asset_id": "background", "name": "Background", "position": [0, 0], "z_index": -10, "scale": 1}
  ],
  "dry_run": true
}
```

After previewing, repeat with `dry_run: false`. Position is the recorded anchor: foot position for poses, centre for icons, top-left for default copies. Placement names are literal, not silently repaired; repeated group/child names are refused. `frame` selects an atlas frame; `play: true` requests standard autoplay. All placements validate before the new group is added. One `edit_undo` removes that group, leaving prior nodes and generated files alone.
The scene/parent identity is captured before worker verification. Switching or replacing that target during verification/import refuses the operation instead of placing artwork into the newly selected scene. Native path lookup refuses unresolved directory scans above 4096 entries per parent.

1. `scene_save`, then `game_run` from the intended ordinary scene.
2. Use `game_input` physical keys/actions and inspect `game_query`/`game_wait_for`; do not use teleport/debug completion as ordinary-route proof.
3. `screenshot` and inspect the actual window: anchors, scale, occlusion, frame bounds, Japanese text. `asset_preview` is not this evidence.
4. `logs_read` for actual runtime errors. Use existing `scenario_run` for project-specific repeatable routes and evidence.
5. Verify relevant normal startup/quit, restart and save isolation for the actual game; this importer does not implement a universal save/gameplay framework.

Progress-requesting clients receive elapsed-second heartbeats, not invented completion percentages. Allow a sufficiently long MCP timeout (e.g. 180 seconds for a large build/import). Cancellation before native dispatch prevents the scene edit; once an editor command has been sent, a timeout/disconnection does not prove nothing happened. Inspect `scene_tree` before retrying. Nothing is automatically replayed or deleted.

Godot's normal PNG `.import` sidecars are allowed only for the exact exported PNG names; extra files and links are refused by verification. Each published build also carries a separate read-only `manifest.sha256` checksum. Verification compares the exact
manifest bytes with that original checksum, so coordinated recipe/anchor edits cannot silently redefine a build.
Missing checksums fail verification. Never regenerate the checksum to make an edited manifest pass: rebuild under
a new ID. This is local accidental-change detection; a same-user actor who deliberately changes both the checksum
and all matching evidence remains outside the threat model.

Python 3.11+ and Pillow exactly 13.0.0 are checked before PNG operations. Processing-code, dependency-specification,
recorded Python-version or Pillow-version changes invalidate prior build verification; rebuild under a new ID.
JSON records are written and flushed to a private same-directory temporary file, then exclusively published with a
hard link. Filesystems without this publication capability fail closed; there is no overwrite/copy fallback.
Failed writes do not occupy the final revision name. Hard process death can leave a private incomplete temporary
file/stage requiring inspection; this is not a universal power-loss recovery service. Receipts are not signatures.

## What this does not claim

No universal game generation, automatic collision/map inference, model training, all-direction animation generation, 3D artwork production, commercial-rights clearance, new service contract, publication or changes to existing sample games. A technically passing route is not human acceptance of fun, art or sound.

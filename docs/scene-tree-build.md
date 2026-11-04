# Add one bounded 2D/UI subtree (since 0.12.0)

`node_add_tree` is available in 0.12.0, not in the older 0.11.0 package. Use the server and addon from the same selected distribution. Publication/installation does not change existing MCP registrations or restart running clients; reconnect explicitly when you choose.

The tool reduces structural editing round trips. It does not generate game logic, artwork, sound, or a finished layout, and no productivity multiplier is claimed without measurement.

## Workflow

1. Create a new empty scene with `scene_create`, or explicitly select an existing empty scene.
2. Call `node_add_tree` with `dry_run: true`.
3. Inspect the complete planned node list. Call again with `dry_run: false` to revalidate and apply.
4. Save explicitly with `scene_save`.
5. Attach authored scripts with the existing tools, run the game, inspect actual UI/graphics and test ordinary input.

Preview is not a reservation. The edited root, save destination, emptiness and native history are checked again during apply. The tool never opens, switches, clears or automatically saves a scene.

## Input

Required fields are `schema_version: 1`, `scene: "res://...tscn"`, and `nodes`. `dry_run` is a boolean, default false. Unknown fields are refused rather than discarded.

Each node has:

- `id`: unique literal identifier matching `^[a-z][a-z0-9_]{0,31}$`.
- `parent_id`: absent on the first node, required afterwards, referring only to an earlier id.
- `type`: one of the supported native classes below.
- `name`: literal Godot name, at most 64 UTF-8 bytes; Japanese and emoji are supported. Ambiguous paths, invalid Godot characters, controls and leading/trailing whitespace are refused, not repaired.
- `properties`: optional object of allowed initial values, default empty.

The first node is the sole new top and must be Node2D or Control. It is added directly under the edited root. No existing parent path can be selected.

```json tool=node_add_tree
{
  "schema_version": 1,
  "scene": "res://scenes/new_stage.tscn",
  "dry_run": true,
  "nodes": [
    {"id":"content","type":"Node2D","name":"Content"},
    {"id":"player","parent_id":"content","type":"CharacterBody2D","name":"Player","properties":{"position":[120,160]}},
    {"id":"collision","parent_id":"player","type":"CollisionShape2D","name":"Collision","properties":{"shape":{"new":"RectangleShape2D","properties":{"size":[24,32]}}}},
    {"id":"visual","parent_id":"player","type":"Sprite2D","name":"Visual","properties":{"texture":{"res":"res://assets/hero.png"}}},
    {"id":"camera","parent_id":"player","type":"Camera2D","name":"Camera","properties":{"zoom":[1,1]}}
  ]
}
```

Prepare the named empty scene and imported PNG first. The example is a contract example, not an assertion that those files exist.

## Target restrictions

The exact `scene` must already be open as the current edited scene. It must have a permitted `.tscn` save destination, an ordinary scriptless Node2D or Control root, no children including internal children, and no inherited/instanced root. Existing root properties are not configured by this tool. Existing empty scenes are allowed; the tool does not certify their creation history.

Only new detached nodes are prepared. Before committing, the same root object, path, empty state and native history must still be current. A human edit made during validation is preserved, not rolled back.

## Supported native classes

Node, Node2D, CharacterBody2D, StaticBody2D, Area2D, Sprite2D, CollisionShape2D, Camera2D, CanvasLayer, Control, ColorRect, Label, Button, PanelContainer, MarginContainer, VBoxContainer, HBoxContainer, CenterContainer and GridContainer.

The fixed bundled `tree_build_policy.json` is the shared TypeScript/Godot property and limit authority. Supported property families are:

- Native 2D position/rotation/scale/visibility/z order and relevant collision layers/masks.
- Sprite2D PNG texture, offset, centering, flips and modulation; CollisionShape2D shape/disabled; Camera2D zoom/enabled/smoothing.
- CanvasLayer layer/visibility.
- Control anchors/offsets/minimum size/size flags/mouse filter/visibility.
- Label/Button text and selected font/alignment/wrap settings.
- PanelContainer style, MarginContainer margins, BoxContainer separation, GridContainer columns/separation.

Names, owners, scripts, resource/scene paths, metadata, indexed-property syntax and arbitrary node references are not property fields. Unsupported properties are refused.

## Values and resources

Numbers must be finite and correctly typed. Integer/enum fields require actual integers; booleans require booleans. Unlike the legacy tools, numeric or vector strings are not coerced. Vector2 uses two numbers; colors use `#RRGGBB`, `#RRGGBBAA`, or three/four 0–1 numbers. Text remains literal; NUL and malformed surrogate data are not supported.

Allowed new embedded resources are RectangleShape2D (`size`), CircleShape2D (`radius`), CapsuleShape2D (`radius`, `height`) and selected StyleBoxFlat colors/borders/corners/content margins. Use `{ "new": "RectangleShape2D", "properties": { "size": [24,32] } }`. Each specification creates an independent resource, not a shared identifier. Capsule height must be at least its diameter, including native defaults for omitted fields.

External references are only `{ "res": "res://assets/image.png" }` Texture2D values. Script, Shader, scene, `.tres` and `.res` references are excluded. References and sidecars must pass path/symlink checks; headers, IHDR fields/CRC, dimensions, source checksum and confined native import remaps are checked before loading. The tool does not import or repair a stale/missing image. Native cache checksum metadata is read only through a derived internal path, never an arbitrary caller-selected `.godot` path. This is not a promise that malicious same-user cache edits or third-party importer behavior are sandboxed.

## Per-request limits

- 64 nodes, depth 8 (the new top counts as 1).
- 32 properties/node, 512 total including embedded resource properties.
- 64 embedded resources; resource-depth ceiling 4. v1 resource properties themselves are scalar/vector/color fields.
- 64 ordinary array items; strings 2048 UTF-8 bytes, names 64 and paths 1024.
- 128 KiB request and complete successful response.
- 16 distinct referenced PNG paths, 8 MiB each, each side at most 4096, aggregate at most 16,000,000 pixels.

Limits are enforced before allocation/texture loading and before publication. They do not cap all Godot memory, other plugins or accumulated undo history. No human history or old logs are automatically cleared.

## Outcomes and recovery

Success JSON includes `schema_version`, `scene`, `dry_run`, `applied`, `disk_saved`, `planned_count`, `created_count`, `undo_action`, and either `planned_nodes` or `created_nodes`. Every row contains id/type/scene-relative path; counts and all rows are checked against the request before reporting success.

Preview: `applied=false`, `created_count=0`, `undo_action=null`. Apply: `applied=true`, actual complete node count and the confirmed MCP action name. `disk_saved` is always false.

Tool failures have `isError: true`, a bounded text error, and `structuredContent` with application state. Known pre-commit refusals use `applied=false` and `created_count=0`. An ambiguous dispatched result uses null for both. `error` carries a fixed code/message/hint and an allowlisted field location where available; raw backend messages/arguments are not copied. SDK input-schema rejection happens before the tool callback and may instead be a standard MCP invalid-parameters error.

Key codes: TREE_POLICY_INVALID, INVALID_TREE_PLAN, SCENE_TARGET_MISMATCH, SCENE_NOT_EMPTY, UNSUPPORTED_NODE_TYPE, UNSUPPORTED_PROPERTY, RESOURCE_NOT_READY, PATH_FORBIDDEN, TREE_BUILD_VALIDATION_FAILED, TREE_BUILD_STATE_UNCERTAIN, BUSY, TIMEOUT and DISCONNECTED.

After a timeout/disconnect or uncertain commit, inspect `scene_tree` and native history before deciding what to do. Do not automatically resend. The tool does not undo an uncertain commit or erase another actor's edit.

## Undo, saving and layout

One applied subtree is one `edit_undo` operation immediately afterwards. All descendants are assigned to the edited root, including on native redo. A later human edit blocks MCP undo. Subsequent script or file edits remain separate operations. No new public redo tool is added.

Creating the empty file, adding the subtree and saving are separate operations. Undo does not delete the earlier empty `.tscn`; saving after undo is explicit. No cross-file/disk transaction or crash rollback is promised.

Detached setter readback detects observable invalid clamping. Theme/wrap/geometry are ordered before text, but Containers/theme changes can resolve after attachment. Preview does not certify final pixel layout; use runtime `game_ui_audit`, screenshots and actual input.

The initial native development checks use Godot 4.7.2 on macOS. Check the exact candidate's qualification receipt for other platforms; Windows or Linux must not be inferred from macOS evidence.

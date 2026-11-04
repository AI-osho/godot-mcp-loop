> Generated repository copy. Edit samples/tower-defense, then run scripts/sync-samples.mjs.

# 灯畑の番人 — Tower Defense

An original one-map, two-tower, three-wave mouse-driven game. Defend the seedhouse using single-target lantern fire
and slowing mist bells. It is the construction sample for node_add_tree (since 0.12.0), not an automatic game generator.
Included in 0.12.0; the older 0.11.0 package does not include this sample/tool.

## Play first

```sh
godot --headless --path . --import
godot --path .
```

Godot 4.7.2 is the verified engine reference. No addon, MCP client, AI account or Python is needed to play.
Click 庭をまもる, select a tower on the right, place it on A–H pads and call each wave. Right-click deselects.
Pause/resume/title/retry/quit are on-screen buttons; paused play cannot place towers or launch a wave.
[日本語の操作と再現可能な攻略](PLAY.ja.md).

## Construction lesson

plans/title-tree.json, garden-tree.json and results-tree.json contain 13, 30 and 11 added nodes respectively.
Use the same selected distribution's node_add_tree to preview/apply each plan to a separately selected, eligible empty scene,
then scene_save. Never apply an empty-scene construction plan over these populated finished scenes.

In a fresh copy, create an unused `replay/` directory first. For each plan:

| Plan | scene_create path | root_type | Added nodes |
|---|---|---|---:|
| title-tree.json | res://examples/tower-defense/replay/title.tscn | Control | 13 |
| garden-tree.json | res://examples/tower-defense/replay/game.tscn | Node2D | 30 |
| results-tree.json | res://examples/tower-defense/replay/results.tscn | Control | 11 |

Create/select the new empty scene with `scene_create` (`root_name: "Root"`). Copy the plan request and change only its
`scene` field to the matching replay path. Call `node_add_tree` first with `dry_run: true`, then without that flag;
check the added-node count and call `scene_save` separately. A single `edit_undo` removes that one added subtree;
apply the plan again before saving if you tried Undo. Keep assets at their shipped res://examples/tower-defense/assets paths.

The plans describe native 2D/UI structure. Scripts, gameplay actors, rules, images and sounds are separately authored.
The title plan incorporates the author's final control-instruction text correction.

For agent operations, explicitly install the addon from this exact distribution and configure your client;
do not substitute a registry build for changed source merely because their version labels match.
The two scenarios exercise title/placement and pause/resume via normal mouse events. Native tests live in tests/.
Normal title-to-victory/defeat/retry routes are a separate check, not replaced by state-changing hooks or a screenshot.

## Source and provenance

This standalone project is authoritative. examples/tower-defense is generated with repository-prefixed resource paths;
edit this source and run scripts/sync-samples.mjs, not two copies independently.
The original game's one-map/two-tower/three-wave rules and assets are preserved. [Design](DESIGN.md),
[delivery changes](UPGRADING.md) and [asset provenance](ASSET-PROVENANCE.md) explain the boundaries.
Original editable art/palette and PCM synthesis source are included; optional regeneration needs Pillow 13.0.0.
They do not call an image service, download sound or train a model. Ordinary play writes no progress/volume save files.
MIT © OSHO. This sample does not establish the user's subjective play, visual or listening approval.

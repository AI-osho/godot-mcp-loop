# Sample games and internal fixtures

The public showcase contains six games with the same role: practical projects for trying editing, input, observation
and repeatable checks. No sample is the required introduction to the others.
[日本語の作品・操作一覧](../docs/samples.ja.md) · [Sample guide](../docs/samples.md) · [Changes](../docs/sample-upgrades.md).

<!-- sample-showcase:start -->
| Sample | Game | What to inspect |
|---|---|---|
| `blocks` | Falling Blocks | Rotation, board state and scoring |
| `shooter` | Vertical Shooter | Movement/fire, waves and boss transitions |
| `action` | Side-scroller | Variable jumps, platforms and collision |
| `rpg` | Luka of the Star Sword | Dialogue, battles and state transitions |
| `marble-3d` | Marble Run | Rolling, jumps, checkpoints and contacts |
| `tower-defense` | 灯畑の番人 | Tower placement, pause, victory/defeat and retry |
<!-- sample-showcase:end -->

## Run an example

In the repository project, open the selected entry scene and press F6. Standalone copies run through their own
project.godot (F5); see the sample guide for the selected distribution's copy command. No addon is needed just to play.
For editing/testing through MCP, explicitly use the matching server/addon and approve client setup separately.

| ID | Repository entry | Authority |
|---|---|---|
| blocks | res://examples/blocks/blocks.tscn | examples/blocks/ |
| shooter | res://examples/shooter/shooter.tscn | examples/shooter/ |
| action | res://examples/action/action_game.tscn | examples/action/ |
| rpg | res://examples/rpg/main.tscn | examples/rpg/ |
| marble-3d | res://examples/marble/main.tscn | samples/marble-3d/ |
| tower-defense | res://examples/tower-defense/scenes/title.tscn | samples/tower-defense/ |

Each game's guide covers controls, retry, retained rules, test hooks and generation direction.
`node scripts/sync-samples.mjs --check` and `node scripts/sync-marble-example.mjs --check` detect copy drift;
do not hand-edit a generated copy to hide a mismatch.

## Creation credits

- Falling Blocks and Vertical Shooter were originally produced with Claude Opus 5.5 through Claude Code.
- Side-scroller, Luka of the Star Sword and Marble Run were originally produced with DeepSeek V4.1 Flash through Claude Code.
- The RPG's held-direction movement and three cosmetic overlaps were corrected after the generating session; those are historical fixes, not new rules in this update.
- TD creation details and original image/SFX sources are in [its provenance](../samples/tower-defense/ASSET-PROVENANCE.md).

The older pixel-art games use image_write PNGs, while game presentation/rules remain authored code and resources.
Scenario hooks provide controlled checks; screenshots, hooks and copied files do not establish human acceptance or
ordinary full-game completion. Source availability is not package-publication approval.

## Internal fixtures, not showcased games

[platformer/](platformer/) remains the default small editor/runtime test project, preserving existing Player paths
and its positive/intentional-failure examples. It is omitted from the game showcase without deleting compatibility.
[fixtures/](fixtures/) contains dedicated test scenes, including deliberate native errors; these are not games.

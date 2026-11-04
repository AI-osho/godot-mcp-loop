# Sample changes: retained rules, clearer packaging

[日本語](sample-upgrades.ja.md) · [Samples](samples.md) · [Architecture](architecture.md)

The showcase presents six games with uniform goals, controls, retry, observation and test notes.
The simple platformer has been removed from the showcase/gallery without deleting its internal fixture or breaking callers.
The update adds 灯畑の番人 and standalone packaging/guides for retained games; it does not redesign their rules or art.

## Version boundaries

| Item | Previous 0.11.0 | Current 0.12.0 |
|---|---|---|
| MCP tools | 48 | 49, including node_add_tree |
| Sample availability | CLI ID marble-3d | Six showcased games; platformer retained as an internal compatibility fixture |
| Artwork support | Seven tools, released in 0.10.0 | The same released workflow remains available |
| Installation diagnosis | Static doctor CLI since 0.11.0 | CLI, not an extra MCP tool |

A source feature is not a published package feature. Equal version labels do not establish identical source/registry payloads.
See [Getting started](getting-started.md#distribution-status) to choose a distribution; do not publish a public npm command
that selects an unavailable sample. Client registration, rebuilding source and package publication are separate actions.

## Authoritative sources and generated copies

| Game | Authoritative source | Generated counterpart |
|---|---|---|
| blocks | examples/blocks/ | samples/blocks/examples/blocks/ |
| shooter | examples/shooter/ | samples/shooter/examples/shooter/ |
| action | examples/action/ | samples/action/examples/action/ |
| rpg | examples/rpg/ | samples/rpg/examples/rpg/ |
| marble-3d | samples/marble-3d/ | examples/marble/ |
| tower-defense | samples/tower-defense/ | examples/tower-defense/ |

The internal platformer also keeps its examples-side authority and generated standalone fixture. Existing directories
are not moved or renamed. Legacy copies keep their res://examples/ layout so resource/script/scenario paths survive.
Marble/TD have the opposite generation direction because their standalone project is the source of truth.
Do not edit both sides independently or repair a generated copy to hide drift.

```sh
node scripts/sync-samples.mjs --check
node scripts/sync-marble-example.mjs --check
```

Generators reject unknown files/escaping links and compare copied bytes/modes. Standalone project settings select
that game's scene/inputs without enabling the MCP addon. The parent samples/.gdignore prevents duplicate repository
imports, not standalone imports. The [CLI](../server/src/cli.ts) refuses nonempty and protected copy destinations.

## Per-game comparison

### Falling Blocks

- **Changed:** standalone setup and documented move/rotate/drop/restart controls.
- **Kept:** board, rotations/kicks, gravity, level/scoring rules and four original scenarios.
- **Compare:** ordinary arrows/Z/X/Space and R retry separately from fixed sequences, disabled gravity and seeded boards.

### Vertical Shooter

- **Changed:** standalone start/fire/retry guidance and the distinction between input, boss fixtures and movie capture.
- **Kept:** enemies, bullets, five waves, boss behavior, four scenarios and 256×240 recording aspect.
- **Compare:** ordinary Enter/movement/fire and results/title retry separately from invincibility, autopilot or direct boss damage.

### Side-scroller

- **Changed:** standalone launch, variable-jump instructions, failure/retry and movement/contact notes.
- **Kept:** stage, acceleration, pits/platforms/enemies, jump behavior and four scenarios.
- **Compare:** ordinary movement/held-jump and Enter retry separately from position setters, frozen enemies/timer or selected fixtures.

### Luka of the Star Sword / 星剣のルカ

- **Changed:** standalone setup, Japanese-font requirement, confirm/cancel and defeat/full-reset guidance.
- **Kept:** story, maps, dialogue, combat, growth, gold-halving defeat recovery and six scenarios.
- **Compare:** ordinary movement/confirmation separately from warp/stat/battle hooks. Previous movement/cosmetic fixes are history, not new packaging changes.

### Marble Run

- **Changed:** the same play/retry/design guidance as the other games and clearer copy/check boundaries.
- **Kept:** CLI ID marble-3d, staircase/jump-required gaps, checkpoints/lives, existing silent presentation and seven scenarios.
- **Compare:** ordinary rolling/grounded jumps and title retry separately from teleport/checkpoint and gap fixtures.

### 灯畑の番人 / tower-defense

- **Changed:** a formal source sample with play/retry/provenance guides and three replayable construction plans.
- **Kept:** one map, two complementary towers, three waves, original art/SFX and ordinary mouse-driven placement/win/loss/retry.
- **Compare:** ordinary controls separately from the three empty-scene plan replays and two controlled scenarios.

## TD integration and construction

The formalized sample sets both its physical window and logical canvas to 960×640 so repository integration keeps
mouse/layout coordinates. Generated Texture2D references use relocated paths without stale standalone import UIDs.
Original images and valid script UIDs are retained; these are portability repairs, not changed game rules.

Title/game/results plans add 13/30/11 nodes with actual node_add_tree calls. Preview, apply and explicit scene_save
are separate from ordinary gameplay checks. Rules, nine PNGs and eight short synthesized effects were authored
separately; subtree construction is not image/audio generation or proof of using artwork-production tools.
No extra level, progression, online mode, external image service or BGM feature is claimed.

## Inventory and acceptance evidence

The showcased games contain 27 expected-success scenarios: blocks 4, shooter 4, action 4, RPG 6, Marble 7 and TD 2.
The internal platformer keeps one positive fixture and a separate intentional failure, without becoming a seventh
showcased game. Existing default-scene, Player paths and CLI compatibility remain intact.

Fixed seeds, warps, invincibility and direct writes establish controlled checkpoints, not ordinary full-game completion.
A copy/synchronization check is not a native import/layout/input/audio check. Identify the exact distribution and
separate startup, scenario replay, ordinary controls/retry/pause/quit, native errors, frames, PCM and human judgement.
The screenshots are actual native captures; the RPG frame is the prologue. No universal speedup is claimed.
Old receipts do not certify newly modified candidates. This guide describes scope, not a version-bound execution
receipt or publication approval. [Scenarios](scenarios.md) · [Security](security.md).

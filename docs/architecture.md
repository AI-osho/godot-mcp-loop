# Architecture

[日本語](architecture.ja.md)

Godot-mcp-loop connects an MCP client to a Godot editor and its running game.
Its central workflow is **edit → run → observe → judge**, not automatic completion of an entire game.
Rules, assets, level design and the decision that a game is enjoyable still belong to its authors.

## Release availability

| Capability | Previous 0.11.0 | Current 0.12.0 |
|---|---|---|
| Scene/script editing, game input, observation and scenarios | Available | Available |
| Seven artwork-production tools | Available since 0.10.0 | Available |
| Static installation diagnosis, `doctor` | Available since 0.11.0; CLI only | CLI only |
| `node_add_tree` | Not included | Available since 0.12.0 |
| MCP tool count | 48 | 49, including `node_add_tree` |
| Bundled standalone sample CLI collection | `marble-3d` only | Seven projects in this source update |

The six-game showcase and `node_add_tree` are not features of npm 0.11.0. The minimal platformer is retained as an internal compatibility/test fixture, not a seventh showcased game.
Keep the server and addon from the exact same selected distribution; a version label alone is insufficient.
Building source does not replace a server already running inside an MCP client.

## From a client to a game

```text
MCP client
  │ stdio: tool requests and results
  ▼
Node.js MCP server
  ├─ argument/schema and project-path validation
  ├─ selected-project routing and scenario orchestration
  └─ optional fixed artwork-processing worker
  │ authenticated WebSocket on 127.0.0.1
  ▼
Godot editor addon
  ├─ edited-scene operations and native undo history
  └─ Godot's built-in debugger channel
       ▼
Running game's MCPLoopRuntime agent
  └─ input, live state, frame stepping, captures and logs
```

[`server/src/index.ts`](../server/src/index.ts) selects the CLI subcommands or starts the stdio MCP server.
The bridge client authenticates with the editor's per-session token; the addon listens on loopback.
The game uses debugger messages, not an additional game-control network listener.
Its runtime agent removes itself when no debugger is attached, including ordinary exported runs.
Runtime requests are deferred out of debugger capture callbacks before they operate on game nodes.

## Source map

| Location | Responsibility |
|---|---|
| `server/src/` | MCP entry point, schemas, connection, tool handlers and scenario runner |
| `addons/mcp_loop/` | Editor plugin, bridge, editing commands and game runtime |
| `server/authoring/` | Fixed optional Python/Pillow PNG-processing implementation |
| `examples/` | Games and test fixtures used from the repository's Godot project |
| `samples/` | Standalone projects selected by the package/source `sample` CLI |
| `server/test/` | TypeScript tests and real-Godot integration tests |
| `tests/godot/unit/` | Godot-side unit tests |
| `docs/` | User guides, tool contracts, scenarios and security limits |

Fixtures are test inputs, not additional games.
The source-of-truth direction differs between legacy examples and Marble/TD; see [sample upgrades](sample-upgrades.md).

## Editing, history and persistence are separate

`scene_open` and `scene_tree` identify the edited scene; `node_add`, `node_set` and script tools change it.
Editor node paths are relative to that scene's root: `.` is the root and `Player` is its child.
Runtime tools inspect a different tree in the game process; `game_query` does not read the editor's unsaved scene.
Preserve existing sample node paths so scenarios and observation code still address the intended nodes.

A preview checks the proposed edit without applying that edit; resource loading or validation can still run code.
An applied edit, its native undo entry and its saved files are different outcomes.
`scene_save` explicitly persists scene edits. File-backed tools have their own write and undo behavior.
`edit_undo` stops rather than undoing a later human edit; it is not a project-wide rollback transaction.

### The node_add_tree contract (since 0.12.0)

The explicitly named scene must already be current, empty, scriptless and an ordinary Node2D or Control scene.
One request adds one new parent-first native 2D/UI subtree, bounded to 64 nodes and depth 8.
Types, properties, typed JSON values, embedded shapes/styles and ready PNG references are restricted.
This is not a general 3D batch API; scripts, scene instances and arbitrary Resource files are excluded.

Use preview, inspect the plan, apply, then save separately. Apply records one native undo action.
A successful apply still reports `disk_saved=false`; preview is not proof of final pixel layout.
After an uncertain dispatched result, inspect the scene/history before retrying: automatic replay can duplicate an edit.
See [the full subtree contract](scene-tree-build.md) for bounds, refusal states and recovery.

## Artwork is an optional, already released workflow

The seven tools are `production_plan`, `art_request`, `art_register`, `asset_build`,
`asset_preview`, `asset_verify` and `asset_scene_add`. They were released in 0.10.0.
An existing, authorized client-side image producer supplies original PNGs; the server does not generate images,
acquire provider credentials, install dependencies or certify image rights.

The workflow records the brief/request/actual receipt, processes PNGs, previews/verifies output and places assets.
PNG processing needs optional Python 3.11+ and exactly Pillow 13.0.0; normal editing/play does not.
Records and asset builds are append-only artifacts, not undo entries; placement and scene saving are separate.
The new tower-defense sample's artwork, audio and rules were authored separately, not generated by this workflow.
See [art production](art-production.md) for recipes and provenance limits.

## Input, controlled state and evidence

`game_input` delivers Godot input events/actions; it is not evidence of a physical keyboard or mouse being used.
`game_query`, `game_wait_for`, screenshots and logs answer different questions about what happened.
For brief states, record values during input instead of relying on one late query.
`game_pause` and `game_step` provide controlled physics-frame advancement; timed input cannot progress a paused tree.

`game_set` and `game_call` can prepare reproducible fixtures, including seeds, checkpoints and test hooks.
A fixture that teleports a ball or weakens a boss does not prove an ordinary-input route was completed.
`scenario_run` executes YAML/JSON steps; inspect its `passed` result, not only the absence of a tool error.
`test_run` runs an installed GUT/GdUnit4 suite; project tests are executable project code.

Captures show pixels, logs show reported errors, and recorded PCM establishes actual mixed audio samples.
None alone establishes all the others, human listening approval or enjoyable play.
A zero process exit does not override native Godot errors; headless runs cannot establish screenshot quality.
See [scenarios](scenarios.md) for evidence storage, screenshot baselines and Movie Maker's timing/aspect limits.

## Diagnosis, export and trust

`doctor` is a standalone CLI, not the 49th MCP tool. It checks static installation metadata and trusted version probes.
It does not launch an editor, connect to the bridge, repair files or certify runtime readiness.
`project_export` uses an existing export preset and fixed arguments; templates remain a user prerequisite.

Loopback authentication and project-path guards reduce accidental damage and unauthenticated access.
They do **not** sandbox project scripts, resources, plugins or tests at the operating-system level.
Only load trusted projects and retain client-side approval for code loading, execution and other consequential actions.
Read [security](security.md), [doctor](doctor.md) and [tools](tools.md) for the detailed boundaries.

# Getting started

[日本語](getting-started.ja.md) · [Samples and controls](samples.md) · [Architecture](architecture.md)

Play first if you want to try a game; add MCP only if you want an agent to edit or test it.
These are separate operations. Do not install an addon, register a client or configure an image service merely to play.

## Distribution status

| Distribution | MCP tools | Sample availability |
|---|---|---|
| Current npm **0.12.0** | **49** | The six-game showcase plus the retained internal compatibility fixture |
| Previous npm **0.11.0** | **48** | CLI ID marble-3d; no node_add_tree |

The artwork tools were released in **0.10.0**. The static `doctor` CLI was released in **0.11.0** and is not a new MCP tool.
Equal version labels do not mean equal source/registry payloads. Source availability is not publication approval.
Use Node.js 20+ for the server and Godot 4.7 (tested 4.7.2). Optional Python/Pillow is not a gameplay dependency.

## 1. Copy and play any showcased game

Choose blocks, shooter, action, rpg, marble-3d or tower-defense. From your working folder, use a new/empty destination:

```sh
npx -y godot-mcp-loop@0.12.0 sample shooter ./my-shooter
godot --headless --path ./my-shooter --import
godot --path ./my-shooter
```

The CLI refuses a nonempty destination. Import prepares resource/global-class caches. Alternatively open project.godot
in the project manager, wait for imports and press F5. [Game controls and retry](samples.md).
`npx -y godot-mcp-loop@0.12.0 sample` lists all shipped IDs, including the internal platformer compatibility fixture.
That fixture is not a seventh showcased game. No addon, MCP registration or image service is needed to play.

For source work, build with npm ci and npm run build in server/, then invoke the absolute server/dist/index.js path.
Use that same build's installer and server instead of substituting a registry version merely because its label matches.

## 2. Enable AI editing separately

This changes the chosen project. Preserve your work and approve installation before running:

```sh
npx -y godot-mcp-loop@0.12.0 install-addon ./my-shooter
```

Keep the server and addon from the same selected distribution. Follow the installer's actual executable path for
[client registration](clients.md), a separate approved change. For source builds, invoke that build's install-addon
subcommand and keep its exact executable. Do not use --force as a routine repair: it replaces existing content.
Reload an already-open editor to load the enabled plugin. Rebuilding/installing does not restart a client's process.

## 3. Observe state, then replay a check

Ask for `godot_status` first. Confirm the selected project before allowing edits or launch.
The following MCP calls use the standalone copy of `shooter`; they are not shell commands:

```text
game_run {"scene":"res://examples/shooter/shooter.tscn"}
game_input {"steps":[{"action":"shooter_start","hold_ms":80}]}
game_query {"node":".","properties":["state","score","lives","wave"]}
logs_read {"source":"game","min_level":"error"}
scenario_run {"path":"res://examples/shooter/scenarios/4_boss_clear.yaml","save_to":"res://qa/evidence/first-check"}
```

The query reads actual declared root properties. The boss scenario restarts at its controlled setup; its pass is
not proof of ordinary full-game completion. Read the returned verdict and saved report rather than inferring success.
For an edit, inspect `scene_tree`, preview the supported small change, apply the approved change and save explicitly.
Other games keep their own documented paths and controls; do not reuse node names or window coordinates blindly.

## 4. Diagnose MCP setup without launching an editor

From the copied project's parent folder:

```sh
npx -y godot-mcp-loop@0.12.0 doctor ./my-shooter --json
```

For source installations, use the matching local CLI instead. `doctor` checks static metadata and
trusted executables; it does not connect, launch, install or repair. A play-only project may correctly lack the addon.
Static `ok` does not mean runtime readiness; runtime remains `not_checked`. [Diagnostic codes](doctor.md).
`npx` package preparation may download dependencies; that is separate from the static diagnostic operation.

## Verification and trust

Check normal controls/retry before controlled hooks. Headless success is not visual quality; screenshots cannot
prove audio or play feel, and audio-player flags are not mixed output. Keep state, native errors, frames, PCM and
human acceptance distinct. Projects/plugins can execute with your OS user's privileges: these guards are not a sandbox.
[Security](security.md) · [Scenarios](scenarios.md) · [Changes/source authorities](sample-upgrades.md).

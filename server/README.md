# godot-mcp-loop

An MCP server and a Godot 4 editor addon that let AI coding agents close the loop on game development:
**edit → run → observe → judge**. The agent builds scenes and scripts through the editor (undoable), runs the game,
sends real input frame by frame, reads live values, takes screenshots, and checks the result with YAML scenarios or
GUT / GdUnit4 unit tests.

Full documentation: <https://github.com/AI-osho/godot-mcp-loop>

## Quick start

1. Add the editor addon to your Godot 4 project. It must be the same version as the server, so let the server copy it:

   ```bash
   npx -y godot-mcp-loop@0.11.0 install-addon ~/games/my-game --skill
   ```

   `--skill` also adds the agent skill (`.claude/skills/godot-mcp-loop`). The command prints the exact version to use
   in the next step.

2. Open the project in Godot 4 (or let the agent do it later with `editor_launch`). The **MCP Loop** plugin is enabled
   and listens on `127.0.0.1`.

3. Register the server with your MCP client, pinned to the same version as the addon (shown by step 1):

   Claude Code:

   ```bash
   cd ~/games/my-game && claude mcp add godot-loop -- npx -y godot-mcp-loop@<version> --project ~/games/my-game
   ```

   Codex (`~/.codex/config.toml`):

   ```toml
   [mcp_servers.godot-loop]
   command = "npx"
   args = ["-y", "godot-mcp-loop@<version>", "--project", "/Users/you/games/my-game"]
   ```

   Other clients: command `npx`, arguments `-y godot-mcp-loop@<version> --project <project folder>`.

4. Ask the agent to call `godot_status`, then describe the game you want.

To update, run step 1 again with `--force` and change the version in step 3.

## Installation diagnosis (0.11.0+)

`godot-mcp-loop doctor <project> [--json] [--artwork]` checks static setup without changing the project,
launching an editor, connecting to the bridge or installing dependencies. Python/Pillow is checked only when
requested. An `ok` result does not certify runtime or full addon integrity; runtime always remains unchecked.
Run `npx -y godot-mcp-loop@0.11.0 doctor /ABS/my-game --json` (add `--artwork` for Python/Pillow checks).
Doctor is a standalone CLI command, not an additional MCP tool or a server registration command.
[Doctor guide](https://github.com/AI-osho/godot-mcp-loop/blob/main/docs/doctor.md).

## What the agent gets

| | Tools |
|---|---|
| Status | `godot_status`, `project_info`, `project_list`, `project_connect` (switch projects with `--projects-root`) |
| Editor | `editor_launch` (finds Godot 4.5+ and opens the project, optionally headless), `editor_quit` |
| Scenes & nodes | `scene_open`, `scene_create`, `scene_save`, `scene_tree`, `node_add`, `node_delete`, `node_get`, `node_set` |
| Scripts & files | `script_read`, `script_write`, `script_edit`, `script_attach`, `file_write`, `image_write`, `input_action_set`, `project_setting_set`, `edit_undo` |
| Artwork production (development) | `production_plan`, `art_request`, `art_register`, `asset_build`, `asset_preview`, `asset_verify`, `asset_scene_add` |
| Run & observe | `game_run`, `game_stop`, `game_query`, `game_ui_audit`, `game_in_view`, `game_ray`, `game_contacts`, `game_input`, `game_wait_for`, `game_set`, `game_call`, `game_pause`, `game_step`, `logs_read`, `screenshot` |
| Build | `project_export` (release export from a preset into `res://build/` only, no shell) |
| Judge | `scenario_run` (YAML play-tests, evidence saved with `save_to`, `movie` → GIF + contact sheet), `test_run` (GUT / GdUnit4) |

Security: the addon listens on localhost only, with a per-session token; file access is limited to the project (never
`.godot/` or `.git/`); editor edits are undoable. Running a game or its tests runs the project's code — see
[security.md](https://github.com/AI-osho/godot-mcp-loop/blob/main/docs/security.md).

## Optional artwork production

Development-source addition: brief → `art_request` → actual PNG/quality receipt → deterministic recipe → preview
and verification → standard Sprite2D/AnimatedSprite2D placement → existing ordinary-input/screenshot checks.
The server does not generate images, acquire credentials or change a client's image-provider configuration.
The client uses its existing authorized `openai-codex` / `gpt-image-2-medium` producer with a medium request.
Reported quality can differ and is stored separately; an absent report is unknown, not inferred.

PNG tools require Python 3.11+ and `Pillow==13.0.0` (`authoring/requirements.txt` in this package; no auto-install).
The server operator may select an installed environment via `GODOT_LOOP_PYTHON`. Existing tools and brief/request
records do not require Pillow. JSON/PNG outputs are append-only; editor undo removes the new placement group only.
Recipes never contain executable code. For limits, examples and failure semantics see
[the artwork guide](https://github.com/AI-osho/godot-mcp-loop/blob/main/docs/art-production.md).
This development documentation does not mean the currently published npm version contains the new tools.

## License

MIT © OSHO

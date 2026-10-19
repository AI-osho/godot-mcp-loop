# godot-mcp-loop

An MCP server and a Godot 4 editor addon that let AI coding agents close the loop on game development:
**edit → run → observe → judge**. The agent builds scenes and scripts through the editor (undoable), runs the game,
sends real input frame by frame, reads live values, takes screenshots, and checks the result with YAML scenarios or
GUT / GdUnit4 unit tests.

Full documentation: <https://github.com/AI-osho/godot-mcp-loop>

## Quick start

1. Add the editor addon to your Godot 4 project. It must be the same version as the server, so let the server copy it:

   ```bash
   npx -y godot-mcp-loop@latest install-addon ~/games/my-game --skill
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

## What the agent gets

| | Tools |
|---|---|
| Status | `godot_status`, `project_info`, `project_list`, `project_connect` (switch projects with `--projects-root`) |
| Editor | `editor_launch` (finds Godot 4.5+ and opens the project, optionally headless), `editor_quit` |
| Scenes & nodes | `scene_open`, `scene_create`, `scene_save`, `scene_tree`, `node_add`, `node_delete`, `node_get`, `node_set` |
| Scripts & files | `script_read`, `script_write`, `script_edit`, `script_attach`, `file_write`, `image_write`, `input_action_set`, `project_setting_set`, `edit_undo` |
| Run & observe | `game_run`, `game_stop`, `game_query`, `game_input`, `game_wait_for`, `game_set`, `game_call`, `game_pause`, `game_step`, `logs_read`, `screenshot` |
| Judge | `scenario_run` (YAML play-tests, evidence saved with `save_to`, `movie` → GIF + contact sheet), `test_run` (GUT / GdUnit4) |

Security: the addon listens on localhost only, with a per-session token; file access is limited to the project (never
`.godot/` or `.git/`); every edit is undoable. Running a game or its tests runs the project's code — see
[security.md](https://github.com/AI-osho/godot-mcp-loop/blob/main/docs/security.md).

## License

MIT © OSHO

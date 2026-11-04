# godot-mcp-loop

Edit, run, inspect and test Godot 4 projects through MCP.
The TypeScript server and Godot editor addon let an AI client edit scenes/GDScript, send gameplay input,
read state, capture frames and replay checks. The project remains an ordinary Godot project.
The client chooses the operations; the server is not a hosted game-generation service.

Full documentation: <https://github.com/AI-osho/godot-mcp-loop>

## Choose a guide

[Getting started](https://github.com/AI-osho/godot-mcp-loop/blob/main/docs/getting-started.md) ·
[Architecture](https://github.com/AI-osho/godot-mcp-loop/blob/main/docs/architecture.md) ·
[Samples](https://github.com/AI-osho/godot-mcp-loop/blob/main/docs/samples.md) ·
[Sample upgrades](https://github.com/AI-osho/godot-mcp-loop/blob/main/docs/sample-upgrades.md).

Current **0.12.0** exposes **49** MCP tools, including node_add_tree, and six showcased standalone games.
The minimal platformer remains an internal compatibility/test fixture. Previous 0.11.0 has 48 tools.
Games run without the addon. Artwork tools have been public since 0.10.0; doctor is a static CLI since 0.11.0.

## Connect an existing project

1. Select the distribution. For public 0.12.0, install the addon with:

   ```sh
   npx -y godot-mcp-loop@0.12.0 install-addon /ABS/my-game --skill
   ```

   For a source build, run `npm ci` and `npm run build` inside `server/`, then use:

   ```sh
   node /ABS/godot-mcp-loop/server/dist/index.js install-addon /ABS/my-game --skill
   ```

   `--skill` is optional and adds the bundled agent skill. Choose the **same selected distribution** for the server
   and addon. Do not routinely add `--force`: it replaces existing addon/skill content.

2. Open or reload that project in Godot with the MCP Loop plugin enabled. The editor listens on 127.0.0.1;
   running the game itself does not open another control port.

3. Register your MCP client as a separate approved step. Follow the installer's printed command, which names the
   **actual server executable** that performed installation. For example, when choosing the source build:

   ```sh
   claude mcp add godot-loop -- node /ABS/godot-mcp-loop/server/dist/index.js --project /ABS/my-game
   ```

   Other clients use that executable and arguments as documented in the client guide. Keep the installation at a
   stable path. **Version labels alone** do not prove that an unreleased checkout and a registry package are equal;
   do not replace a source-server path with an npm command simply because the displayed version matches.

4. Ask the client for `godot_status` and verify the selected project before editing/running it.
   Installing an addon does not register a client; rebuilding source does not restart a running server.

## Installation diagnosis (0.11.0+)

`godot-mcp-loop doctor <project> [--json] [--artwork]` checks static setup without changing the project,
launching an editor, connecting to the bridge or installing dependencies. Python/Pillow is checked only when
requested. An `ok` result does not certify runtime or full addon integrity; runtime always remains unchecked.
Run `npx -y godot-mcp-loop@0.12.0 doctor /ABS/my-game --json` (add `--artwork` for Python/Pillow checks).
Doctor is a standalone CLI command, not an additional MCP tool or a server registration command.
[Doctor guide](https://github.com/AI-osho/godot-mcp-loop/blob/main/docs/doctor.md).

## What the agent gets

| | Tools |
|---|---|
| Status | `godot_status`, `project_info`, `project_list`, `project_connect` (switch projects with `--projects-root`) |
| Editor | `editor_launch` (finds Godot 4.5+ and opens the project, optionally headless), `editor_quit` |
| Scenes & nodes | `scene_open`, `scene_create`, `scene_save`, `scene_tree`, `node_add`, `node_add_tree`, `node_delete`, `node_get`, `node_set` |
| Scripts & files | `script_read`, `script_write`, `script_edit`, `script_attach`, `file_write`, `image_write`, `input_action_set`, `project_setting_set`, `edit_undo` |
| Artwork production (0.10.0+) | `production_plan`, `art_request`, `art_register`, `asset_build`, `asset_preview`, `asset_verify`, `asset_scene_add` |
| Run & observe | `game_run`, `game_stop`, `game_query`, `game_ui_audit`, `game_in_view`, `game_ray`, `game_contacts`, `game_input`, `game_wait_for`, `game_set`, `game_call`, `game_pause`, `game_step`, `logs_read`, `screenshot` |
| Build | `project_export` (release export from a preset into `res://build/` only, no shell) |
| Judge | `scenario_run` (YAML play-tests, evidence saved with `save_to`, `movie` → GIF + contact sheet), `test_run` (GUT / GdUnit4) |

Security: the editor bridge listens on localhost with a per-session token. Project-path guards and supported
undo/preview operations are not an OS sandbox or a cross-file transaction. Opening, validating or running a project
can execute its code/plugins. Scene saving is explicit. See
[security.md](https://github.com/AI-osho/godot-mcp-loop/blob/main/docs/security.md).

## Bounded subtree construction (since 0.12.0)

Available since 0.12.0, `node_add_tree` adds one bounded native 2D/UI subtree for an explicitly selected empty scene, with strict values, preview and one undo action. It never saves; use `scene_save` separately. A timeout or disconnect after dispatch leaves application state unknown, so inspect before retrying. This is not present in the published 0.11.0 package. See `docs/scene-tree-build.md` and `docs/scene-tree-build.ja.md` in the accompanying source tree.

## Optional artwork production

Released since 0.10.0: brief → `art_request` → actual PNG/quality receipt → deterministic recipe → preview
and verification → standard Sprite2D/AnimatedSprite2D placement → existing ordinary-input/screenshot checks.
The server does not generate images, acquire credentials or change a client's image-provider configuration.
The client uses its existing authorized `openai-codex` / `gpt-image-2-medium` producer with a medium request.
Reported quality can differ and is stored separately; an absent report is unknown, not inferred.

PNG tools require Python 3.11+ and `Pillow==13.0.0` (`authoring/requirements.txt` in this package; no auto-install).
The server operator may select an installed environment via `GODOT_LOOP_PYTHON`. Existing tools and brief/request
records do not require Pillow. JSON/PNG outputs are append-only; editor undo removes the new placement group only.
Recipes never contain executable code. For limits, examples and failure semantics see
[the artwork guide](https://github.com/AI-osho/godot-mcp-loop/blob/main/docs/art-production.md).
The seven artwork tools are also included in 0.11.0. This does not automatically update running clients or installed addons.

## License

MIT © OSHO

# Security

## Threat model in one paragraph

godot-mcp-loop lets an AI agent write GDScript and run the game. **Running a game runs its code with your user's
permissions — so anyone who can call `script_write` + `game_run` (or `test_run`) can execute code on your machine.** That is inherent
to the purpose of the tool, not a bug. The protections below therefore aim at two things:

1. keeping **other local actors** (other users, other processes, web pages in your browser) from driving your editor;
2. keeping a **well-meaning but fallible agent** from causing accidental damage (wrong paths, broken scripts,
   irreversible edits).

If you do not trust the agent, require human approval in your MCP client for `script_write`, `script_attach`,
`node_add`, `node_set`, `game_run` and `test_run` (most clients can ask before each tool call).

## Bridge (MCP server ↔ editor)

| Protection | Details |
|---|---|
| Localhost only | The addon listens on `127.0.0.1` (ports 6510–6519). |
| Token | 256-bit random token per editor session, compared in constant time. Required by the first message (`hello`). |
| Private session file | `res://.godot/mcp_loop/session.json` (port + token) is created with mode `0600` inside a `0700` directory before the token is written, and deleted when the plugin stops. |
| Auth before takeover | A new connection becomes the active client **only after a valid `hello`**. Unauthenticated connections — including ones opened by a web page, since browsers may open `ws://127.0.0.1` — cannot disturb the active session; a wrong token closes them. |
| Bounded waiting | At most 3 connections may be handshaking/unauthenticated; they are dropped after 5 s without `hello`. |
| Bounded buffers | 4 MB inbound, 24 MB outbound per connection; scripts ≤ 1 MB; screenshots ≤ 2560 px wide. |

## File system sandbox

Every path from the agent goes through `addons/mcp_loop/util/path_guard.gd` (and `resolveProjectFile` in the server):

- only `res://` paths; no `..`, no backslashes, no control characters;
- no reading or writing under `res://.godot/` or `res://.git/`; no writing into `res://addons/mcp_loop/`;
- writes are limited by extension (`.gd` for `script_write`, `.tscn` for `scene_create`);
- **symbolic links are refused** anywhere along the path, because Godot would follow them outside the project, and the
  `project_info` file listing does not descend into linked folders;
- the MCP server applies the same rules to files it reads itself (`scenario_run` / `file_write` validation): no
  `.godot/` or `.git/`, nothing outside the project, no links that resolve outside it;
- there is no tool to delete files, change project or editor settings, or run shell commands.

## Scene sandbox

Node paths are resolved relative to the edited scene root. `..` segments are rejected and the result must be the
root or one of its descendants, so the agent cannot reach editor UI nodes.

## Edits are reversible and validated

- Scene/node/property/script edits go through Godot's undo history. `edit_undo` only undoes actions this server
  made, and stops if a human edited the same history afterwards.
- Property values are type-checked before anything changes; invalid input changes nothing. Godot literals given as
  strings (`"Transform2D(1, 0, 0, 1, 5, 6)"`) are parsed only when they are a flat literal of the expected type —
  Godot's `str_to_var` would otherwise construct objects (`Object(...)`) while parsing.
- `script_write` compiles the code before writing it; on errors nothing is written.

## `@tool` scripts

A `@tool` script runs inside the **editor** process once it is used in an open scene, attached, or instantiated by
the editor. Compiling one would also run its static initializers, so `script_write` validates a copy with `@tool`
disabled and returns a warning whenever the content contains `@tool`. Treat such writes like running code.

## The in-game runtime

The `MCPLoopRuntime` autoload talks to the editor over Godot's debugger connection — the game opens no port of its
own. It is active only when the game was launched from the editor with the debugger attached
(`EngineDebugger.is_active()`); in exported games it frees itself immediately. You can also exclude
`addons/mcp_loop/` from your export presets. Input sequences are bounded (≤ 200 steps, ≤ 60 s per step) and waits
are capped at 120 s.

## Tools added in 0.3

- `game_set` / `game_call` act only on nodes of the **running game** (never the editor). `game_call` runs game code the
  agent could already write; JSON arguments cannot create scripts (embedded `{"new": ...}` resources exclude `Script`).
- `input_action_set` writes only `input/<name>` entries of project.godot (undoable).
- `file_write` writes only `.yaml/.yml/.json/.md/.txt/.csv`, never under `addons/` or `.godot/`, and never `.cfg`,
  `.tres`, `.tscn` or `.gd` (scripts go through the compile-checked `script_write`/`script_edit`).
- `image_write` writes only `.png` files generated from palette text.

## Tools added in 0.4

- `game_pause` / `game_step` act only on the running game; a step runs at most 3600 physics frames.
- Inline `set` / `call` / `assert` / `wait_for` steps in `game_input` use the same checks as `game_set`, `game_call` and
  `game_wait_for`, within the existing input limits; a failing step releases held input.

## Tools added in 0.6

- `test_run` starts one process: the editor's own Godot executable (`OS.get_executable_path()`), with an argument list
  (no shell), `--headless`, on this project, running only the installed framework's own runner script at its fixed path
  (`res://addons/gut/gut_cmdln.gd` or `res://addons/gdUnit4/bin/GdUnitCmdTool.gd`). Test paths go through PathGuard
  (inside `res://`, not `.godot/` or `.git/`, no symbolic links); a test name may only contain letters, digits and `_`.
  One run at a time; the process is killed at `timeout_ms` (at most 10 minutes). Its report and log are written to
  `res://.godot/mcp_loop/tests/`, which the file tools cannot reach. Like `game_run`, it runs the project's code.
- `scenario_run` `save_to` writes PNG, Markdown and JSON files from the server process, under the same path rules
  (inside the project, not its root, not `.godot/` or `.git/`, symbolic links resolved before checking and never written
  through). A re-run deletes only regular files that its previous manifest lists inside that folder; a non-empty folder
  without a manifest is refused. Not undoable.

## Known limitations

- A local process running as **your own user** can read the session file and connect — same-user isolation is out
  of scope (such a process can already modify your project files directly).
- A web page cannot authenticate, but it can keep opening connections to fill the 3 waiting slots, which may delay
  a legitimate reconnect by a few seconds.
- Only one MCP client per editor at a time.

## Reporting

See [SECURITY.md](../SECURITY.md): report privately via GitHub (*Security* → *Report a vulnerability*), not in a
public issue.

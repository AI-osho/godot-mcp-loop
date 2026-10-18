# Bridge protocol v1

Two links:

```
MCP server (Node) ──WebSocket ws://127.0.0.1:<port>──▶ editor addon ──Godot debugger channel──▶ game runtime
```

## Discovery

On start the editor addon binds the first free port in `6510–6519` (override the start with env `MCP_LOOP_PORT`) on
**127.0.0.1 only**, and writes `res://.godot/mcp_loop/session.json`:

```json
{ "port": 6510, "token": "<64 hex chars>", "protocol": 1, "pid": 4242,
  "godot_version": "4.7.2-stable (official)", "project_path": "/path/to/project/" }
```

The file is removed when the plugin stops. The MCP server re-reads it whenever it (re)connects, so editor restarts are
picked up automatically; a file whose `pid` is dead is treated as "editor not running".

## Messages (WebSocket, JSON text frames)

```jsonc
// client → addon. The first request MUST be hello.
{"id": 0, "method": "hello", "params": {"token": "…", "protocol": 1}}
{"id": 1, "method": "node.add", "params": {"type": "Sprite2D", "name": "Hero"}}

// addon → client
{"id": 0, "ok": true, "result": {"protocol": 1, "godot_version": "…", "addon_version": "0.3.0"}}
{"id": 1, "ok": false, "error": {"code": "NODE_NOT_FOUND", "message": "…", "hint": "…"}}

// addon → client, unsolicited (no id)
{"event": "…", "data": {…}}
```

- Requests may be answered out of order; match by `id`.
- One client at a time. A new connection replaces the old one and must send `hello` again.
- Methods: `ping`, `editor.status`, `editor.quit`, `project.info`, `scene.open|create|save|tree`, `node.add|delete|get|set`,
  `script.read|write|attach`, `edit.undo`, `game.run|stop|query|input|wait_for`, `screenshot`, `logs.read`,
  `tests.run`.

## Error codes

| Code | Meaning |
|---|---|
| `UNAUTHORIZED` | No successful `hello` yet, or wrong token. |
| `PROTOCOL_MISMATCH` | Server and addon versions differ. |
| `UNKNOWN_METHOD`, `INVALID_PARAMS` | Bad request. Nothing was changed. |
| `NO_EDITED_SCENE`, `NODE_NOT_FOUND`, `FILE_NOT_FOUND`, `ALREADY_EXISTS` | Target problems. |
| `PATH_FORBIDDEN` | Path outside the sandbox (see [security.md](security.md)). |
| `SCRIPT_PARSE_ERROR` | `script_write` content does not compile; nothing written. |
| `NOTHING_TO_UNDO` | No MCP edit left, or a human edit blocks it. |
| `GAME_NOT_RUNNING`, `GAME_ALREADY_RUNNING`, `GAME_PAUSED` | Game state. |
| `TIMEOUT` | A wait or call exceeded its time limit. |
| `ASSERTION_FAILED` | A one-time check (`wait_for` with `timeout_ms: 0`, scenario `assert`) is false; the message has the actual value. |
| `RENDERING_UNAVAILABLE` | Screenshot requested while headless. |
| `TEST_FRAMEWORK_NOT_FOUND` | `tests.run`: neither GUT nor GdUnit4 (or not the requested one) is installed. |
| `BUSY` | `tests.run`: another test run is still going. |
| `INTERNAL` | Bug — please report. |

Client-side codes added by the MCP server: `GODOT_NOT_RUNNING`, `BAD_SESSION_FILE`, `NOT_CONNECTED`, `DISCONNECTED`;
`project_connect`: `PROJECT_SWITCH_DISABLED` (no `--projects-root`), `PROJECT_NOT_FOUND`, `NOT_A_PROJECT` (no
`project.godot`), `PATH_FORBIDDEN` (outside the projects roots); `editor_launch` / `editor_quit`: `GODOT_NOT_FOUND`,
`ADDON_NOT_INSTALLED`, `ADDON_NOT_ENABLED`, `EDITOR_EXITED` (the editor ended before its bridge started),
`EDITOR_NOT_LAUNCHED` (an editor this server did not open is never closed).

## Game channel

Uses Godot's own debugger connection, so no extra port is opened by the game. The addon registers an autoload
`MCPLoopRuntime` (`addons/mcp_loop/runtime/runtime_agent.gd`) that is active only when the game was started from the
editor with the debugger attached; in exported builds it frees itself on startup.

| Direction | Message | Data |
|---|---|---|
| game → editor | `mcp_loop:hello` | `{pid, scene, display}` |
| editor → game | `mcp_loop:request` | `{id, method: query|input|wait_for|screenshot, params}` |
| game → editor | `mcp_loop:response` | `{id, ok, result|error}` (screenshot PNG as raw bytes) |
| game → editor | `mcp_loop:logs` | `[entries]`, flushed every 200 ms and before each response |

Findings from the spike that shaped this design (Godot 4.7.2): the game-side capture receives the message name
*without* the `mcp_loop:` prefix, the editor side *with* it; a 3 MB payload passes; a script error makes the debugger
break the game (the addon sends `continue` unless `pause_on_error`); with `--headless` in
*Project Settings › Editor › Run › Main Run Args* the game runs without a window and screenshots are unavailable.

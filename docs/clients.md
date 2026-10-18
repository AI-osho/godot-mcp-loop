# Connecting MCP clients

The server needs to know which Godot project to talk to: pass `--project /absolute/path/to/your/project`
(the folder containing `project.godot`), or set `GODOT_PROJECT_PATH`, or start it from that folder.
Then open that project in the Godot editor with the **MCP Loop** plugin enabled.

Two ways to start the server — use the same version as the addon in your project (`version=` in
`addons/mcp_loop/plugin.cfg`; `npx -y godot-mcp-loop@latest install-addon <project>` installs a matching one):

- **npm**: command `npx`, arguments `-y godot-mcp-loop@<version> --project /ABS/my-game` (Node.js 20+).
- **From source**: build once (`cd godot-mcp-loop/server && npm ci && npm run build`), then command `node`, arguments
  `/ABS/godot-mcp-loop/server/dist/index.js --project /ABS/my-game`.

The examples use npm; replace `<version>` and `/ABS/my-game` with yours.

## Claude Code

```bash
claude mcp add godot-loop -- npx -y godot-mcp-loop@<version> --project /ABS/my-game
```

## Cursor (`.cursor/mcp.json`) / Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "godot-loop": {
      "command": "npx",
      "args": ["-y", "godot-mcp-loop@<version>", "--project", "/ABS/my-game"]
    }
  }
}
```

## Hermes Agent (`~/.hermes/config.yaml`)

```yaml
mcp_servers:
  godot-loop:
    command: "npx"
    args: ["-y", "godot-mcp-loop@<version>", "--project", "/ABS/my-game"]
    timeout: 180   # scenario and test runs can take a while
```

## Codex CLI (`~/.codex/config.toml`)

```toml
[mcp_servers.godot-loop]
command = "npx"
args = ["-y", "godot-mcp-loop@<version>", "--project", "/ABS/my-game"]
```

## Check it works

Ask the agent to call `godot_status`. If you get `GODOT_NOT_RUNNING`, the editor isn't open on that project or the
plugin is disabled; the error's hint says which. Debug output from the server goes to stderr.

Tip: per-call timeouts. `game_input`, `game_wait_for` and `scenario_run` can legitimately take tens of seconds; raise
your client's tool timeout if it is lower than ~120 s.

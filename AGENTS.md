# godot-mcp-loop — guide for coding agents

This repository is an MCP server (TypeScript, `server/`) plus a Godot 4 editor addon (GDScript, `addons/mcp_loop/`)
that let AI agents edit, run, observe and judge Godot games. The repository root is also a Godot project used for
examples and tests.

## Layout

| Path | What |
|---|---|
| `addons/mcp_loop/` | Editor addon: WebSocket bridge (127.0.0.1, token auth), editing commands, in-game runtime agent. `plugin.cfg` holds the addon version. |
| `server/src/` | MCP server (stdio). `tools/` defines the MCP tools, `scenario/` the scenario schema and runner. `package.json` holds the server version. |
| `tests/godot/unit/` | GDScript unit tests (headless). |
| `server/test/` | TypeScript unit tests; `server/test/e2e/` drives a real headless Godot editor. |
| `examples/` | Platformer used by tests, advanced sample games with `scenarios/`, test fixtures. |
| `.claude/skills/godot-mcp-loop/` | Skill that teaches agents to use the tools. Its examples are tested (`server/test/agent-skill.test.ts`). |
| `docs/` | Tool reference, scenarios, protocol, security, client setup. |
| `sandbox/` | Ignored by git. Scratch games for trials go to `sandbox/<name>/`. |

## Commands

```bash
scripts/test-godot-unit.sh             # GDScript unit tests (needs `godot` on PATH)
cd server && npm ci                    # once
npm run typecheck && npm test          # TypeScript checks and unit tests
npm run build                          # dist/ used by MCP clients
npm run test:e2e                       # end-to-end against a headless editor (several minutes)
```

## Rules

- Test first: add a failing test (GDScript or TypeScript), then make it pass. Run the unit suites before every
  commit and the end-to-end suite before a pull request.
- Stage files by explicit path; never `git add -A` (sandbox games and editor files must not be committed).
- Work on a branch and open a pull request; CI must pass before merging.
- A new or changed tool needs: tests, `docs/tools.md`, the README tool table if the list changes, `CHANGELOG.md`,
  and the agent skill if agents should use it differently.
- Security model (see `docs/security.md`): no tool may run arbitrary code or shell commands; the bridge listens on
  127.0.0.1 only; file access goes through `PathGuard` (no `.godot/`, `.git/`, `addons/` writes, no symlinks out);
  every edit is undoable and supports `dry_run`.
- Keep the addon version (`addons/mcp_loop/plugin.cfg`) and the server version (`server/package.json`) equal.
- Releases: a release PR sets both versions and the `CHANGELOG.md` section, then pushing tag `vX.Y.Z` runs
  `.github/workflows/release.yml` (GitHub release + npm staged publish that a maintainer approves with 2FA). Creating
  tags, releases and npm publishes needs the maintainer's approval. See `docs/releasing.md`.
- Trials of game generation run in `sandbox/<name>/` with input actions prefixed by the game name; don't touch
  `sandbox/` folders someone else is testing in.

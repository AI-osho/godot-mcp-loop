# Security audit — v0.8.0

- Scope: everything released as `godot-mcp-loop` 0.8.0 — the MCP server (`server/`), the Godot addon
  (`addons/mcp_loop/`), the CI and release workflows.
- Date: 2026-10-20. Performed by Hermes (DeepSeek V4.1 Flash) at the user's request, as a release gate.
- Method: read every tool registration and the bridge; ran the checks below against a live editor and the built server
  (`GODOT_LOOP_SERVER=server/dist/index.js`); sent deliberately hostile arguments; confirmed each fix with a test that
  fails before it and passes after.

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **High** | Path sandbox bypass via letter case: `res://.GIT/config` read `.git/config`, and `res://Addons/mcp_loop/probe.gd` **wrote a script into the addon**. macOS and Windows resolve names case-insensitively; the prefix check compared bytes. A script in `addons/` runs in the editor on the next reload — arbitrary code with the user's rights, and `.git/hooks` is the same class. | **Fixed** (#35): segments are canonicalised against the directory listing, prefixes compared case-insensitively; verified live (all three probes now `PATH_FORBIDDEN`) and by `test_rejects_case_variants_of_protected_dirs` |
| 2 | Medium | Eight tools accepted undeclared arguments and silently dropped them: `godot_status`, `project_list`, `project_connect`, `editor_launch`, `editor_quit`, `screenshot`, `scenario_run`, `test_run`. The #26 strict-schema fix only covered `registerForwardTool`, so an argument typo looked like it worked. | **Fixed** (#36): all eight use `strict()`; `tool-strictness.test.ts` calls every tool with `{__undeclared__: 1}` and requires a validation error (verified red on the previous build) |
| 3 | Low | Release tags were unprotected: a `v*` tag could be deleted or force-moved, so a published release could be repointed. `main` already had a ruleset. | **Fixed**: ruleset `protect-release-tags` (target `tag`, `refs/tags/v*`, blocks deletion and non-fast-forward, no bypass actors) |
| 4 | Info | Untrusted project code is not sandboxed: opening a project runs its plugins/`@tool` scripts and running it runs its autoloads. Same for `test_run` and scenario `call` steps. | Documented in `docs/security.md` → "Projects you did not write" |

No finding in S1, S3, S5, S6, S8, S9 required a code change.

## S1 — Attack surface

`tools/list` on the built server: **40 tools, 14 read-only, 26 with side effects**; `destructiveHint` on `node_delete`
and `edit_undo`. Categories:

| Kind | Tools |
|---|---|
| Read-only | `godot_status`, `project_info`, `project_list`, `scene_tree`, `node_get`, `script_read`, `game_query`, `game_ui_audit`, `game_in_view`, `game_ray`, `game_contacts`, `game_wait_for`, `logs_read`, `screenshot` |
| Edit project state | `scene_open`, `scene_create`, `scene_save`, `node_add`, `node_delete`, `node_set`, `script_write`, `script_edit`, `script_attach`, `file_write`, `image_write`, `input_action_set`, `project_setting_set`, `edit_undo` |
| Run code | `game_run`, `game_stop`, `game_input`, `game_set`, `game_call`, `game_pause`, `game_step`, `scenario_run`, `test_run` |
| Start/stop processes | `editor_launch`, `editor_quit`, `project_connect` |

Code-execution equivalents, all inherent to the purpose and documented: `script_write`/`script_edit` (GDScript with
`@tool` runs in the editor — compile-checked with `@tool` disabled and warned about), `game_run`/`test_run`/
`scenario_run`/`game_call` (project code in a child process). **No tool runs a shell**: `test_run` starts the editor's
own executable with an argument list (`OS.create_process`, no shell); `editor_launch` uses a configured Godot path, a
fixed argument list and `execFile` (no shell); there is no tool to delete files or read outside the project.

## S2 — Path containment

`PathGuard` (`addons/mcp_loop/util/path_guard.gd`) refuses, with unit tests for each:

| Attempt | Result |
|---|---|
| `..` segments, absolute paths, `user://`, `C:\…`, empty path | rejected (`test_rejects_parent_traversal`, `test_read_rejects_non_res`) |
| backslashes, control characters, U+FFFD | rejected (`test_rejects_backslashes_and_control_chars`) |
| `res://.godot/…`, `res://.git/…` (read and write) | rejected |
| writing under `res://addons/mcp_loop/` | rejected (`test_write_rejects_protected_dirs`) |
| symbolic link anywhere in the path, linked file | rejected (`test_rejects_paths_through_a_symlinked_directory`, `test_rejects_a_symlinked_file`) |
| **case variants** (`res://.GIT/…`, `res://Addons/…`) | **bypassed before #35, rejected now** |
| wrong extension for the tool (`.gd` only for `script_write`, `.png` for `image_write`, `.yaml/.json/…` for `file_write`) | rejected |

Live probes after the fix: `script_read res://.GIT/config` → `PATH_FORBIDDEN`; `script_read res://.Godot/…` →
`PATH_FORBIDDEN`; `script_write res://Addons/mcp_loop/probe3.gd` → `PATH_FORBIDDEN`; reading
`res://addons/mcp_loop/plugin.gd` still works (allowed on purpose — the agent documents itself).

## S3 — Bridge

| Property | Value (verified in code and on disk) |
|---|---|
| Bind address | `127.0.0.1`, ports 6510–6519 |
| Token | 32 random bytes from `Crypto` (256-bit), hex; compared with a constant-time routine (`router.gd:_constant_time_equals`) |
| Session file | `.godot/mcp_loop/session.json`, mode `0600` inside a `0700` directory, written after the permissions are set; measured `-rw-------` |
| Takeover | A connection becomes active only after a valid `hello`; failures cannot disturb the active client |
| Waiting connections | at most 3 handshaking/unauthenticated, dropped after 5 s without `hello` |
| Buffers | 4 MB inbound / 24 MB outbound per connection; scripts ≤ 1 MB (`MAX_BYTES`), waits ≤ 120 s (`MAX_WAIT_MS`), step holds ≤ 60 s (`MAX_STEP_MS`), `game_step` ≤ 3600 frames |

## S4 — Input validation

- Every tool rejects undeclared arguments (finding 2, fixed; `tool-strictness.test.ts`).
- Non-forward tools now share the `strict()` helper; forwarded tools use `z.strictObject` in `registerForwardTool`.
- Numeric ranges are bounded in the schemas (`max_width ≤ 2560`, `timeout_ms`, `frames`, `steps ≤ 200`, …).
- `project_setting_set` accepts only its nine-key allowlist — a hostile key fails with `Invalid option` (probed).
- JSON values cannot construct scripts: `{new: …}` resources exclude `Script`; Godot literals are parsed only as flat
  literals of the expected type (`str_to_var` is not used to construct objects).

## S5 — Side effects

- Undo: scene/node/property/script/file/asset edits go through `EditorUndoRedoManager` (9 commit points); `edit_undo`
  only reverts actions this server made and stops if a human edited afterwards.
- `dry_run` is available on 11 call sites in `editing.ts` / `files.ts` (writes that could be large or destructive).
- No delete-file tool; `node_delete` and `edit_undo` carry `destructiveHint`.
- Secrets: no token, key or path outside the project appears in tool results or errors. The token only lives in the
  session file and the server's memory; `logs_read` reads the project's own log buffers.

## S6 — Dependencies

- `npm audit` (including dev): **0 vulnerabilities**.
- `package-lock.json` is committed; Dependabot watches npm (`/server`) and GitHub Actions weekly.
- The Godot addon has **no external dependencies** — no GUT/GdUnit4 required (only detected when the project has them).
- Users run the published package (`npx -y godot-mcp-loop@latest`); the release is published with provenance through
  npm trusted publishing.

## S7 — CI and release

- `ci.yml` and `release.yml`: `permissions: contents: read` at the top; the publish job adds `contents: write` and
  `id-token: write` for trusted publishing. No `pull_request_target`.
- Actions are pinned by commit SHA; CodeQL runs on push and PR (green on the release commit).
- Release artifacts carry `SHA256SUMS.txt`; the workflow verifies the checksums and publishes npm with provenance.
- `main` is protected by the `protect-main` ruleset; **tags** are now protected by `protect-release-tags`
  (`refs/tags/v*`, no deletion, no force-update, no bypass actors — owners must disable the ruleset to move a tag).
- Signing the addon zip and tgz with a maintainer key is **not** done; provenance + checksums are the current
  guarantee. Noted as a possible follow-up, not a blocker.

## S8 — Projects you did not write

Added to `docs/security.md`. The sandbox constrains the agent's file access, not project code: editor plugins, `@tool`
scripts, autoloads, test frameworks and scenario `call` steps run with the user's permissions. `--projects-root` limits
which folders the agent may switch to, not what the code there does.

## S9 — Hostile input attempts

| Input | Result |
|---|---|
| `scenario_run {path: "res://../../etc/passwd"}` | `PATH_FORBIDDEN: … outside the project` |
| `scenario_run {save_to: "res://../escape"}` | `PATH_FORBIDDEN` |
| `project_setting_set {key: "rendering/renderer/rendering_method"}` | invalid option (allowlist) |
| `screenshot {max_width: 999999}` | schema error (`≤ 2560`) |
| `script_read {path: "res://a\u0001b.gd"}` | `PATH_FORBIDDEN: … forbidden characters` |
| `node_set {node: "../../../root"}` | rejected: unknown key `node` (schema) |
| 1 MB+ script, 200+ input steps, 120 s+ wait | bounded by `MAX_BYTES`, `MAX_STEPS`, `MAX_WAIT_MS` |

Residual risk, accepted: a method invoked through `game_call` (or a scenario `call`) that never returns blocks the
game's main thread; the tool times out, the game process must be stopped. Inherent to running project code in-process.

## S10 — Documentation

`docs/security.md` now covers: threat model and trust boundary, bridge numbers (above), path rules including the
canonicalisation fix, the scene sandbox, undo/validation, `@tool` semantics, the in-game runtime, per-version tool
notes, projects you did not write, known limitations, and private reporting via `SECURITY.md`.

## Release gate

All High/Medium findings are fixed in 0.8.0 with regression tests. Remaining risks are documented and accepted:
same-user local processes, untrusted project code, a hung `game_call`, unsigned binaries. Release approved on that
basis once the three PRs (#34, #35, #36) are merged and CI is green.

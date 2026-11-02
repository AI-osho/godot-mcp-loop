# Security audit — 0.10.0 release candidate

Date: 2026-11-02. This is a bounded assessment, not a guarantee that the repository or an arbitrary project is safe.
The historical records below are retained as history and do not override this section or `docs/security.md`.

## Current decision and source binding

The local source-review, native, rendering, sample-replay and real-package gates passed for the qualified candidate:

`GML-RELEASE-C3:ca841225dddb0782bdc8c3cbfad0475b122b4b0a03c973542ddec324ef42b43a`

Its inventory contains 473 files with stored-byte SHA-256 and file-mode bindings. The writer, frozen source and
qualification copy were compared directly; the pre-existing index was preserved throughout qualification.
The post-freeze deltas are this report, the CI caller's `TMPDIR` environment binding and diagnostic/fixture-startup
changes to the two Linux-failing integration-test files. They are inventoried separately before commit. Runtime and
package source remain byte-identical to the qualified candidate; original acceptance predicates and operational
limits remain intact. Fixture corrections are not represented as production repairs or retrospective qualification.

**Remote release gates remain separate:** the exact final PR head must pass the required CI and CodeQL checks;
the merged tree must match the approved tree; released assets must be downloaded and checked; npm requires the
maintainer's staged-package approval and a registry-integrity check. This report does not claim these future
publication steps have happened. Tags/history must not be rewritten to repair a published artifact.

## Coverage and independent review

- Reviewed the complete current implementation/configuration surface, including the pre-existing uncommitted
  security repairs, the TypeScript MCP server, all 31 addon GDScripts, fixed Python/Pillow worker, schemas,
  provenance, scene-import boundaries, tests, documentation and distribution/workflow metadata.
- The Node baseline review and its 25-file C1 delta are composed with direct byte comparisons of unchanged files;
  this is not represented as a new full Node review. Its five original blocking findings are resolved in the
  reviewed source. Later artwork-related Node changes are in the fresh review below.
- A fresh read-only review covered the explicitly supplied 83 Godot/artwork/caller/test paths. The runtime session
  records `qwen/qwen3.8-27b` (Nous was requested); this is not a physical-backend or billing attestation.
  The reviewer reported all twelve original Godot/artwork findings resolved and no new blocking findings.
- The first final response incorrectly counted 94 paths and marked a broad verdict false because three
  outside-packet Node files and execution/platform certification were not covered. That negative response is
  retained. Required-path set comparison found all 83 present; the three outside-scope files were independently
  checked against the previously reviewed, byte-identical Node baseline. One same-reviewer clarification returned
  `passed:true` strictly for `source-only-required-83`, retaining all non-guarantees. It is not publication approval.
- Independent source opinions, parent-executed tests, deliberately mutated negative controls and human acceptance
  remain different evidence classes. A process exit code alone was not used as an acceptance verdict.

## Repairs and boundary checks

| Surface | Repair and measured coverage |
|---|---|
| Direct text/property editing | Bound every UTF-8 replacement intermediate before allocation; reject invalid indexed builtin members before native indexing; preserve resources/state on refusal. |
| Simulation and lifecycle | Reject paused timed/frame input before mutation; one owner for input/step/pause; keep queries available. Bind run/stop continuations and child hello to their own lifecycle, refusing successor attribution/termination. |
| Truthful outcomes and timing | Detected native errors force `passed:false` even with exit zero and passing JUnit; retain the actual exit/totals. Ordinary waits use a monotonic wall deadline; Movie Maker's fixed simulation clock is handled separately. |
| Owned editor and executable | Couple PID/port/token metadata to the actual authenticated peer, recheck after reconnect, and quit only the owned child. Resolve the tested executable once and handle asynchronous spawn failures. |
| Scenario and screenshot I/O | Require valid PNG baselines in schema and final writer, preserve non-PNG targets, propagate required log-read failures and the selected project through batch/repeat/evidence operations. |
| Artwork records/import | Validate derived producer output against the consumer schema before publication; capture scene/parent identity before worker waits and revalidate after final imports. |
| Artwork byte generations | Decode the captured checksum generation; recheck preview manifest/image identity; atomically publish directories without replacing a late claimant, failing closed when no safe primitive exists. |
| Filesystem bounds | Reject link/reparse metadata and resolved escapes, stream native directory lookup with a 4096-entry cap, and propagate refusal. Exercise both server/addon guards, internal I/O, aliases, hard-linked leaves, save destinations and delayed undo. |

Focused RED/GREEN evidence is retained for the actual repaired boundaries. Native race tests use controlled
barriers; mocked-process, synthetic Windows metadata and deliberate mutation controls are labelled as such rather
than upgraded to real cross-platform or historical-production reproductions.

## Executed local qualification

macOS, Godot 4.7.2, Node 24, private Python 3.13 / Pillow 13.0.0. Existing user Python, MCP registrations, protected
original games/artwork and other profiles were not modified. Native editors/games ran in isolated copies.

| Gate | Actual terminal result |
|---|---|
| Type check and build | Both succeeded |
| Node unit/integration suite, normal worker configuration | 49 files; 468 passed |
| Godot unit suite | 288 passed, 0 failed; no native error prefix in the accepted log |
| Headless real-editor/runtime integration | 153 passed, 12 opt-in skipped; those skips are not passing tests |
| All shipped sample groups plus independent frame-lifetime oracles | 9 passed in each of two complete passes |
| Dedicated windowed rendering/movie/screenshot/artwork checks | 4 passed across 3 files |
| Original motivating fighting game | All 13 scenarios passed twice; 26 reports, 772 step results, no recorded errors |
| Real installed tarball over MCP stdio | 48 tools listed; six artwork tools exercised; 7 source PNGs produced 22 byte-matching PNGs; missing-Python refusal checked |
| Actual package/ZIP | Exact 187-file npm payload and 64-file addon payload checked against source; installed bytes and addon installation checked; no detected secrets/developer-home paths |

The two shooting scenarios had previously failed by observing a short-lived effect/invulnerability state after
transport latency consumed the observation window. The game rules and original predicates/timeouts/image labels
were not weakened: pause plus physics stepping synchronizes the observation. Independent real-runtime per-physics
records measure the original 20-tick effect and 120-tick invulnerability. Both oracles rejected an isolated fixture
whose respective lifetime was shortened to one tick; that mutation is not shipped and is not historical RED.

The first fighting-game fixture lacked its private trial's nine named input actions. That failed run is retained;
only the isolated fixture's InputMap was corrected using names from the unchanged game, then the whole folder ran
twice. Original game/scenario bytes were rechecked. Empty physical bindings qualify MCP named-action replay, not
keyboard mappings or a new human trial. Actual source-artwork/shooting images and a twelve-image fighting-game
contact sheet were visually inspected; image display alone does not prove timing, provenance or user acceptance.
Owned private fixture Godot and package-server processes were checked absent after cleanup.

The first Linux PR run passed Node20/24, samples/movie and CodeQL, but its unit job reported286 passed/2 failed.
Both failures were the unchanged hardlink tests' explicit `TMPDIR` precondition, before filesystem mutation:
`test requires its caller's isolated TMPDIR`. The CI caller had supplied only `GODOT_BIN`; it now also supplies the
job-private `runner.temp` as `TMPDIR`. This is a caller-environment correction, not a production/test-predicate repair.
The original failure is retained, and the corrected exact head must complete all remote gates before release.

The corrected Linux head passed all288 Godot units but failed two integration cases (142 passed,2 failed,21 skipped):
the current-scene-change refusal control and the exit-zero/successful-XML control. That failed result is retained.
On renewed user authorization, one bounded diagnosis cycle targeted only those two cases. A fresh macOS source copy
passed both unchanged files (16 tests), which did not establish a Linux cause. The diagnostic change retains the
original launch order/waits/refusal/native-error predicates, records scene/root/preflight observations, and reports
only closed native-error categories/counts/source-line numbers rather than raw child output. A deliberately
raw-output formatter was rejected by the new diagnostic test in a private copy and passed after restoration.

The diagnostic head `bc778830ab66b7760ef4bc5235744ce07769c721` then passed all seven remote required checks:
Node20/24, Godot units288/0, Linux integration145 passed/21 skipped (including the new diagnostic-only unit),
windowed samples/movie and CodeQL. Its fresh local checks also passed Node468, Godot288 and integration154/12 skipped.
An independent diagnostics-only source delta review covered six full files plus the current report section at
that diagnostic freeze; it found no blocking issue and is not represented as a new full audit or Linux execution
certification.

That success was not treated as a causal fix: the report-only head
`ea518050a30fb75561a4b51119b59b70e71ce1ff` reproduced both original failures (143 passed,2 failed,21 skipped).
Its scene trace observed `other.tscn` while scanning, then the original `first.tscn` root29ms later when the scan
finished; both production preflights correctly saw the captured first root. The fixture's transient selection was
not the changed final target its assertion assumed. The fixture now completes the intercepted native wait first,
then changes the still-captured target before returning to preflight, explicitly requiring that change to exist.

The exit-zero control recorded two native errors classified as resource/file and autoload/load, not evidence for
the earlier queue-free speculation. A private native three-case probe observed the real runtime autoload saved
as a UID while its disk cache could still be absent at bridge admission. Holding that cache absent reproduced
exit0, successful XML and the matching two resource/autoload error classes; the same UID with its cache passed.
This is a controlled cache-boundary reproduction, not recovery of the old deleted CI child's exact UID bytes.
Successful synthetic-runner fixtures now require a stable published cache containing their runtime-autoload path
before spawning; positive exit controls explicitly require zero native errors. A real missing-cache failure and
same-client recovery remain checked. Native-error rejection, actual exit/XML predicates and original120s test
limits are unchanged; no autoload is disabled and no production error is ignored.

The corrected-fixture freeze is not release approval: full local qualification, an independent scoped delta
review and all exact-head remote checks are required before merge/tag. Both the prior success and renewed failure
are retained. Do not erase the old failures or claim universal startup/timing/platform robustness; actual released
assets and npm approval/integrity remain separate gates.

Locally qualified archives (remote archives are checked independently after release):

- npm tarball SHA-256: `92ef970437910458e36b86df78f81471ab803cd03e6272ad448adc631e79e5f1`
- addon ZIP SHA-256: `117f650973f0915b4cce36ad625fb9a5c420d83b92ae074f1213d1ada3040816`

## Repository, dependency and supply-chain checks

The final-audit work also inspected fetched Git history, proposed source, GitHub-side accessible metadata/logs/assets,
dependency/license metadata and nested release payloads. The initial fully redacted history/source secret scans
found no leaks; initial all-dependency and production-only npm audits reported zero advisories. These are dated
observations, not a promise about future advisories or inaccessible service data. LICENSE and companion addon/skill/
sample/worker payload inclusion were checked in real archives. No credentials or raw private diagnostics are included
in this report. Existing personal history was not rewritten.

Workflow policy was inspected: read-only default permissions, SHA-pinned actions, checkout credentials not persisted,
checksum-verified Godot downloads, no `pull_request_target`, bounded jobs, protected main/release tags and npm's
OIDC/staged-publishing path. Live required-check conclusions are verified for the exact PR head before merging;
configuration alone is not a successful run or a published npm version.

## Trust boundary and residual limitations

- Trusted MCP client/operator-selected Godot/Python and project code. Code-writing tools, opening projects,
  validation/static initialization, callbacks, tests and exports can execute code with the user's rights.
  These protections are direct-I/O/accident and ordinary-concurrency safeguards, not an OS sandbox.
- No atomic guarantee against a malicious same-user process replacing arbitrary project/code/evidence generations.
  A non-returning project method can block its process; limits are per-input, not global memory/disk/CPU quotas.
- Native Windows junction/alias/no-replace behavior and Linux collision-race qualification were not demonstrated
  on those platforms by the local macOS tests. Synthetic reparse metadata is not native Windows evidence.
- Pixel generation matching a freshly hashed PNG is not comprehensive certification of every cached Texture2D
  after arbitrary external edits. An additional stale-import/cache qualification remains a nonblocking proposal;
  no such failing generation was reproduced in this assessment.
- An independent quit-caller-specific mutation test remains a nonblocking regression-strengthening suggestion;
  it is not a reported defect in the current guarded quit implementation.
- Image-model identity, requested/reported quality, provider/billing facts, rights and human visual/play acceptance
  are not inferred from an image or a successful recipe. No image-generation call was made by qualification.
- Artifacts are not signed with a separate maintainer key. Checksums and npm OIDC provenance do not remove the
  inherent trust in project code, dependencies, the maintainer or the provider/platform.

See `SECURITY.md` for private vulnerability reporting and `docs/security.md` for the current threat model.

---

# Security audit — historical v0.8.0 record

> **Superseded, not a current release approval.** The full 2026-10-20 re-audit found additional path, internal-I/O,
> process-lifecycle and input-focus problems after this record was written. Local fixes are undergoing fresh
> qualification. In particular, the older claims about read-only methods, deletion, complete export containment and
> an approved release below must not be used as current guarantees. The current threat model is in `docs/security.md`.

- Scope: everything released as `godot-mcp-loop` 0.8.0 — the MCP server (`server/`), the Godot addon
  (`addons/mcp_loop/`), the CI and release workflows.
- Date: 2026-10-20. Performed by Hermes (DeepSeek V4.1 Flash) at the user's request, as a release gate.
- Method: read every tool registration and the bridge; ran the checks below against a live editor and the built server
  (`GODOT_LOOP_SERVER=server/dist/index.js`); sent deliberately hostile arguments; confirmed each fix with a test that
  fails before it and passes after.

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **High** | Path sandbox bypass via letter case (addon **and** server): `res://.GIT/config` read `.git/config`, and `res://Addons/mcp_loop/probe.gd` **wrote a script into the addon**. macOS and Windows resolve names case-insensitively; the prefix check compared bytes. A script in `addons/` runs in the editor on the next reload — arbitrary code with the user's rights, and `.git/hooks` is the same class. | **Fixed** (#35 addon, #39 server): the addon canonicalises segments against the directory listing and compares prefixes case-insensitively; the server's `resolveProjectFile` / `resolveEvidenceFolder` compare the first segment case-insensitively. A second pass found the server side still open — `scenario_run {save_to: "res://.GODOT/evil"}` wrote evidence into the real `.godot/` and `{path: "res://.GIT/config"}` read the git config; both now return `PATH_FORBIDDEN`, verified live. Tests: `test_rejects_case_variants_of_protected_dirs`, `refuses case variants of protected folders` |
| 2 | Medium | Eight tools accepted undeclared arguments and silently dropped them: `godot_status`, `project_list`, `project_connect`, `editor_launch`, `editor_quit`, `screenshot`, `scenario_run`, `test_run`. The #26 strict-schema fix only covered `registerForwardTool`, so an argument typo looked like it worked. | **Fixed** (#36): all eight use `strict()`; `tool-strictness.test.ts` calls every tool with `{__undeclared__: 1}` and requires a validation error (verified red on the previous build) |
| 3 | Low | Release tags were unprotected: a `v*` tag could be deleted or force-moved, so a published release could be repointed. `main` already had a ruleset. | **Fixed**: ruleset `protect-release-tags` (target `tag`, `refs/tags/v*`, blocks deletion and non-fast-forward, no bypass actors) |
| 5 | Medium | Scenario evidence could be written **into our own addon**: `scenario_run {save_to: "res://addons/mcp_loop/evil"}` created `01-title.png`, `report.json` … inside `addons/mcp_loop/`. The server's write rule only protected `.godot/` and `.git/`. Found by the new mutation test (#42). | **Fixed** (#42): the evidence resolver refuses `addons/mcp_loop`; other addons stay writable, matching the addon's own rule. Verified live (`PATH_FORBIDDEN`, other addons still work) |
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

## Path mutation tests (property-based)

Two property tests generate spellings that still resolve to a protected file and require every one of them to be
refused: case flips, doubled slashes and `./` segments — exactly the transformations a case-insensitive file system
collapses to the same file. Seeded (20261020) so a failure is reproducible.

| Test | Targets | Proof |
|---|---|---|
| `tests/godot/unit/test_path_guard_fuzz.gd` (240 mutations per path) | `.git/config`, `.godot/global_script_class_cache.cfg` (read), `addons/mcp_loop/*.gd`, `.git/hooks/*` (write) | fails against the pre-#35 byte comparison (`read bypass: res://.giT/coNfig`), passes now |
| `server/test/path-fuzz.test.ts` (120 per path) | the same on the server's `resolveProjectFile` / `resolveEvidenceFolder` | fails against the pre-#39/#42 comparison, passes now |

On a case-sensitive file system a mutated spelling simply does not exist, so the test asserts only on mutations that
resolve; it also asserts that harmless mutations of allowed paths stay allowed, so the check cannot pass by refusing
everything.

**Result: one more hole found and fixed (finding 5).** No other bypass surfaced across ~1,400 generated spellings.

## Follow-up round (after the first audit pass)

- Server-side path resolution was still vulnerable to the case trick (#39). Found by deliberately re-running the probes
  against the server's own code paths rather than the addon's, fixed and verified.
- The version-mismatch confusion that started all of this now logs a warning on connect (#40) as well as in
  `godot_status`.
- A2's remaining "partial" items were re-measured: side-step invincibility confirmed (a punch that deals 6 damage
  normally deals 0 when the side step starts 3-6 frames into its startup); the KO recording covers the KO and the
  knockdown but stops before the result screen (recording range, not a defect); the +2/-6 frame advantage remains the
  game's own counter — the defender's guard stun is not exposed as a move, so it was not independently re-derived.
- Same-user / unauthorized client: a raw WebSocket with a wrong token receives `UNAUTHORIZED` and cannot take over the
  session (probed against the live bridge).
- A blocking method (`while true: pass`) called through `game_call` makes the **game** hang and the tool return
  `TIMEOUT … within 7000 ms`; the **editor keeps answering** (`godot_status` in 3 s) and `game_stop` recovers in 3 s.
  This is the measured behaviour behind the accepted risk in S9.
- The fighting game's 13 scenarios were re-run against 0.8.0 (43.4 s, 13/13) to prove the paused-input change did not
  break scenario playback.

## Re-audit: 0.9.0 – 0.9.3 (2026-10-20)

Scope: the surfaces that did not exist at the 0.8.0 audit — `project_export`, the Claude Code plugin, the `sample`
command and the bundled Marble Run project — plus a check that the 0.8.0 path fixes still hold at HEAD.

| # | Check | Result |
|---|---|---|
| R1 | Dependencies (`npm audit`, prod and all) | 0 vulnerabilities |
| R2 | `project_export` invocation | `spawn(..., { shell: false })` with a fixed argument list; the preset must exist in `export_presets.cfg`; the output must resolve under `res://build/` (absolute paths, `..` and backslashes are refused) |
| R3 | Release workflow | `contents: read` by default; the publish job adds only `id-token: write` for npm trusted publishing, under `environment: npm`; no stored npm token |
| R4 | Claude Code plugin | MCP server launched with a fixed argument list; `--project` is a user-supplied path, never a shell string. **Changed:** the server was launched as `godot-mcp-loop@latest`, which re-resolves npm on every editor session — one bad or compromised publish would run everywhere. It now pins this plugin's exact version, and a test fails if `@latest` returns |
| R5 | `sample` command | Copies from inside the package; refuses a non-empty destination and (new) a destination inside the installed package; no writes outside the folder the user names |
| R6 | Bundled sample content | No `OS.`, `DirAccess`, `FileAccess` or absolute paths in the Marble Run scripts — it is game code only |
| R7 | 0.8.0 path fixes at HEAD | `test_path_guard.gd` (236 assertions incl. case variants), `path-fuzz.test.ts` and `tool-scenario.test.ts` still pass; `.git`, `.godot` and `addons/mcp_loop` remain protected in both readers |

Residual risk added by this scope: a user who copies the sample into a project and runs it executes code that came from
the npm package (expected for a sample), and the plugin's pinned version only moves when the user updates the plugin.

## Release gate

All High/Medium findings are fixed in 0.8.0 with regression tests. Remaining risks are documented and accepted:
same-user local processes, untrusted project code, a hung `game_call`, unsigned binaries. Release approved on that
basis once the three PRs (#34, #35, #36) are merged and CI is green.

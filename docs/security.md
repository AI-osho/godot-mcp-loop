# Security

## Threat model and trust boundary

Godot-mcp-loop lets an AI agent write GDScript, instantiate resources and scenes, call game methods, and run or
export a project. **Those operations execute project code with your operating-system user's permissions. This is
not an operating-system sandbox.** A client allowed to write a script and run it already has code-execution power.
There is no raw shell/eval tool, but that does not restrict what a project script can do.

The protections below address unauthenticated local clients and accidental damage from incorrect tool arguments,
not hostile code running as your own user. Trust the MCP client, agent, Godot executable, installed package, project,
plugins, resources and test framework. MCP annotations are advisory metadata, not authorization controls.

Require client-side approval for code writing/loading, resource or scene instantiation, game-method calls, running
or exporting projects, and starting an editor if you do not trust the agent. `dry_run` previews a tool's own edit;
it is **not** a promise of no code execution: validation, resource loading, constructors and custom getters can
execute project callbacks before the edit is committed. Disabling the submitted script's `@tool` annotation during
validation does not sandbox its dependencies.

## Static installation diagnosis (`doctor`)

The standalone `doctor <project> [--json] [--artwork]` CLI (0.11.0+) reads bounded project/addon metadata with a
conservative lexer, not Godot's Variant/project loader. It does not load project/plugin code, contact the bridge,
read session/client credentials, launch an editor, install dependencies or repair files. Unsupported syntax,
including Unicode syntax whitespace that would change native keys/values, remains unverified rather than a false
pass. Legitimate quoted Unicode is preserved; project and addon metadata BOM handling follows separate readers.
An `ok` static result is not a connection/gameplay/full-addon-integrity certificate: runtime remains `not_checked`.

It executes only fixed version probes through operator-trusted Godot and optional Python/Pillow executables,
without a shell, with bounded output/time and a small environment allowlist. The installed executables and Python
startup/site packages are trusted; this is not an OS sandbox or hostile-descendant containment. Python is not
started without `--artwork`. No raw config values, arguments, probe output or exceptions are echoed. As with the
other direct-I/O guards, hostile same-user filesystem replacement races are outside the guarantee.
See [the doctor guide](doctor.md) for limits and result codes. `npx`/`npm install` package preparation is separate
from read-only diagnosis and may itself fetch dependencies.

## Bridge (MCP server ↔ editor)

| Protection | Details |
|---|---|
| Localhost only | The addon binds `127.0.0.1`, normally ports 6510–6519; `MCP_LOOP_PORT` can select another starting port. |
| Token | A fresh 256-bit random token is required in the first `hello` message and compared in constant time. |
| Session file | `res://.godot/mcp_loop/session.json` contains the connection metadata. On POSIX it is restricted to `0600` in a `0700` directory before the token is written. An existing file is detached before chmod/write, so a hard link cannot change another inode's content or permissions. Windows relies on the directory's inherited ACL; POSIX modes are not a Windows ACL guarantee. |
| Authentication before takeover | A connection replaces the active client only after a valid `hello`. A wrong token cannot kick out an authenticated client. |
| Bounded waiting | At most three non-active peers across handshake, unauthenticated, reply-flushing and closing states. Handshake/authentication phases each have a five-second limit. A withheld close handshake is forcibly disconnected after one second, following the bounded reply grace period. |
| Buffers | 4 MiB inbound and 24 MiB outbound per connection. These are transport limits, not a sandbox or an overall memory budget. |

A web page may open a WebSocket to localhost, but cannot authenticate without the token. Repeated connection attempts
can still occupy the waiting slots and delay a legitimate reconnect. A process running as your own OS user can read
the token or change the project directly; same-user isolation is out of scope. The server refuses hard-linked session
files and requires the recorded `project_path` to identify the selected project directory by filesystem identity; a
copied connection file must not silently connect a different project.

## Direct filesystem operations

Two separate implementations enforce the boundary: the addon's `PathGuard` and the server's `projectFilePath()`.
The server does not rely on the addon to validate its own scenario reads, evidence, screenshot baselines or exports.

- Public addon file paths must use `res://`; server scenario/evidence/export paths also accept a project-relative
  spelling where documented. Absolute paths, `..`, backslashes, control characters, colons, and path segments ending
  in a dot or space are refused. `.` segments and duplicate separators are normalized.
- The selected project root may itself be reached through an alias; its real directory is the authority. Below it,
  symbolic links, including dangling links, are refused. Protected prefixes are compared case-insensitively and by
  native object identity: filesystem Unicode aliases can exceed JavaScript/Godot lowercase mappings. Equivalence
  lookup must not resolve a symbolic link away before the no-follow check.
- Public file operations cannot read or write `.git/` or `.godot/`, or write into `addons/mcp_loop/`. Other addons are
  not universally protected; use a trusted project. Screenshot baselines apply the narrower rule of no `addons/`.
- Writes also have tool-specific extensions: scripts through `script_write`/`script_edit`, PNG through `image_write`,
  and text through `file_write` (`.yaml/.yml/.json/.md/.txt/.csv`). An extension allowlist is not a content sandbox.
- Exact text edits bound each intermediate UTF-8 result to 1 MiB before replacement allocation. Native path
  canonicalization uses streaming directory lookup and refuses unresolved lookups exceeding 4096 entries per parent;
  read, write and fixed internal-path guards preserve that refusal. It does not enumerate through a symbolic link.
- Server write-path checks reject multiply linked regular files. Evidence checks its manifest files before reading
  them, and its individual file writer refuses hard-link overwrites rather than only checking the destination folder.
- Fixed internal paths are not public alternatives to the guard. Session, movie and test paths have their own link
  checks; cache cleanup checks a linked tree root before descending. The server also validates `editor.log` and its
  session reader. Internal session deletion rechecks the current path.
- File actions record the paths they touched. `edit_undo` rechecks those paths before applying the history action;
  replacing a parent with a link after the original edit does not authorize a later write or deletion through it.
  A refusal does not consume the action: restore a safe path before retrying.

These are checks around the tool's **direct I/O**, not restrictions on Godot's importers, project code, resource
references or plugins. They are not an atomic defense against a same-user process replacing filesystem objects
between validation and use. Native Windows junctions, short-name aliases and ACL behavior have not been certified by
the macOS/Linux tests; do not infer cross-platform proof from portable spelling tests alone.

There is no general delete-file tool. Some tools do perform documented deletion/replacement: undo of created assets,
replacement of generated evidence, old recording frames and test reports, and CLI installation with `--force`.
`input_action_set` and `project_setting_set` deliberately change permitted project settings; they are not arbitrary
editor-settings tools.

## Scene, values and code loading

Editor node paths resolve inside the edited scene root: `..` is rejected and the result must be the root or a
descendant. Runtime node paths address the separate game process, including its autoloads; they do not reach the
editor's UI tree.

Property values are checked before applying an edit. Godot literals are accepted only as flat literals of the
expected type; untrusted strings are not handed to `str_to_var` as general object constructors. Embedded
`{"new": ...}` resources exclude `Script` subclasses. Loading an existing project resource is still a code/trust
boundary, not proof that the resource has no script or custom behavior.

Indexed Resource edits are prepared on copies so previews and undo snapshots do not mutate a shared live Resource.
Indexed Script and non-Resource Object references are refused. Generic node editing cannot change `scene_file_path`
or indexed `resource_path`; dedicated scene/resource tools own these identities. Before native scene save, play
autosave or save-all on quit, the bridge rechecks `project.godot` and every open scene's destination, including
inactive scenes. Trusted project callbacks can still change metadata, so refusal at the generic setter is not the
only save guard.

`script_write` compiles a validation copy before writing and leaves the file unchanged on a reported parse error.
The submitted copy's `@tool` annotation tokens, including inline `@icon(...) @tool`, are blanked during that check
without changing comments, strings or source locations, and a warning is returned. Attaching, loading,
using or importing the resulting script/resource may execute code in the editor. Scene/resource constructors and
property getters/setters can execute code too, including in nominally observational workflows.

`game_wait_for` can repeatedly invoke a caller-selected method. It is therefore **not marked read-only**; use pure
observation methods such as a side-effect-free `summary()`. This is a convention, not an enforced purity check.

## Execution, process and resource limits

- The runtime uses Godot's debugger channel, not another listener. It activates only for a game launched with the
  debugger attached and frees itself in exported games without it. Export presets can exclude `addons/mcp_loop/`.
- Input sequences accept at most 200 steps; individual hold/wait durations are bounded. Runtime waits are capped at
  120 seconds, and one `game_step` advances at most 3600 physics frames. A paused tree cannot execute timed input;
  this includes positive waits attached to inline edits. Use `game_step` or resume it. One step/input/pause operation
  owns simulation progress at a time; competing calls return `BUSY`, while queries remain available. Ordinary
  millisecond input waits use a monotonic wall clock; Movie Maker retains its fixed-step game-time behavior.
- Game run/stop/editor-quit requests serialize their lifecycle ownership. A launch-specific, non-authentication
  nonce is passed through a temporarily scoped editor environment variable and echoed by that child, then checked
  before launch success. The prior editor environment is restored immediately after native play. Graceful-stop
  continuations check the debugger generation before forcing a stop, rather than stopping a later replacement.
- Scenario documents have a 1 MiB UTF-8 text limit. Inline objects also charge object keys and string values to that
  budget (array index spellings are not text payload). Structural depth/node bounds, recursive-alias rejection and
  the expanded step-count bound still apply. These are parsing limits, not an overall runtime or disk quota.
- The server PNG decoder accepts at most 32 MiB of compressed input, dimensions up to 8192 per side and 16 megapixels.
  Inflation is bounded by the expected scanline size; chunk CRC, structure and indexed palettes are checked. Supported
  grayscale/RGB `tRNS` chunks require 2/6 bytes respectively; indexed transparency must be nonempty and fit its palette.
  Colour types already carrying alpha cannot also use `tRNS`. Node's
  project-controlled reads use bounded descriptors (metadata 64 KiB, text 1 MiB, evidence 8 MiB, PNG 32 MiB, editor-log
  tail 16 KiB); the installed package's own version metadata is separate. This is not a claim that every Godot read,
  directory enumeration, callback or process allocation has an overall quota.
- `test_run` starts the editor's own Godot executable with an argument list, no shell, using the installed GUT or
  GdUnit4 runner at its fixed path. One test process runs at a time; the requested timeout is at most ten minutes.
  Its framework and tests are project code, not sandboxed inputs. At timeout the direct child is killed and polled
  for a bounded grace period. Unconfirmed exit keeps the runner busy until that process is observed dead, so another
  run cannot delete its output. Log reads take only the final 64 KiB; JUnit inputs above 8 MiB are refused.
  A nonzero process exit, malformed report, or detected native Godot error prevents a passing run verdict, even
  when individual JUnit cases report success. The original JUnit totals remain distinct from the run verdict.
- `editor_launch` uses the server-configured/verified Godot executable and a fixed argument list. Its log stays under
  `.godot/mcp_loop/`. Relative executable candidates are bound to the discovery working directory before version
  checking, so spawning from the project's directory uses the same file. Asynchronous spawn failures become tool
  errors, not unhandled process events. Opening the project can run plugins and `@tool` scripts.
- Godot interprets argv values even without a shell: it strips argument edges and replaces literal `%20` before
  option parsing. Export, editor/game launch and test-runner arguments refuse those altered values and control
  characters; export preset names cannot start with `-`. Values are refused rather than rewritten, and export
  preflight runs before output-folder creation. Ordinary Unicode names and interior spaces remain supported.
- Owned-editor readiness and `editor_quit` bind the actual authenticated connection to the current session's
  PID/port/token identity, including a check after reconnect waits. A stale connection is reconnected before sending;
  an intervening identity change is refused, not retried after a send. A missing owned PID cannot authorize quit. An
  authenticated bridge client is nevertheless a trusted editor controller, not a restricted OS user. A failed stop
  is reported as unconfirmed and keeps its ownership record; it is not reported as `quit: true`.
  A domain-level save refusal is propagated without force-killing the editor; repair the destination and retry.
- `project_export` uses the verified Godot executable, `shell: false`, an existing preset, and a requested output under
  `res://build/`. Before spawning, it checks the path again and inspects the output folder, including companion files,
  for symbolic links, hard links and special files. The inspection fails closed above 10,000 entries or depth 32.
  Prefer a dedicated output folder. After timeout it requests SIGTERM then SIGKILL and closes its pipes; a descendant
  retaining stdout cannot keep the server's export promise pending forever. Partial diagnostics are retained, and a
  timeout states whether the direct child's exit was actually observed. It does not claim to terminate every
  descendant started by arbitrary project/export-plugin code.

Export path selection is **not** a sandbox for the exporter: Godot can update import caches and plugins can write
elsewhere. Reported output files are those found at the selected output location, not a complete OS write trace.
Likewise a blocking method, initializer or callback can hang a game or the editor; a request timeout cannot preempt
arbitrary in-process GDScript. Stop the affected process, and use OS-level isolation for untrusted projects.

## Evidence and recording

Screenshot baselines require `.png` paths at the scenario schema and final writer. Updating an existing baseline
also verifies that its current bytes decode as PNG; it cannot overwrite arbitrary settings/script/scene files just
because a capture was valid. Baseline writes are not editor undo actions. Explicit `assert_no_errors` fails if error
logs cannot be obtained or their reply is malformed; best-effort report diagnostics are not a substitute for that check.

The optional artwork worker requires Python 3.11+ with exactly Pillow 13.0.0 and does not install dependencies or call
an image-generation service. It bounds source/PNG bytes and pixels, individual output frames, intermediate pose
geometry and aggregate retained selections before allocation/publication. These are application-level limits, not
an OS sandbox, global CPU/memory/disk quota, cryptographic provenance or image-provider/rights certification.
Existing image-path segments reject symlinks/reparse metadata and resolved physical escapes; native Windows junction
behavior remains unverified here. PNG verification decodes the captured checksum-checked bytes, and preview rebinds
any reread manifest/image identity before returning. New build directories use atomic no-replace publication
(Darwin `renamex_np`, Linux libc `renameat2`, Windows no-replace rename); unsupported platforms fail closed. Native
artwork scene/parent identity is captured before the worker verification wait and checked again at import/commit.

`scenario_run save_to` stores screenshots and Markdown/JSON reports below a project folder, never the project root,
`.git/`, `.godot/` or this addon's own directory. A non-empty folder without a valid local generator manifest is
refused. A re-run deletes only listed regular files that remain inside the evidence folder, without traversing links in any
path component (even links to another place in that same folder); a generator marker is
not a cryptographic ownership credential. Do not point it at valuable manually maintained folders.

Movie Maker writes raw frames and audio to the fixed `.godot/mcp_loop/movie/` folder. Preparation refuses a linked
folder and removes only the recognized prior frame/audio names. Launch settings are restored after play starts.
The server writes the GIF/contact sheet and optional kept frames under the evidence rules. Recording and report
storage do not have an overall disk quota; long scenarios can fill a disk. Allocate space and clean up generated
artifacts, or use a separately quota-limited environment.

The movie converter shrinks each decoded source before retaining a thumbnail or palette sample. Both axes are
bounded: contact/palette tiles fit a 320-pixel box; GIF frames fit `max_width` on either axis (never enlarged).
GIF output is capped at 64 MiB of encoded bytes. These bounds prevent arrays of full-resolution source frames and
unbounded encoded-buffer growth; they are not an OS memory limit or a promise that arbitrary project code cannot
exhaust resources.

## Project switching, installation and distribution

`project_connect` is off unless the server was started with `--projects-root`. A target must contain `project.godot`,
resolve below an allowed root, and not be inside `.git/` or `.godot/` (including case variants). This limits the
chosen project directory, not what its code can access. Listing skips hidden folders and linked directories.
Multi-step scenarios (including idle waits/evidence saves), exports, and editor launch/quit pin that selected project
until completion. A concurrent switch returns `BUSY`; failure releases the pin so a later switch can be retried.

The CLI `sample` command copies a known bundled sample into an empty/new destination. Both `sample` and
`install-addon` refuse destinations inside the running package, using filesystem identity rather than only string
prefixes. Destructive installer destinations must also be disjoint from loose-checkout addon/skill sources and must
not contain the running package or a copy source. All destinations are checked before replacement. Installer
destinations refuse linked components and hard-linked files before writing through them.
`--force` replaces the named addon/skill; it is an explicit destructive option, not an undoable edit.

The Claude Code plugin pins the exact server version it ships with instead of re-resolving `@latest` at every
session. A pin reduces unnoticed version drift; it does not prove the package or dependencies cannot be compromised.
A development manifest may name an unpublished version and is not a released installation candidate.

Release artifacts have checksums and npm provenance/trusted publishing; maintainers still approve staged npm
publication with 2FA. Checksums do not replace a signature from an independently trusted key. The current branch/tag
rules prevent deletion and force-update; they do **not** by themselves require reviews or passing tests. Release
qualification and approval remain explicit maintainer gates. See [the audit record](../SECURITY-AUDIT.md) for what
was actually exercised and what remains open.

## Reporting

See [SECURITY.md](../SECURITY.md): report privately through GitHub's *Security → Report a vulnerability*, not in a
public issue. No audit is a guarantee that the repository or all supported platforms are vulnerability-free.

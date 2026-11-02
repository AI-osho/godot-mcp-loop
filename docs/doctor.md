# Static installation diagnosis: doctor

Available from godot-mcp-loop **0.11.0**. Older packages do not contain this command.
Use the same version as the project's addon; a static version mismatch is reported rather than repaired.

## Run without starting the editor

Run a version-pinned package:

```sh
npx -y godot-mcp-loop@0.11.0 doctor /ABS/my-game
npx -y godot-mcp-loop@0.11.0 doctor /ABS/my-game --json
npx -y godot-mcp-loop@0.11.0 doctor /ABS/my-game --artwork --json
```

`npx` may first fetch/install the package and its dependencies. That explicit launcher setup is separate from
read-only diagnosis. From an already built source checkout:

```sh
node /ABS/godot-mcp-loop/server/dist/index.js doctor /ABS/my-game
node /ABS/godot-mcp-loop/server/dist/index.js doctor /ABS/my-game --json
node /ABS/godot-mcp-loop/server/dist/index.js doctor /ABS/my-game --artwork --json
```

Quote paths containing spaces. Run `doctor --help` for usage. `--fix`, executable recipes and server launch
options are not accepted. Doctor is a standalone CLI, not an MCP tool: do not register it as the server command.

To use the downloaded release archive without changing a global installation:

```sh
npm install --prefix /ABS/doctor-check --ignore-scripts --no-audit --no-fund /ABS/godot-mcp-loop-0.11.0.tgz
node /ABS/doctor-check/node_modules/godot-mcp-loop/dist/index.js doctor /ABS/my-game --json
```

That explicit setup step installs the package/dependencies; doctor itself never installs or repairs anything.
No client registration, authentication or global setting changes are required.

## What is checked

- Node.js 20+, the selected project marker and its static format.
- Addon metadata version versus the running package, the declared entry script, and presence/safety of
  `plugin.gd` and `runtime/runtime_agent.gd`. This is not a full addon checksum or compilation check.
- The exact plugin path in `[editor_plugins] enabled=PackedStringArray(...)`.
- Godot discovery using the existing helper and fixed `--headless --version` probes. Only the reported
  4.7.2 stable version is marked verified; other versions, including prereleases, remain unverified.
- Only with `--artwork`: the selected interpreter reports Python 3.11+ and can import Pillow 13.0.0.
  Without the option, Python is not started and a skipped optional check does not fail the whole report.

Discovery uses this caller's `PATH`/`GODOT_BIN` and `GODOT_LOOP_PYTHON`, not an MCP client's stored configuration
or the environment of a server that is already running. A matching version report is not binary attestation.

## Read the result

The JSON schema is version 1. Top-level `scope` is `static_installation_only`. Each check has `id`, `status`,
`code`, `message`, and optionally `hint` / `required`. Use codes rather than parsing English messages.
The check list contains only reached checks: unsafe or unsupported input can skip later checks; IDs/counts are not fixed.

- `ok`: all requested static checks succeeded, not a runtime readiness certificate.
- `problem`: at least one check found a concrete problem.
- `not_checked`: no concrete problem was found, but a required check could not be verified.
- `required: false` excludes an unrequested optional check from the aggregate.
- `runtime` always remains `{ "status": "not_checked", "code": "RUNTIME_NOT_CHECKED" }`.

Exit codes: 0 for static `ok`, 1 for `problem` or required `not_checked`, 2 for invalid arguments.
Human-readable output includes next-action hints and the runtime disclaimer. JSON goes to stdout without raw
probe/config/error text. Unknown arguments are not echoed.

| Code | Next action (manual, not performed by doctor) |
|---|---|
| `PROJECT_NOT_FOUND` / `PROJECT_UNREADABLE` | Select the folder containing a safe readable `project.godot`. |
| `ADDON_NOT_INSTALLED` | Install the matching addon with the package's `install-addon` command. Back up existing work first. |
| `ADDON_VERSION_MISMATCH` | Match the server and addon versions. Do not force-overwrite as the first remedy. |
| `ADDON_UNREADABLE` / `ADDON_FILES_MISSING` | Inspect permissions/links and reinstall only after preserving existing work. |
| `ADDON_METADATA_UNREADABLE` / `ADDON_ENTRY_UNVERIFIED` | Inspect ambiguous/custom addon metadata; no custom script is executed. |
| `ADDON_NOT_ENABLED` | Enable MCP Loop under Project Settings > Plugins. |
| `PROJECT_CONFIG_UNSUPPORTED` | Inspect/normalize ambiguous or unsupported settings in a trusted editor. |
| `NODE_UNSUPPORTED` | Use Node.js 20 or newer. |
| `GODOT_NOT_FOUND` | Select a trusted installed Godot executable with `GODOT_BIN`. |
| `GODOT_VERSION_UNVERIFIED` | Use the exercised stable release or qualify the other version separately. |
| `ARTWORK_NOT_REQUESTED` | No action unless using the optional PNG workflow. |
| `PYTHON_UNSUPPORTED` / `PILLOW_VERSION_MISMATCH` / `ARTWORK_PROBE_FAILED` | Prepare a trusted Python 3.11+/Pillow 13.0.0 environment and select it with `GODOT_LOOP_PYTHON`. |

## Safety and limits

Doctor does not launch/quit an editor, import resources, connect to the bridge, compile/load project scripts,
read session tokens/client credentials, modify the project, generate images or call an image service.
It does execute the selected trusted Godot version command and, when requested, trusted Python/Pillow.
Installed binaries and Python startup/site packages are trusted, not sandboxed. The probe environment is a small
allowlist, but this is not an OS sandbox or a whole-process-tree containment guarantee.

Reads are bounded (project marker: 1 MiB, addon metadata: 64 KiB); symbolic links below the selected root and
multiple-hard-linked leaf files are refused. An explicitly selected root directory may itself be an alias.
The static lexer does not evaluate Object/Resource variants; unsupported or ambiguous forms remain unverified.
Syntax whitespace is restricted to ASCII space/tab/CR/LF. NBSP, fullwidth spaces and similar characters outside
quoted strings/comments are not normalized into valid keys/values: they produce `not_checked`. Unicode contents
inside quoted values/comments remain literal. One leading project BOM is supported as in ProjectSettings;
a leading BOM in ConfigFile addon metadata remains unverified rather than falsely reporting a version match.
Limits: 64 nesting levels, 4096 statements, 1024 enabled plugin entries. Godot probing has at most four attempts
within a five-second direct-process budget; the optional Python probe has a five-second direct-process timeout.
This is not a guarantee against hostile same-user filesystem races, compromised executables or their descendants.

A static pass does not establish full addon integrity, resource-import success, editor connection, gameplay,
image-processing output quality, provider credentials, billing or licensing. Check actual connection separately
with `godot_status` when you choose to start the editor/client. Platform execution evidence is recorded in the release audit and CI; it is not a universal platform-safety claim.

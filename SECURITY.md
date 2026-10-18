# Security policy

## Supported versions

Security fixes go into the latest release line (currently 0.4.x).

## Reporting a vulnerability

Please report vulnerabilities **privately** through GitHub: *Security* tab → *Report a vulnerability*. Do not open a
public issue. Include the version, your OS and Godot version, and steps to reproduce. You should get an
acknowledgement within a few days.

## Scope

[docs/security.md](docs/security.md) describes the threat model. An agent that can write scripts and run the game can
run code on your machine — that is the purpose of the tool, not a vulnerability. Reports are most useful when they
show a way around a documented protection: the localhost binding and token authentication of the editor bridge, the
`res://` path sandbox (including `.godot/` and symbolic links), the scene sandbox, or the limits on input, waits and
buffers.

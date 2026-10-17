#!/usr/bin/env bash
# Run the dependency-free GDScript unit tests headlessly.
# Usage: scripts/test-godot-unit.sh [--filter=<substring>]
set -euo pipefail
cd "$(dirname "$0")/.."
GODOT_BIN="${GODOT_BIN:-godot}"

# Make sure the project has been imported once (creates .godot/ caches).
if [ ! -d .godot ]; then
  "$GODOT_BIN" --headless --path . --import >/dev/null 2>&1 || true
fi

exec "$GODOT_BIN" --headless --path . --script res://tests/godot/run_tests.gd -- "$@"

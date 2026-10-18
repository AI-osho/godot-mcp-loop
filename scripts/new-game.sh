#!/usr/bin/env bash
# Create a new Godot 4 game project wired for godot-mcp-loop:
#   - the MCP Loop addon (enabled) and its runtime autoload
#   - the agent skill in .claude/skills/godot-mcp-loop and short AGENTS.md / CLAUDE.md files
#   - .gitignore, an empty scenarios/ folder, an initial git commit
#   - optionally the godot-loop MCP server registered with Claude Code for that folder
#
# Usage: scripts/new-game.sh <dir> [--name "Title"] [--register-claude] [--claude-config DIR]... [--no-git] [--no-import]
set -euo pipefail

usage() {
  sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-1}"
}

REPO="$(cd "$(dirname "$0")/.." && pwd)"
TARGET=""
NAME=""
REGISTER=0
CONFIG_DIRS=()
DO_GIT=1
DO_IMPORT=1

while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="${2:?--name needs a value}"; shift 2 ;;
    --register-claude) REGISTER=1; shift ;;
    --claude-config) CONFIG_DIRS+=("${2:?--claude-config needs a directory}"); REGISTER=1; shift 2 ;;
    --no-git) DO_GIT=0; shift ;;
    --no-import) DO_IMPORT=0; shift ;;
    -h|--help) usage 0 ;;
    -*) echo "Unknown option: $1" >&2; usage ;;
    *) [ -z "$TARGET" ] || { echo "Only one target directory." >&2; usage; }; TARGET="$1"; shift ;;
  esac
done
[ -n "$TARGET" ] || usage

if [ -e "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ]; then
  echo "Refusing to write into a non-empty directory: $TARGET" >&2
  exit 1
fi
mkdir -p "$TARGET"
TARGET="$(cd "$TARGET" && pwd)"
[ -n "$NAME" ] || NAME="$(basename "$TARGET")"
case "$NAME" in *'"'*|*'\'*) echo "The name must not contain quotes or backslashes." >&2; exit 1 ;; esac

SERVER="$REPO/server/dist/index.js"
if [ ! -f "$SERVER" ]; then
  echo "Build the MCP server first: (cd \"$REPO/server\" && npm ci && npm run build)" >&2
  exit 1
fi

# Copy only tracked files when this is a git checkout (no editor caches or .DS_Store).
copy_tree() {
  local rel="$1"
  if git -C "$REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1 &&
    [ -n "$(cd "$REPO" && git ls-files -- "$rel" | head -n 1)" ]; then
    (cd "$REPO" && git ls-files -z -- "$rel" | xargs -0 tar cf -) | (cd "$TARGET" && tar xf -)
  else
    mkdir -p "$TARGET/$(dirname "$rel")"
    cp -R "$REPO/$rel" "$TARGET/$rel"
  fi
}
copy_tree addons/mcp_loop
copy_tree .claude/skills/godot-mcp-loop

FEATURES=""
if command -v godot >/dev/null 2>&1; then
  VER="$(godot --version 2>/dev/null | grep -oE '^[0-9]+\.[0-9]+' || true)"
  [ -z "$VER" ] || FEATURES="config/features=PackedStringArray(\"$VER\")"
fi

cat > "$TARGET/project.godot" <<EOF
; Engine configuration file.
config_version=5

[application]

config/name="$NAME"
$FEATURES

[autoload]

MCPLoopRuntime="*res://addons/mcp_loop/runtime/runtime_agent.gd"

[editor_plugins]

enabled=PackedStringArray("res://addons/mcp_loop/plugin.cfg")
EOF

mkdir -p "$TARGET/scenarios"
cat > "$TARGET/scenarios/README.md" <<'EOF'
Regression scenarios for this game, numbered so a folder run keeps order (`1_title.yaml`, `2_movement.yaml`, ...).
Run them all with `scenario_run {path: "res://scenarios"}`.
EOF

cat > "$TARGET/.gitignore" <<'EOF'
.godot/
*.tmp
.DS_Store
EOF

cat > "$TARGET/AGENTS.md" <<EOF
# $NAME

A Godot 4 game developed with the godot-loop MCP tools (godot-mcp-loop).

- Follow the \`godot-mcp-loop\` skill in \`.claude/skills/godot-mcp-loop/\`: edit, run the game, observe, and judge
  every change with a scenario before calling it done.
- Game code and assets live in this project; scenarios live in \`scenarios/\` and must all pass
  (\`scenario_run {path: "res://scenarios"}\`) before a change is finished.
- Don't edit \`addons/mcp_loop/\`; update it by copying a newer release.
- Stage files by explicit path when committing; never commit \`.godot/\`.
EOF

cat > "$TARGET/CLAUDE.md" <<'EOF'
@AGENTS.md
EOF

if [ "$DO_IMPORT" = 1 ] && command -v godot >/dev/null 2>&1; then
  echo "Importing the project once (headless)..."
  godot --headless --path "$TARGET" --import >/dev/null 2>&1 || echo "  (import reported problems; the editor will import on first open)"
  rm -f "$TARGET/.godot/mcp_loop/session.json"
fi

if [ "$DO_GIT" = 1 ] && command -v git >/dev/null 2>&1; then
  git -C "$TARGET" init -q
  git -C "$TARGET" add .gitignore project.godot AGENTS.md CLAUDE.md scenarios/README.md addons/mcp_loop .claude/skills/godot-mcp-loop
  git -C "$TARGET" commit -q -m "New Godot project wired for godot-mcp-loop" && echo "Created git repository with an initial commit."
fi

REGISTER_CMD=(claude mcp add godot-loop -s local -- node "$SERVER" --project "$TARGET")
if [ "$REGISTER" = 1 ]; then
  command -v claude >/dev/null 2>&1 || { echo "claude not found on PATH; register manually (see below)." >&2; REGISTER=0; }
fi
if [ "$REGISTER" = 1 ]; then
  if [ ${#CONFIG_DIRS[@]} -eq 0 ]; then
    (cd "$TARGET" && "${REGISTER_CMD[@]}") && echo "Registered godot-loop with Claude Code for $TARGET."
  fi
  for dir in "${CONFIG_DIRS[@]+"${CONFIG_DIRS[@]}"}"; do
    (cd "$TARGET" && CLAUDE_CONFIG_DIR="$dir" "${REGISTER_CMD[@]}") && echo "Registered godot-loop with Claude Code ($dir) for $TARGET."
  done
fi

cat <<EOF

Done: $TARGET

Next:
  1. Open the project in Godot 4:  godot -e --path "$TARGET"
  2. Connect your MCP client (if not registered above), e.g. Claude Code:
       cd $(printf '%q' "$TARGET") && $(printf '%q ' "${REGISTER_CMD[@]}")
  3. Ask the agent to call godot_status, then describe the game you want.
EOF

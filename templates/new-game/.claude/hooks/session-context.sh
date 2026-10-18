#!/bin/sh
# Claude Code SessionStart hook (new session, resume, /clear and after context compaction).
# Prints the project's progress notes, the last commits and uncommitted changes; Claude Code adds this output to the
# agent's context, so work continues where it stopped. Output stays below Claude Code's 10,000 character limit.
# Read-only and always exits 0.
LIMIT=8000
dir="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)}"
cd "$dir" 2>/dev/null || exit 0

if [ -f PROGRESS.md ]; then
  echo "Contents of PROGRESS.md (this project's progress notes, kept up to date by the agent):"
  echo
  head -c "$LIMIT" PROGRESS.md
  echo
  size=$(wc -c < PROGRESS.md | tr -d ' ')
  if [ "$size" -gt "$LIMIT" ]; then
    echo "[PROGRESS.md is longer than $LIMIT characters ($size); only the start is shown. It should be shortened.]"
  fi
fi

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo
  echo "Recent commits:"
  git log --oneline -n 5 2>/dev/null
  changes=$(git status --porcelain 2>/dev/null | head -n 15)
  if [ -n "$changes" ]; then
    echo
    echo "Uncommitted changes:"
    echo "$changes"
  fi
fi
exit 0

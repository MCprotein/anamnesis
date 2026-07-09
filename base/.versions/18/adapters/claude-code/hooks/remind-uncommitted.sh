#!/bin/bash
# anamnesis PostToolUse hook — gentle reminder when working tree is dirty.
#
# Prints a single line to stderr after edits. Claude Code surfaces hook
# stderr output back to the agent so it sees the reminder.

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_ROOT"

# Only act inside a git repo.
git rev-parse --git-dir > /dev/null 2>&1 || exit 0

dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

# Threshold tuned to avoid noise on small WIPs but flag accumulation.
if [[ "$dirty" -gt 8 ]]; then
  echo "[anamnesis] $dirty uncommitted changes — consider committing logical units before continuing." >&2
fi

exit 0

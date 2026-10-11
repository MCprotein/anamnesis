#!/bin/bash
# anamnesis PostToolUse hook — note when the working tree has accumulated
# many uncommitted changes.
#
# Claude Code only shows a hook's stdout JSON `additionalContext` to the model
# (stderr from an exit-0 hook is never shown), so the Claude path emits JSON
# and notes each new block of 8 dirty paths once instead of after every edit.
# Codex runs this same script through its native wrapper and pre-commit
# bridge, which set CODEX_PROJECT_DIR and wrap plain stderr text themselves.

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_ROOT"

# Only act inside a git repo.
git_dir=$(git rev-parse --git-dir 2>/dev/null) || exit 0

dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

# Threshold tuned to avoid noise on small WIPs but flag accumulation.
THRESHOLD=8
message="[anamnesis] The working tree has $dirty uncommitted changes."

if [[ -n "${CODEX_PROJECT_DIR:-}" ]]; then
  if [[ "$dirty" -gt "$THRESHOLD" ]]; then
    echo "$message" >&2
  fi
  exit 0
fi

case "$git_dir" in
  /*) ;;
  *) git_dir="$PROJECT_ROOT/$git_dir" ;;
esac
state_file="$git_dir/anamnesis/uncommitted-reminder.last"
bucket=$(( dirty / THRESHOLD ))
last_bucket=$(cat "$state_file" 2>/dev/null || echo 0)
[[ "$last_bucket" =~ ^[0-9]+$ ]] || last_bucket=0

if [[ "$dirty" -le "$THRESHOLD" ]]; then
  # Reset after commits so the next accumulation is noted again.
  if [[ "$last_bucket" -ne 0 ]]; then
    mkdir -p "${state_file%/*}" 2>/dev/null && printf '0\n' > "$state_file" 2>/dev/null || true
  fi
  exit 0
fi

(( bucket > last_bucket )) || exit 0
mkdir -p "${state_file%/*}" 2>/dev/null && printf '%s\n' "$bucket" > "$state_file" 2>/dev/null || true

printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}\n' "$message"
exit 0

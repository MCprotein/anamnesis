#!/bin/bash
# anamnesis Stop hook — remind the agent to leave a handoff for real WIP.
#
# Claude Code runs Stop hooks when the agent is about to stop. This hook is
# intentionally read-only: it inspects git dirtiness and the newest handoff
# timestamp, then prints a reminder only when current work appears newer than
# the last handoff.

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
HANDOFF_DIR="$PROJECT_ROOT/.anamnesis/handoff"

[[ "${ANAMNESIS_HANDOFF_REMINDER:-1}" != "0" ]] || exit 0

cd "$PROJECT_ROOT"

# Only act inside a git repo.
git rev-parse --git-dir > /dev/null 2>&1 || exit 0

dirty_count=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
(( dirty_count > 0 )) || exit 0

latest_handoff_mtime=0
if [[ -d "$HANDOFF_DIR" ]]; then
  shopt -s nullglob
  handoff_files=("$HANDOFF_DIR"/*.md)
  shopt -u nullglob
  for f in "${handoff_files[@]}"; do
    if mtime=$(stat -f '%m' "$f" 2>/dev/null); then
      : # BSD stat (macOS)
    elif mtime=$(stat -c '%Y' "$f" 2>/dev/null); then
      : # GNU stat (Linux)
    else
      continue
    fi
    if (( mtime > latest_handoff_mtime )); then
      latest_handoff_mtime=$mtime
    fi
  done
fi

latest_dirty_mtime=0
while IFS= read -r file; do
  [[ -n "$file" ]] || continue
  [[ -e "$file" ]] || continue
  if mtime=$(stat -f '%m' "$file" 2>/dev/null); then
    : # BSD stat (macOS)
  elif mtime=$(stat -c '%Y' "$file" 2>/dev/null); then
    : # GNU stat (Linux)
  else
    continue
  fi
  if (( mtime > latest_dirty_mtime )); then
    latest_dirty_mtime=$mtime
  fi
done < <(git status --porcelain 2>/dev/null | sed 's/^...//')

if (( latest_dirty_mtime == 0 )); then
  latest_dirty_mtime=$(date +%s)
fi

if (( latest_handoff_mtime >= latest_dirty_mtime && latest_handoff_mtime > 0 )); then
  exit 0
fi

echo "[anamnesis] $dirty_count uncommitted change(s) are newer than the latest handoff." >&2
echo "[anamnesis] If you are stopping or switching agents, run /handoff-prepare so .anamnesis/handoff/active.md and an archive are current." >&2

exit 0

#!/bin/bash
# anamnesis SessionStart hook — inject active and recent agent handoff context.
#
# Looks for `.anamnesis/handoff/active.md` plus the most recent archived
# handoff, and prints them to stdout so Claude Code injects them into the
# session context. This bridges sessions across token-limit boundaries and
# across different agents (Claude → Codex, etc.).
#
# Silent (exit 0) when no handoff dir or no handoff files exist —
# brand-new projects don't need to spam an empty notice.

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
HANDOFF_DIR="$PROJECT_ROOT/.anamnesis/handoff"

[[ -d "$HANDOFF_DIR" ]] || exit 0

shopt -s nullglob
files=("$HANDOFF_DIR"/*.md)
shopt -u nullglob

(( ${#files[@]} > 0 )) || exit 0

# Prefer active.md when present. It is the multi-task index maintained by
# /handoff-prepare. Also include the newest timestamped archive for detail.
active="$HANDOFF_DIR/active.md"

# Find newest archived handoff by mtime — portable across BSD (macOS) and
# GNU stat. Exclude active.md because it is an index, not an archive.
latest=""
latest_mtime=0
for f in "${files[@]}"; do
  [[ "$(basename "$f")" != "active.md" ]] || continue
  if mtime=$(stat -f '%m' "$f" 2>/dev/null); then
    : # BSD stat (macOS)
  elif mtime=$(stat -c '%Y' "$f" 2>/dev/null); then
    : # GNU stat (Linux)
  else
    continue
  fi
  if (( mtime > latest_mtime )); then
    latest_mtime=$mtime
    latest="$f"
  fi
done

[[ -f "$active" || -n "$latest" ]] || exit 0

echo "=== anamnesis: handoff ==="
echo
echo "이전 세션이 남긴 작업 인계서. 무엇을 이어받는지 확인하고 작업 재개."
echo "더 이상 유효하지 않으면 무시하고 새 작업 시작."
echo

if [[ -f "$active" ]]; then
  rel_active="${active#$PROJECT_ROOT/}"
  echo "Source: $rel_active"
  echo
  cat "$active"
  echo
fi

if [[ -n "$latest" ]]; then
  rel="${latest#$PROJECT_ROOT/}"
  echo "--- most recent archived handoff: $rel ---"
  echo
  cat "$latest"
  echo
fi

echo "--- end of handoff ---"
exit 0

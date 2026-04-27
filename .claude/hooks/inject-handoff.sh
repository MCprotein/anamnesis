#!/bin/bash
# anamnesis SessionStart hook — inject the most recent agent handoff.
#
# Looks for `.anamnesis/handoff/*.md`, picks the file with the most recent
# mtime, and prints it to stdout so Claude Code injects it into the session
# context. This bridges sessions across token-limit boundaries and across
# different agents (Claude → Codex, etc.).
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

# Find newest handoff by mtime — portable across BSD (macOS) and GNU stat.
latest=""
latest_mtime=0
for f in "${files[@]}"; do
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

[[ -n "$latest" ]] || exit 0

rel="${latest#$PROJECT_ROOT/}"

echo "=== anamnesis: handoff (most recent) ==="
echo
echo "이전 세션이 남긴 작업 인계서. 무엇을 이어받는지 확인하고 작업 재개."
echo "더 이상 유효하지 않으면 무시하고 새 작업 시작."
echo
echo "Source: $rel"
echo
cat "$latest"
echo
echo "--- end of handoff ---"
exit 0

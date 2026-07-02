#!/bin/bash
# anamnesis SessionStart hook — inject active and recent agent handoff context.
#
# Looks for `.anamnesis/handoff/active.md` plus the most recent archived
# handoff, then emits a compact active-task summary plus source pointers.
# This bridges sessions across token-limit boundaries and across different
# agents (Claude → Codex, etc.) without injecting full archives by default.
#
# Set ANAMNESIS_SESSION_CONTEXT_MODE=full to emit full file bodies for
# compatibility/debugging.
#
# Silent (exit 0) when no handoff dir or no handoff files exist —
# brand-new projects don't need to spam an empty notice.

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
HANDOFF_DIR="$PROJECT_ROOT/.anamnesis/handoff"
SESSION_CONTEXT_MODE="${ANAMNESIS_SESSION_CONTEXT_MODE:-compact}"

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
echo "이전 세션이 남긴 작업 인계서. active.md 요약을 먼저 보고, 세부 내용은 원본 archive 를 직접 읽는다."
echo "git history 기준으로 stale 이면 무시하고 새 작업으로 진행한다."
echo

file_stats() {
  local file="$1"
  local bytes=""
  local lines=""

  bytes=$(wc -c < "$file" | tr -d ' ')
  lines=$(wc -l < "$file" | tr -d ' ')
  printf '%s bytes, %s lines' "$bytes" "$lines"
}

source_pointer() {
  local file="$1"
  local rel="${file#$PROJECT_ROOT/}"
  printf -- "- %s (%s)\n" "$rel" "$(file_stats "$file")"
}

active_summary() {
  local file="$1"
  awk '
    /^## Current focus$/ { section=1; next }
    /^## Active tasks$/ { section=1; next }
    /^## / { section=0; next }
    section == 1 && /^- / {
      print
      count++
      if (count >= 12) exit
    }
  ' "$file"
}

if [[ "$SESSION_CONTEXT_MODE" != "full" ]]; then
  echo "Mode: compact (set ANAMNESIS_SESSION_CONTEXT_MODE=full for full file injection)"
  echo
  echo "Source pointers:"
  if [[ -f "$active" ]]; then
    source_pointer "$active"
  fi
  if [[ -n "$latest" ]]; then
    source_pointer "$latest"
  fi
  if [[ -f "$active" ]]; then
    echo
    echo "Active task summary:"
    active_summary "$active"
  fi
  echo
  echo "Retrieval rule: read active.md and the referenced archive before continuing non-trivial in-flight work."
  echo "--- end of handoff ---"
  exit 0
fi

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

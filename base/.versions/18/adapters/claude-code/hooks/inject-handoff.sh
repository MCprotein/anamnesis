#!/bin/bash
# anamnesis SessionStart hook — inject active and recent agent handoff context.
#
# Looks for `.anamnesis/handoff/active.md` plus active-referenced warm
# archives, then emits a compact active-task summary plus source pointers.
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
# /handoff-prepare. Only Current focus / Active tasks archive references are
# considered startup-active; Recently completed archive pointers are history.
active="$HANDOFF_DIR/active.md"

agentfile_path() {
  local candidate=""
  for candidate in \
    "$PROJECT_ROOT/Agentfile" \
    "$PROJECT_ROOT/agentfile.yaml" \
    "$PROJECT_ROOT/agentfile.yml" \
    "$PROJECT_ROOT/.anamnesis/agentfile.yaml"; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

agentfile_integer_setting() {
  local key="$1"
  local file=""
  file="$(agentfile_path 2>/dev/null || true)"
  [[ -n "$file" ]] || return 0
  awk -F: -v key="$key" '
    $1 ~ "^[[:space:]]*" key "[[:space:]]*$" {
      value = $2
      sub(/[[:space:]]*#.*/, "", value)
      gsub(/[[:space:]]/, "", value)
      if (value ~ /^[0-9]+$/) {
        print value
        exit
      }
    }
  ' "$file"
}

nonnegative_or_default() {
  local value="$1"
  local fallback="$2"
  if [[ "$value" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$value"
  else
    printf '%s\n' "$fallback"
  fi
}

MAX_WARM_HANDOFF_ARCHIVES="$(
  nonnegative_or_default \
    "${ANAMNESIS_MAX_WARM_HANDOFF_ARCHIVES:-$(agentfile_integer_setting max_warm_handoff_archives)}" \
    "5"
)"

archive_is_inactive() {
  local file="$1"
  awk '
    BEGIN { in_fm = 0; inactive = 0 }
    NR == 1 && $0 == "---" { in_fm = 1; next }
    in_fm && $0 == "---" { in_fm = 0; next }
    in_fm {
      line = tolower($0)
      gsub(/["'\''"]/, "", line)
      if (line ~ /^handoff_status:[[:space:]]*(closed|deprecated|superseded)([[:space:]]|$)/) inactive = 1
      if (line ~ /^retention_tier:[[:space:]]*(cold|deprecated)([[:space:]]|$)/) inactive = 1
      if (line ~ /^superseded_by:[[:space:]]*[^[:space:]]+/) inactive = 1
    }
    END { exit inactive ? 0 : 1 }
  ' "$file"
}

active_archive_refs() {
  local file="$1"
  {
    awk '
      /^## Current focus$/ { section = 1; next }
      /^## Active tasks$/ { section = 1; next }
      /^## / { section = 0; next }
      section == 1 && /^- / { print }
    ' "$file" |
      grep -Eo '\.anamnesis/handoff/[^`[:space:])]+\.md' |
      grep -Ev '^\.anamnesis/handoff/(active|draft)\.md$|^\.anamnesis/handoff/drafts/' |
      sort -u
  } || true
}

archive_abs_from_ref() {
  local ref="$1"
  case "$ref" in
    .anamnesis/handoff/*.md) ;;
    *) return 1 ;;
  esac
  [[ "$ref" != *".."* ]] || return 1
  [[ "$ref" != .anamnesis/handoff/drafts/* ]] || return 1
  printf '%s/%s\n' "$PROJECT_ROOT" "$ref"
}

eligible_archives() {
  local f=""
  local name=""
  local mtime=""

  for f in "${files[@]}"; do
    name="$(basename "$f")"
    [[ "$name" != "active.md" && "$name" != "draft.md" ]] || continue
    archive_is_inactive "$f" && continue
    if mtime=$(stat -f '%m' "$f" 2>/dev/null); then
      : # BSD stat (macOS)
    elif mtime=$(stat -c '%Y' "$f" 2>/dev/null); then
      : # GNU stat (Linux)
    else
      continue
    fi
    printf '%s\t%s\n' "$mtime" "$f"
  done | sort -rn | awk -F '\t' '{ print $2 }'
}

selected_archives=()
if [[ -f "$active" ]]; then
  while IFS= read -r ref; do
    archive_abs="$(archive_abs_from_ref "$ref" || true)"
    [[ -n "${archive_abs:-}" && -f "$archive_abs" ]] || continue
    archive_is_inactive "$archive_abs" && continue
    selected_archives+=("$archive_abs")
  done < <(active_archive_refs "$active")
else
  if (( MAX_WARM_HANDOFF_ARCHIVES > 0 )); then
    selected_count=0
    while IFS= read -r archive; do
      [[ -n "$archive" ]] || continue
      selected_archives+=("$archive")
      selected_count=$((selected_count + 1))
      (( selected_count >= MAX_WARM_HANDOFF_ARCHIVES )) && break
    done < <(eligible_archives)
  fi
fi

[[ -f "$active" || ${#selected_archives[@]} -gt 0 ]] || exit 0

file_stats() {
  local file="$1"
  local bytes=""
  local lines=""

  bytes=$(wc -c < "$file" | tr -d ' ')
  lines=$(wc -l < "$file" | tr -d ' ')
  printf '%s bytes, %s lines' "$bytes" "$lines"
}

echo "=== anamnesis: handoff ==="
echo
echo "이전 세션이 남긴 작업 인계서. active.md 요약을 먼저 보고, 세부 내용은 active archive pointer 를 직접 읽는다."
echo "cold/deprecated archive 는 SessionStart 에 주입하지 않는다. git history 기준으로 stale 이면 무시하고 새 작업으로 진행한다."
echo

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
  if (( ${#selected_archives[@]} > 0 )); then
    for archive in "${selected_archives[@]}"; do
      source_pointer "$archive"
    done
  fi
  if [[ -f "$active" ]]; then
    echo
    echo "Active task summary:"
    active_summary "$active"
  fi
  echo
  if [[ -f "$active" && ${#selected_archives[@]} -gt 0 ]]; then
    echo "Retrieval rule: read active.md and the referenced warm archive before continuing non-trivial in-flight work."
  elif [[ -f "$active" ]]; then
    echo "Retrieval rule: read active.md before continuing non-trivial in-flight work; no warm archive is startup-active."
  else
    echo "Retrieval rule: read the referenced warm archive before continuing non-trivial in-flight work."
  fi
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

if (( ${#selected_archives[@]} > 0 )); then
  for archive in "${selected_archives[@]}"; do
    rel="${archive#$PROJECT_ROOT/}"
    if [[ -f "$active" ]]; then
      echo "--- active referenced archived handoff: $rel ---"
    else
      echo "--- warm archived handoff: $rel ---"
    fi
    echo
    cat "$archive"
    echo
  done
fi

echo "--- end of handoff ---"
exit 0

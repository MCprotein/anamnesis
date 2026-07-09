#!/bin/bash
# anamnesis SessionStart hook — inject ontology context for the agent.
#
# Compactly points to two sources, in order:
#   1. system_graph.yaml — user-managed top-level ontology, if present.
#   2. **/.anamnesis/ontology/*.yaml — anamnesis-managed slices, walked
#      recursively to support monorepo multi-scope layouts (root + sub-scopes).
#
# Set ANAMNESIS_SESSION_CONTEXT_MODE=full to emit full file bodies for
# compatibility/debugging.
#
# Output goes to stdout; Claude Code captures SessionStart hook stdout and
# injects it into the conversation context.

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
USER_ONTOLOGY="$PROJECT_ROOT/system_graph.yaml"
SESSION_CONTEXT_MODE="${ANAMNESIS_SESSION_CONTEXT_MODE:-compact}"

# Walk all .anamnesis/ontology/*.yaml at any depth (multi-scope monorepo
# support), skipping common heavy directories.
ontology_files=()
while IFS= read -r f; do
  ontology_files+=("$f")
done < <(
  find "$PROJECT_ROOT" \
    \( -path '*/node_modules' -o -path '*/.git' -o -path '*/dist' \
       -o -path '*/build' -o -path '*/.next' -o -path '*/.venv' \
       -o -path '*/venv' -o -path '*/__pycache__' \) -prune -o \
    -path '*/.anamnesis/ontology/*.yaml' -type f -print 2>/dev/null
)

if [[ -f "$USER_ONTOLOGY" || ${#ontology_files[@]} -gt 0 ]]; then
  echo "=== anamnesis: ontology context ==="
  echo
  echo "프로젝트의 불변 관계(네임스페이스, 식별자, 경로 등)를 담는 온톨로지."
  echo "매니페스트나 로그를 뒤지기 전에 필요한 원본 파일을 직접 읽는다."
  echo
fi

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
  local label="${2:-}"
  local rel="${file#$PROJECT_ROOT/}"

  if [[ -n "$label" ]]; then
    printf -- "- %s (%s; %s)\n" "$rel" "$label" "$(file_stats "$file")"
  else
    printf -- "- %s (%s)\n" "$rel" "$(file_stats "$file")"
  fi
}

digest_count=0
emit_invariant_digest() {
  local file="$1"
  local rel="${file#$PROJECT_ROOT/}"
  local line=""

  while IFS= read -r line; do
    (( digest_count < 12 )) || return 0
    printf -- "- %s: %s\n" "$rel" "$line"
    digest_count=$((digest_count + 1))
  done < <(
    awk '
      BEGIN { IGNORECASE = 1 }
      /(must|never|always|invariant|rule|severity:[[:space:]]*"?must|필수|금지|항상|절대)/ {
        sub(/^[[:space:]]+/, "")
        print
      }
    ' "$file"
  )
}

if [[ "$SESSION_CONTEXT_MODE" != "full" ]]; then
  if [[ -f "$USER_ONTOLOGY" || ${#ontology_files[@]} -gt 0 ]]; then
    echo "Mode: compact (set ANAMNESIS_SESSION_CONTEXT_MODE=full for full file injection)"
    echo
    echo "Source pointers:"
    if [[ -f "$USER_ONTOLOGY" ]]; then
      source_pointer "$USER_ONTOLOGY" "user-managed top-level ontology"
    fi
    if (( ${#ontology_files[@]} > 0 )); then
      for f in "${ontology_files[@]}"; do
        source_pointer "$f" "managed ontology slice"
      done
    fi
    echo
    echo "Invariant digest:"
    if [[ -f "$USER_ONTOLOGY" ]]; then
      emit_invariant_digest "$USER_ONTOLOGY"
    fi
    if (( ${#ontology_files[@]} > 0 )); then
      for f in "${ontology_files[@]}"; do
        emit_invariant_digest "$f"
      done
    fi
    if (( digest_count == 0 )); then
      echo "- (none detected; use source pointers for exact project context)"
    fi
    echo
    echo "Retrieval rule: read the exact source file before relying on an invariant, relationship, entity, path, or operational rule."
  fi
  exit 0
fi

if [[ -f "$USER_ONTOLOGY" ]]; then
  echo "--- system_graph.yaml (user-managed) ---"
  cat "$USER_ONTOLOGY"
  echo
fi

if (( ${#ontology_files[@]} > 0 )); then
  for f in "${ontology_files[@]}"; do
    rel="${f#$PROJECT_ROOT/}"
    echo "--- $rel ---"
    cat "$f"
    echo
  done
fi

exit 0

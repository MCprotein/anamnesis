#!/bin/bash
# anamnesis SessionStart hook — inject ontology context for the agent.
#
# Concatenates two sources, in order:
#   1. system_graph.yaml — user-managed top-level ontology, if present.
#   2. **/.anamnesis/ontology/*.yaml — anamnesis-managed slices, walked
#      recursively to support monorepo multi-scope layouts (root + sub-scopes).
#
# Output goes to stdout; Claude Code captures SessionStart hook stdout and
# injects it into the conversation context.

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
USER_ONTOLOGY="$PROJECT_ROOT/system_graph.yaml"

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
  echo "매니페스트나 로그를 뒤지기 전에 이 정보를 먼저 참조한다."
  echo
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

#!/bin/bash
# anamnesis SessionStart hook — inject ontology context for the agent.
#
# Concatenates two sources, in order:
#   1. .anamnesis/ontology/*.yaml — anamnesis-managed slices (one per fragment)
#   2. system_graph.yaml — user-managed top-level ontology, if present
#
# Output goes to stdout; Claude Code captures SessionStart hook stdout and
# injects it into the conversation context.

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
ONTOLOGY_DIR="$PROJECT_ROOT/.anamnesis/ontology"
USER_ONTOLOGY="$PROJECT_ROOT/system_graph.yaml"

emitted=0

if [[ -d "$ONTOLOGY_DIR" ]]; then
  shopt -s nullglob
  files=("$ONTOLOGY_DIR"/*.yaml)
  shopt -u nullglob
  if (( ${#files[@]} > 0 )); then
    echo "=== anamnesis: ontology context ==="
    echo
    echo "프로젝트의 불변 관계(네임스페이스, 식별자, 경로 등)를 담는 온톨로지."
    echo "매니페스트나 로그를 뒤지기 전에 이 정보를 먼저 참조한다."
    echo
    for f in "${files[@]}"; do
      echo "--- $(basename "$f") ---"
      cat "$f"
      echo
    done
    emitted=1
  fi
fi

if [[ -f "$USER_ONTOLOGY" ]]; then
  if (( emitted == 0 )); then
    echo "=== anamnesis: ontology context ==="
    echo
  fi
  echo "--- system_graph.yaml (user-managed) ---"
  cat "$USER_ONTOLOGY"
  echo
fi

exit 0

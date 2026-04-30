#!/bin/bash
# anamnesis k8s fragment — YAML lint hook.
#
# Triggers on PostToolUse:Edit. Validates YAML syntax of edited *.yaml/*.yml
# files. Uses `yq` if available, falls back to `python3 -c yaml.safe_load`.
# Silent on success; single-line stderr message on failure (Claude Code
# surfaces stderr back to the agent).

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
TARGET="${CLAUDE_TOOL_FILE_PATH:-}"

# Only lint when the tool target was a YAML file.
case "$TARGET" in
  *.yaml|*.yml) ;;
  *) exit 0 ;;
esac

# Resolve to absolute path within project.
case "$TARGET" in
  /*) ABS="$TARGET" ;;
  *)  ABS="$PROJECT_ROOT/$TARGET" ;;
esac

[[ -f "$ABS" ]] || exit 0

# Try yq first (fast, native YAML parser).
if command -v yq > /dev/null 2>&1; then
  if ! yq eval '.' "$ABS" > /dev/null 2>&1; then
    echo "[anamnesis:k8s] YAML syntax error in $TARGET — run 'yq eval . <file>' to inspect." >&2
  fi
  exit 0
fi

# Fall back to python yaml.safe_load.
if command -v python3 > /dev/null 2>&1; then
  if ! python3 -c "import yaml,sys; yaml.safe_load(open('$ABS'))" 2>/dev/null; then
    echo "[anamnesis:k8s] YAML syntax error in $TARGET" >&2
  fi
fi

exit 0

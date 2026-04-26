#!/bin/bash
# anamnesis prisma fragment — schema validation hook.
#
# Triggers on PostToolUse:Edit. Only runs validation when the edited file is
# `prisma/schema.prisma` — keeps unrelated edits cheap.
#
# Output: nothing on success. On failure, single-line error to stderr so
# Claude Code surfaces it back to the agent.

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
SCHEMA="$PROJECT_ROOT/prisma/schema.prisma"

# Skip if no schema in this project (defensive — should not happen if the
# fragment is installed, but keeps the hook a no-op rather than an error).
[[ -f "$SCHEMA" ]] || exit 0

# Only validate when the tool target was the schema itself.
TARGET="${CLAUDE_TOOL_FILE_PATH:-}"
case "$TARGET" in
  *prisma/schema.prisma) ;;
  "") ;;  # CC didn't expose target; fall through and validate anyway
  *) exit 0 ;;
esac

cd "$PROJECT_ROOT"

if ! command -v npx > /dev/null 2>&1; then
  exit 0
fi

# `--no-install` keeps the hook cheap when prisma isn't a local dep yet.
if ! npx --no-install prisma validate 2>/dev/null; then
  echo "[anamnesis:prisma] schema.prisma validation failed — run 'npx prisma format' or fix syntax." >&2
fi

exit 0

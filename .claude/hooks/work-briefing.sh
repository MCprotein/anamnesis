#!/usr/bin/env bash
# anamnesis Work UserPromptSubmit hook for Claude Code.
#
# The hook payload is never parsed or interpolated by this shell wrapper. The
# exact stdin byte stream is forwarded to the Work command after resolving a
# local anamnesis executable through a bounded search order.

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-${CODEX_PROJECT_DIR:-$(pwd)}}"
ANAMNESIS_EXECUTABLE=""

if [[ -n "${ANAMNESIS_BIN:-}" && -x "${ANAMNESIS_BIN}" ]]; then
  ANAMNESIS_EXECUTABLE="${ANAMNESIS_BIN}"
elif command -v anamnesis >/dev/null 2>&1; then
  ANAMNESIS_EXECUTABLE="$(command -v anamnesis)"
elif [[ -x "$PROJECT_ROOT/node_modules/.bin/anamnesis" ]]; then
  ANAMNESIS_EXECUTABLE="$PROJECT_ROOT/node_modules/.bin/anamnesis"
elif [[ -x "$PROJECT_ROOT/cli/dist/index.js" ]] &&
  grep -Eq '"name"[[:space:]]*:[[:space:]]*"@mcprotein/anamnesis"' "$PROJECT_ROOT/package.json" 2>/dev/null; then
  ANAMNESIS_EXECUTABLE="$PROJECT_ROOT/cli/dist/index.js"
fi

if [[ -z "$ANAMNESIS_EXECUTABLE" ]]; then
  printf '%s\n' '[anamnesis] Work prompt hook skipped: executable unavailable.' >&2
  exit 0
fi

HOOK_TMP_DIR="$(mktemp -d 2>/dev/null || true)"
if [[ -z "$HOOK_TMP_DIR" ]]; then
  printf '%s\n' '[anamnesis] Work prompt hook skipped: temporary output unavailable.' >&2
  exit 0
fi
trap 'rm -f -- "$HOOK_TMP_DIR/stdout" "$HOOK_TMP_DIR/stderr"; rmdir -- "$HOOK_TMP_DIR" 2>/dev/null || true' EXIT

if ! "$ANAMNESIS_EXECUTABLE" work hook-user-prompt --client claude-code \
  >"$HOOK_TMP_DIR/stdout" 2>"$HOOK_TMP_DIR/stderr"; then
  printf '%s\n' '[anamnesis] Work prompt hook skipped: command failed.' >&2
  exit 0
fi

cat "$HOOK_TMP_DIR/stdout" || true
exit 0

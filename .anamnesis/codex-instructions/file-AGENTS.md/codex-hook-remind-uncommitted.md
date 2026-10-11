### base hook: `remind-uncommitted.sh`

**When:** `PostToolUse:Edit` (Claude Code event; Codex uses native support where available, otherwise fallback instructions).

**Codex native path:** when executable adapter writes are allowed, anamnesis installs a JSON wrapper under `.anamnesis/codex-native-hooks/` and registers `PostToolUse:Edit|Write|apply_patch` in `.codex/hooks.json`. This region remains the manual fallback.

**Declared side effects:** `local-write`, `repo-external-write`.

**Intent:** the script below documents what should happen at this trigger point. Codex agents should manually invoke or replicate the behavior when the corresponding situation arises (e.g., after editing a file matching the event).

```bash
#!/bin/bash
# anamnesis PostToolUse hook — note when the working tree has accumulated
# many uncommitted changes.
#
# Claude Code only shows a hook's stdout JSON `additionalContext` to the model
# (stderr from an exit-0 hook is never shown), so the Claude path emits JSON
# and notes each new block of 8 dirty paths once instead of after every edit.
# Codex runs this same script through its native wrapper and pre-commit
# bridge, which set CODEX_PROJECT_DIR and wrap plain stderr text themselves.

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_ROOT"

# Only act inside a git repo.
git_dir=$(git rev-parse --git-dir 2>/dev/null) || exit 0

dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ') || dirty=0

# Threshold tuned to avoid noise on small WIPs but flag accumulation.
THRESHOLD=8
message="[anamnesis] The working tree has $dirty uncommitted changes."

if [[ -n "${CODEX_PROJECT_DIR:-}" ]]; then
  if [[ "$dirty" -gt "$THRESHOLD" ]]; then
    echo "$message" >&2
  fi
  exit 0
fi

case "$git_dir" in
  /*) ;;
  *) git_dir="$PROJECT_ROOT/$git_dir" ;;
esac
state_file="$git_dir/anamnesis/uncommitted-reminder.last"
bucket=0
if [[ "$dirty" -gt "$THRESHOLD" ]]; then
  bucket=$(( dirty / THRESHOLD ))
fi
last_bucket=$(cat "$state_file" 2>/dev/null || echo 0)
[[ "$last_bucket" =~ ^[0-9]+$ ]] || last_bucket=0

write_bucket() {
  { mkdir -p "${state_file%/*}" && printf '%s\n' "$1" > "$state_file"; } 2>/dev/null || true
}

# Record a lower block after commits so the next accumulation is noted again.
if (( bucket < last_bucket )); then
  write_bucket "$bucket"
fi
(( bucket > last_bucket )) || exit 0
write_bucket "$bucket"

printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}\n' "$message"
exit 0
```
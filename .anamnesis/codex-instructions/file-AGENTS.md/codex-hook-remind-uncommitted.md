### base hook: `remind-uncommitted.sh`

**When:** `PostToolUse:Edit` (Claude Code event; Codex uses native support where available, otherwise fallback instructions).

**Codex native path:** when executable adapter writes are allowed, anamnesis installs a JSON wrapper under `.anamnesis/codex-native-hooks/` and registers `PostToolUse:Edit|Write|apply_patch` in `.codex/hooks.json`. This region remains the manual fallback.

**Declared side effects:** `read-only`.

**Intent:** the script below documents what should happen at this trigger point. Codex agents should manually invoke or replicate the behavior when the corresponding situation arises (e.g., after editing a file matching the event).

```bash
#!/bin/bash
# anamnesis PostToolUse hook — gentle reminder when working tree is dirty.
#
# Prints a single line to stderr after edits. Claude Code surfaces hook
# stderr output back to the agent so it sees the reminder.

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_ROOT"

# Only act inside a git repo.
git rev-parse --git-dir > /dev/null 2>&1 || exit 0

dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

# Threshold tuned to avoid noise on small WIPs but flag accumulation.
if [[ "$dirty" -gt 8 ]]; then
  echo "[anamnesis] $dirty uncommitted changes — consider committing logical units before continuing." >&2
fi

exit 0
```
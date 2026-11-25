#!/bin/bash
# anamnesis Stop hook — remind the agent to leave a handoff for real WIP.
#
# Claude Code runs Stop hooks when the agent is about to stop. This hook is
# intentionally worktree-read-only: it inspects git dirtiness and the newest
# handoff timestamp, then prints a reminder only when current work appears
# newer than the last handoff. To avoid repeated Stop-hook noise, it stores the
# last emitted dirty-state fingerprint outside the tracked worktree.
#
# Claude Code never shows stderr from an exit-0 hook, so the Claude path emits
# a user-facing `systemMessage` (non-blocking: it does not force the agent to
# keep working). Codex runs this script through its native wrapper, which sets
# CODEX_PROJECT_DIR and wraps the plain stderr text itself.

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
HANDOFF_DIR="$PROJECT_ROOT/.anamnesis/handoff"

[[ "${ANAMNESIS_HANDOFF_REMINDER:-1}" != "0" ]] || exit 0

cd "$PROJECT_ROOT"

# Only act inside a git repo.
git_dir=$(git rev-parse --git-dir 2>/dev/null) || exit 0
case "$git_dir" in
  /*) ;;
  *) git_dir="$PROJECT_ROOT/$git_dir" ;;
esac

project_key=$(printf '%s\n' "$PROJECT_ROOT" | git hash-object --stdin 2>/dev/null || true)
if [[ -z "$project_key" ]]; then
  project_key=$(printf '%s\n' "$PROJECT_ROOT" | cksum | awk '{print $1 "-" $2}')
fi

state_file_candidates=(
  "$git_dir/anamnesis/handoff-reminder.last"
)
if [[ -n "${XDG_STATE_HOME:-}" ]]; then
  state_file_candidates+=("$XDG_STATE_HOME/anamnesis/handoff-reminder/$project_key.last")
fi
if [[ -n "${HOME:-}" ]]; then
  state_file_candidates+=("$HOME/.local/state/anamnesis/handoff-reminder/$project_key.last")
fi
state_file_candidates+=("${TMPDIR:-/tmp}/anamnesis/handoff-reminder/$project_key.last")

STATE_FILE=""

choose_state_file() {
  local candidate=""
  local dir=""

  if [[ -n "$STATE_FILE" ]]; then
    return 0
  fi

  for candidate in "${state_file_candidates[@]}"; do
    dir="${candidate%/*}"
    mkdir -p "$dir" 2>/dev/null || continue
    if [[ -f "$candidate" && -w "$candidate" ]]; then
      STATE_FILE="$candidate"
      return 0
    fi
    if [[ ! -e "$candidate" && -w "$dir" ]]; then
      STATE_FILE="$candidate"
      return 0
    fi
  done

  return 1
}

write_state() {
  local value="$1"
  choose_state_file || return 0
  printf '%s\n' "$value" > "$STATE_FILE" 2>/dev/null || true
}

read_state() {
  choose_state_file || return 0
  [[ -f "$STATE_FILE" ]] || return 0
  cat "$STATE_FILE" 2>/dev/null || true
}

# Print "size mtime path" for each NUL-separated path on stdin, using one stat
# process instead of one per file. Untracked trees can hold thousands of large
# files, so the reminder must not read file contents.
stat_paths() {
  if stat -f '%z' . >/dev/null 2>&1; then
    xargs -0 stat -f '%z %m %N' -- 2>/dev/null || true # BSD stat (macOS)
  else
    xargs -0 stat -c '%s %Y %n' -- 2>/dev/null || true # GNU stat (Linux)
  fi
}

stat_mtimes() {
  if stat -f '%m' . >/dev/null 2>&1; then
    xargs -0 stat -f '%m' -- 2>/dev/null || true # BSD stat (macOS)
  else
    xargs -0 stat -c '%Y' -- 2>/dev/null || true # GNU stat (Linux)
  fi
}

dirty_status=$(git status --porcelain=v1 --untracked-files=all 2>/dev/null || true)
dirty_count=$(printf '%s\n' "$dirty_status" | sed '/^$/d' | wc -l | tr -d ' ')
if (( dirty_count == 0 )); then
  write_state "clean:$(git rev-parse HEAD 2>/dev/null || true)"
  exit 0
fi
(( dirty_count > 0 )) || exit 0

latest_handoff_mtime=0
if [[ -d "$HANDOFF_DIR" ]]; then
  shopt -s nullglob
  handoff_files=("$HANDOFF_DIR"/*.md)
  shopt -u nullglob
  for f in ${handoff_files[@]+"${handoff_files[@]}"}; do
    if mtime=$(stat -f '%m' "$f" 2>/dev/null); then
      : # BSD stat (macOS)
    elif mtime=$(stat -c '%Y' "$f" 2>/dev/null); then
      : # GNU stat (Linux)
    else
      continue
    fi
    if (( mtime > latest_handoff_mtime )); then
      latest_handoff_mtime=$mtime
    fi
  done
fi

latest_dirty_mtime=$(
  {
    git diff --name-only -z --diff-filter=ACMRTUXB 2>/dev/null || true
    git diff --cached --name-only -z --diff-filter=ACMRTUXB 2>/dev/null || true
    git ls-files --others --exclude-standard -z 2>/dev/null || true
  } | sort -zu | stat_mtimes | awk '$1 ~ /^[0-9]+$/ && $1 + 0 > max + 0 { max = $1 } END { print max + 0 }'
) || true

if (( latest_dirty_mtime == 0 )); then
  latest_dirty_mtime=$(date +%s)
fi

if (( latest_handoff_mtime >= latest_dirty_mtime && latest_handoff_mtime > 0 )); then
  exit 0
fi

dirty_fingerprint=$(
  {
    printf 'head:%s\n' "$(git rev-parse HEAD 2>/dev/null || true)"
    printf 'status:\n%s\n' "$dirty_status"
    printf 'worktree-diff:\n'
    git diff --binary --no-ext-diff 2>/dev/null || true
    printf 'cached-diff:\n'
    git diff --cached --binary --no-ext-diff 2>/dev/null || true
    printf 'untracked:\n'
    git ls-files --others --exclude-standard -z 2>/dev/null | stat_paths
  } | git hash-object --stdin 2>/dev/null || true
)

if [[ -z "$dirty_fingerprint" ]]; then
  dirty_fingerprint="fallback:$dirty_count:$latest_dirty_mtime"
fi

if [[ "$(read_state)" == "$dirty_fingerprint" ]]; then
  exit 0
fi

write_state "$dirty_fingerprint"

line1="[anamnesis] $dirty_count uncommitted change(s) are newer than the latest handoff."
line2="[anamnesis] If you are stopping or switching agents, run /handoff-prepare so .anamnesis/handoff/active.md and an archive are current."

if [[ -n "${CODEX_PROJECT_DIR:-}" ]]; then
  echo "$line1" >&2
  echo "$line2" >&2
else
  printf '{"systemMessage":"%s\\n%s"}\n' "$line1" "$line2"
fi

exit 0

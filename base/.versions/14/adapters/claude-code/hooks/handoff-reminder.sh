#!/bin/bash
# anamnesis Stop hook — remind the agent to leave a handoff for real WIP.
#
# Claude Code runs Stop hooks when the agent is about to stop. This hook is
# intentionally worktree-read-only: it inspects git dirtiness and the newest
# handoff timestamp, then prints a reminder only when current work appears
# newer than the last handoff. To avoid repeated Stop-hook noise, it stores the
# last emitted dirty-state fingerprint outside the tracked worktree.

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

file_mtime() {
  local file="$1"
  if mtime=$(stat -f '%m' "$file" 2>/dev/null); then
    printf '%s\n' "$mtime"
  elif mtime=$(stat -c '%Y' "$file" 2>/dev/null); then
    printf '%s\n' "$mtime"
  fi
}

file_fingerprint() {
  local file="$1"
  local size=""
  local mtime=""
  local hash=""

  if size=$(stat -f '%z' "$file" 2>/dev/null); then
    : # BSD stat (macOS)
  elif size=$(stat -c '%s' "$file" 2>/dev/null); then
    : # GNU stat (Linux)
  else
    size="unknown"
  fi

  mtime=$(file_mtime "$file" || true)
  hash=$(git hash-object -- "$file" 2>/dev/null || true)
  printf '%s:%s:%s\n' "${size:-unknown}" "${mtime:-unknown}" "${hash:-unknown}"
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
  for f in "${handoff_files[@]}"; do
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

latest_dirty_mtime=0
while IFS= read -r file; do
  [[ -n "$file" ]] || continue
  [[ -e "$file" ]] || continue
  mtime=$(file_mtime "$file" || true)
  [[ -n "$mtime" ]] || continue
  if (( mtime > latest_dirty_mtime )); then
    latest_dirty_mtime=$mtime
  fi
done < <(
  {
    git diff --name-only --diff-filter=ACMRTUXB 2>/dev/null || true
    git diff --cached --name-only --diff-filter=ACMRTUXB 2>/dev/null || true
    git ls-files --others --exclude-standard 2>/dev/null || true
  } | sort -u
)

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
    while IFS= read -r file; do
      [[ -f "$file" ]] || continue
      printf '%s:%s\n' "$file" "$(file_fingerprint "$file")"
    done < <(git ls-files --others --exclude-standard 2>/dev/null || true)
  } | git hash-object --stdin 2>/dev/null || true
)

if [[ -z "$dirty_fingerprint" ]]; then
  dirty_fingerprint="fallback:$dirty_count:$latest_dirty_mtime"
fi

if [[ "$(read_state)" == "$dirty_fingerprint" ]]; then
  exit 0
fi

write_state "$dirty_fingerprint"

echo "[anamnesis] $dirty_count uncommitted change(s) are newer than the latest handoff." >&2
echo "[anamnesis] If you are stopping or switching agents, run /handoff-prepare so .anamnesis/handoff/active.md and an archive are current." >&2

exit 0

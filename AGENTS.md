# anamnesis (this repo)

This repository **is** anamnesis — the AI coding agent config lifecycle manager. It is also dogfooded on itself (see the auto-managed region below).

## Repo layout

- `cli/src/` — TypeScript CLI source (commands, core primitives, adapters)
- `cli/src/core/` — engine: `agentfile`, `manifest`, `regions`, `fragments`, `triggers`, `rulebook`, `applier`, `render`
- `cli/src/adapters/claude-code/` — five capability renderers (project_memory, ontology, executable_hook, skill, slash_command)
- `cli/src/commands/` — `init`, `update`, `promote`
- `base/` — always-installed fragment (5 capabilities)
- `fragments/` — stack-specific fragments (prisma, k8s, nestjs, fastapi, python-uv)
- `rulebook.md` — auto-detection rules → fragment suggestions
- `docs/DESIGN.md` — full architecture
- `specs/agentfile.md` — Agentfile v1 schema

## Working on this repo

- Run tests: `npm test` (vitest, ~1s, 229 tests)
- Type-check: `npm run typecheck`
- Local CLI: `npx tsx cli/src/index.ts <cmd>` (skips build)
- Build for distribution: `npm run build` → `cli/dist/`

## Conventions

- Tests are co-located (`*.test.ts` next to the implementation).
- New core changes need tests + a CHANGELOG entry.
- New fragments need a rulebook rule and (ideally) a sanitized-fixture dry-run.
- Korean or English commit messages both fine; commits stay focused.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for fragment authoring details.

## Status

v0.1 alpha — daily use across 4 repos. Pre-1.0 — Agentfile schema may break before v1.0.

---

<!-- anamnesis:region id=anamnesis-base fragment=base@15 -->
## anamnesis baseline

이 프로젝트는 [anamnesis](https://github.com/MCprotein/anamnesis) 로 관리됨.
세션마다 에이전트가 프로젝트 맥락을 처음부터 다시 배우지 않도록 컨텍스트·온톨로지·훅·스킬을 자동 동기화.

### 운영 원칙

- `<!-- anamnesis:region ... -->` 으로 감싸진 영역은 자동 갱신 대상. 직접 편집하지 말 것.
- 영역 밖은 자유. 사용자가 작성한 내용은 보존됨.
- 작업 시작 전 `.anamnesis/ontology/*.yaml` 와 `system_graph.yaml`(있을 경우) 의 온톨로지를 먼저 확인.
- 라이브러리 갱신 반영: `anamnesis update --dry-run` 으로 변경 검토 → 문제 없으면 `--apply`.
- `.claude/hooks`, `.claude/commands`, `.claude/skills`, `.codex/hooks.json`, `.anamnesis/codex-native-hooks` 같은 실행 가능 어댑터는 `--allow-exec-adapters` 플래그가 있어야만 갱신됨 (supply-chain 보호).

### 자주 쓰는 커맨드

- `/load-context` — 현재 프로젝트의 온톨로지를 한눈에 요약.
- `/handoff-prepare` — 작업 인계서 작성. 토큰 한도 임박 시 또는 다른 도구로 전환 전에 호출.
  결과는 `.anamnesis/handoff/<ts>.md` 아카이브와 `.anamnesis/handoff/active.md` 현재 작업 인덱스에 저장되고, 다음 세션 시작 시 active open task 요약과 warm archive source pointer 로 compact 자동 주입됨.
- `anamnesis-init` skill — 에이전트가 `anamnesis init` 을 대신 진행할 때 README/docs 처리 방식을 객관식으로 물어보고 CLI 플래그를 선택.
- `anamnesis status` — 설치된 fragment·드리프트 상태.
- `anamnesis update --dry-run` — 라이브러리 갱신 변경사항 미리보기.

### Session start: handoff 자동 확인 (도구 비종속)

세션 시작 시 (Claude Code · Codex · Cursor 어느 도구든) 다음 절차 따를 것:

1. `.anamnesis/handoff/` 디렉토리 존재 확인.
2. `.anamnesis/handoff/active.md` 가 있으면 먼저 읽고 현재 작업 인덱스로 사용.
3. `Current focus` / `Active tasks` 가 가리키는 archive 중 `closed`, `cold`, `deprecated`, `superseded` 가 아닌 warm archive 를 필요한 경우 추가로 읽기. `Recently completed` 포인터와 cold/deprecated archive 는 startup context 로 취급하지 않음.
4. frontmatter (created/updated / agent / git_ref) 와 본문 (Goal / Done / In flight / Decisions / Open questions / Next steps) 을 task context 로 받아들이고 작업 재개.
5. 핸드오프가 stale (`git log` 와 비교해 이미 진행됨) 이라면 사용자에게 확인 후 무시하고 새 작업으로 진행.

Claude Code 는 SessionStart 훅 (`inject-handoff.sh`) 으로 compact handoff 요약과 source pointer 가 자동 stdout 주입됨. 전문 주입은 `ANAMNESIS_SESSION_CONTEXT_MODE=full` 디버그 모드에서만 사용.
Codex 는 `--allow-exec-adapters` 로 `.codex/hooks.json` native SessionStart wrapper 가 설치된 경우 compact ontology/handoff 요약과 source pointer 가 자동 주입되고, 설치되지 않은 환경에서는 위 절차를 **agent 가 매 세션 시작 시 직접 수행**해야 함.
Cursor 는 native SessionStart hook 이 없으므로 위 절차를 **agent 가 매 세션 시작 시 직접 수행**해야 함.
Claude Code/Codex 는 Stop 훅 (`handoff-reminder.sh`) 으로 커밋되지 않은 변경이 최신 handoff 보다 새로울 때 `/handoff-prepare` 실행을 알림. 같은 git dirty fingerprint 에서는 중복 출력하지 않음.
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-cmd-load-context fragment=base@14 -->
### Command: `/load-context`

When the user invokes `/load-context` or asks for "load-context", follow the steps below. (CC users get this as a native slash command; Codex agents follow it from this region.)

**Declared side effects:** `read-only`.

Show the current project context — entities, relationships, invariants — by reading the ontology files anamnesis maintains.

Steps:

1. Read every `*.yaml` under any `.anamnesis/ontology/` directory in the project — including nested ones for monorepo sub-scopes (e.g. `apps/api/.anamnesis/ontology/`). Use `find . -path '*/.anamnesis/ontology/*.yaml' -type f` (or equivalent) to locate them.
2. If `system_graph.yaml` exists at the project root, read it (user-managed; takes precedence over slices).
3. Summarize concisely, grouping by scope when nested ontology dirs are present:
   - Main entities (services, hosts, identifiers, paths)
   - Relationships (who calls whom, who depends on what)
   - Stated invariants ("never do X", "always Y")
4. Stop. Don't make any edits or run other tools — this is orientation only.

If neither `.anamnesis/ontology/` nor `system_graph.yaml` exists, say so plainly and suggest running `anamnesis init`.
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-cmd-handoff-prepare fragment=base@14 -->
### Command: `/handoff-prepare`

When the user invokes `/handoff-prepare` or asks for "handoff-prepare", follow the steps below. (CC users get this as a native slash command; Codex agents follow it from this region.)

**Declared side effects:** `local-write`.

Capture the current task state in a structured handoff file. The next agent — could be a fresh Claude session, Codex, Cursor, or anything else reading AGENTS.md and `.anamnesis/handoff/` — will load it on session start and pick up where you left off.

## When to invoke

- Token usage approaching the limit and you might lose conversation memory
- About to switch tools (Claude → Codex, etc.) for cost or capability reasons
- Stopping work mid-task and resuming later
- User explicitly asks for a handoff

## Steps

1. **Determine current task context.** What was the user trying to accomplish overall? What's the immediate sub-step?

2. **Identify completed work.**
   - `git log --oneline -10` to see recent commits
   - Note which commits belong to this task vs unrelated chores

3. **Identify in-flight work.**
   - `git status` for uncommitted changes
   - For each modified/added file: what change, why

4. **Capture significant decisions made in this session.**
   - Choices the next agent needs to know (X over Y, rationale, constraints discovered)

5. **List open questions or blockers.**
   - Items waiting on user input, external systems, or earlier dependencies

6. **Write the archived handoff file** to `.anamnesis/handoff/<ISO-timestamp>.md` (filesystem-safe timestamp, colons replaced by `-`, e.g., `.anamnesis/handoff/2026-04-27T12-34-56Z.md`). Create the directory if missing.

   Use exactly this structure:

   ```markdown
   ---
   created: <ISO-8601 UTC timestamp>
   agent: <claude-code | codex | cursor | unknown>
   git_ref: <git rev-parse HEAD output>
   ---

   # Handoff — <one-line task summary>

   ## Goal
   <2–3 sentences on the overall objective>

   ## Done so far
   - <bullet> (commit <sha>)
   - <bullet> (uncommitted, in <file>)

   ## In flight
   - <file>: <intent — what change, why>
   - <decision being deliberated>: <options under consideration>

   ## Decisions
   - <decision>: <rationale>

   ## Open questions / blockers
   - <item>

   ## Next steps
   1. <action>
   2. <action>
   ```

7. **Update the active handoff index** at `.anamnesis/handoff/active.md`.
   This file is the compact multi-task map that gets injected first on
   session start. Read the existing file if present, preserve still-valid
   tasks, remove tasks that are clearly completed, and add/update the
   current task with a pointer to the archived handoff.

   Use this structure:

   ```markdown
   ---
   updated: <ISO-8601 UTC timestamp>
   agent: <claude-code | codex | cursor | unknown>
   git_ref: <git rev-parse HEAD output>
   ---

   # Active handoff index

   ## Current focus
   - <task summary> — archive: `.anamnesis/handoff/<ISO-timestamp>.md`

   ## Active tasks
   - [in-flight] <task summary> — next: <next action> — archive: `<relative path>`
   - [blocked] <task summary> — blocker: <blocker> — archive: `<relative path>`

   ## Recently completed
   - <task summary> — completed in <commit sha or note>
   ```

   Keep `active.md` concise. Put detailed reasoning in the archived file,
   not in the index.

8. **Confirm to the user**: print both relative paths written and a
   1-line summary of what they captured.

9. **Stop.** Do not continue the task. Handoff completion IS the goal of this command.

## Quality bar

- **Specific over generic** — "edit `cli/src/core/applier.ts:planRegion` to handle Y" beats "fix the applier".
- **Cite file paths and commit shas** — the next agent shouldn't have to grep to find context.
- **Mention rejected alternatives** — saves the next agent re-exploring dead ends.
- **Don't over-explain** — the next agent has the codebase. They need *intent*, not full re-derivation.

If the session is too short or trivial for a useful handoff (e.g., just a one-line fix already committed), say so plainly and skip writing — empty handoffs pollute future sessions.
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-skill-load-context fragment=base@14 -->
### Skill: `load-context`

When the user asks for "load-context" or the situation matches this procedure, follow the steps below. (CC users invoke this as a native skill; Codex agents read it from this region.)

**Declared side effects:** `read-only`.

# load-context

When invoked, do the following — and only the following.

## Steps

1. Locate every `.anamnesis/ontology/*.yaml` in the project — including nested directories under monorepo sub-scopes (e.g. `apps/api/.anamnesis/ontology/`). The recommended discovery pattern:
   ```bash
   find . -path '*/.anamnesis/ontology/*.yaml' -type f \
     -not -path '*/node_modules/*' -not -path '*/.git/*'
   ```
2. Read each found file. These are anamnesis-managed slices written by installed fragments.
3. If `system_graph.yaml` exists at the project root, read it. This is user-managed and represents the authoritative top-level ontology.
4. Summarize what you read, grouping by scope when nested ontology dirs are present:
   - **Entities**: namespaces, services, hosts, identifiers, paths
   - **Relationships**: dependencies, call paths, ownership
   - **Invariants & rules**: anything stated as "must" / "never" / "always"
5. Stop. Do not run other tools, edit files, or take action. The user invoked this skill to orient — not to do work.

## When the project has no ontology

If neither `.anamnesis/ontology/` nor `system_graph.yaml` exists:

- Say so plainly.
- Suggest `anamnesis init` to install the baseline.
- Do not invent ontology content from filesystem inspection — that's `init`'s job, not yours.

## Why this skill exists

Without it, every fresh session starts from zero project context. The agent re-derives the structure from filenames, package.json, etc. — slow, error-prone, and inconsistent across sessions. The ontology files are the single source of truth; this skill ensures the agent reads them first.
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-skill-ontology-enrich fragment=base@14 -->
### Skill: `ontology-enrich`

When the user asks for "ontology-enrich" or the situation matches this procedure, follow the steps below. (CC users invoke this as a native skill; Codex agents read it from this region.)

**Declared side effects:** `local-write`.

# ontology-enrich

`anamnesis ontology bootstrap` extracts factual structure (namespaces, services, models, routes) from project files via deterministic parsers. That is **Layer A**. It cannot infer intent — why this NodePort, what flow connects these services, which invariants must hold.

This skill is **Layer B**: agent-driven semantic enrichment. You read the bootstrap output plus surrounding context, then write the *meaning* into a sibling `enriched.yaml` file.

Layer B is re-runnable. Existing semantic entries are user-reviewed project memory, so every re-run must merge carefully instead of replacing the file wholesale.

## Steps

1. **Discover ontology files**:
   ```bash
   find . -path '*/.anamnesis/ontology/*.yaml' -type f \
     -not -path '*/node_modules/*' -not -path '*/.git/*'
   ```
   Read every `<id>.yaml` (static), every `<id>.bootstrap.yaml` (Layer A), and every `<id>.enriched.yaml` if it already exists.

2. **Read project entry points** to understand intent:
   - `CLAUDE.md` / `AGENTS.md` (project conventions, deployment rules)
   - `system_graph.yaml` if present (user-curated top-level ontology)
   - `README.md` for high-level service descriptions
   - Any `docs/architecture*.md` or similar

3. **Identify what parsers couldn't infer** for each fragment with a `<id>.bootstrap.yaml`:
   - **Relationships** — cross-namespace dependencies, service-to-service call paths, "X depends on Y" statements not visible in YAML
   - **Flows** — request paths (e.g., "client → traefik → service → pod"), data pipelines, deploy paths (e.g., "Runner → zot → kubelet certs.d → workload pod")
   - **Operational notes** — invariants ("skip_verify unsupported on containerd v2"), gotchas ("ClusterIP changes require microk8s restart"), why-this-design decisions
   - **Intent** — purpose of specific resources (e.g., "this NodePort exposes the Steam query endpoint", "this Ingress fronts the OCI registry")

4. **Write or update `<id>.enriched.yaml`** for each fragment, using schema version `anamnesis.enriched.v1` and these top-level keys:
   ```yaml
   schema_version: "anamnesis.enriched.v1"

   relationships:
     - id: "zot-service-ingress"
       from: { namespace: zot, kind: Service, name: zot }
       to:   { namespace: traefik, kind: Ingress, name: zot }
       reason: "external TLS termination + cert delivery via DNS-01"
       evidence:
         - "k8s.bootstrap.yaml: Service/zot and Ingress/zot"
       confidence: "high"

   flows:
     - id: "image-push"
       name: "image push"
       path: "developer → github actions runner → zot.zot.svc.cluster.local:5000"
       evidence:
         - "docs/architecture.md: image publishing"
       confidence: "medium"
     - id: "image-pull-kubelet"
       name: "image pull (kubelet)"
       path: "kubelet → registry.<host>:8443 → certs.d → ClusterIP redirect"

   operational_notes:
     - id: "containerd-v2-skip-verify"
       rule: "MicroK8s containerd v2 does not support `skip_verify`; setting it crashes the runtime"
       severity: "must"
       evidence:
         - "AGENTS.md: deployment invariant"

   open_questions:
     - id: "registry-retention-owner"
       question: "Which component owns registry retention policy?"
       evidence:
         - "No retention configuration found in bootstrap output"
   ```
   Use whichever subset of keys applies. Omit empty sections rather than emitting `relationships: []`. Prefer stable `id` fields for every entry so future re-runs can merge by identity.

   Stable conventions:
   - `schema_version` is required and must be `anamnesis.enriched.v1`.
   - `id` is required for every relationship, flow, operational note, and open question.
   - `confidence` should be `high`, `medium`, or `low` when present.
   - `severity` for operational notes should be `must`, `should`, or `note`.
   - `evidence` should cite concrete files, bootstrap facts, docs, or observed behavior.
   - `supersedes` points to the stable `id` of a replaced entry.

5. **Never modify `<id>.bootstrap.yaml`** — it's auto-regenerable; your edits would be lost on the next bootstrap. Always write to `<id>.enriched.yaml`.

6. **Apply the re-run merge policy**:
   - Preserve existing entries, ordering, wording, and IDs unless the underlying fact is clearly wrong or the user asked for cleanup.
   - If an existing entry still holds, leave it unchanged.
   - If you discover a new semantic fact, append a new entry with a stable `id`, `evidence`, and `confidence`.
   - If a previous entry is superseded by a new design, append the replacement with `supersedes: "<old-id>"` instead of deleting the old entry.
   - If a previous entry is wrong and keeping it would mislead future agents, make the smallest direct correction and explain it in the final diff summary.
   - If evidence is weak or the relationship is inferred, put it under `open_questions` rather than pretending it is a fact.
   - Do not reorder existing arrays just to make the file prettier. Append-only is the default.

7. **Show the diff** to the user. State what you added, what you preserved, what you superseded or corrected, and what remains uncertain. Stop. Let the user review and commit.

## Re-running this skill

If `<id>.enriched.yaml` already exists, treat it as the source of truth for semantic content the user has already approved. Merge by stable `id` where possible:

- **Same id, same meaning**: leave unchanged.
- **New id, new fact**: append.
- **Old id, changed design**: append a replacement with `supersedes`.
- **Old id, invalid fact**: make the smallest correction only when preserving the old text would harm the next agent.
- **Uncertain fact**: write an `open_questions` entry.

When in doubt, append rather than rewrite.

## When to invoke

- Right after `anamnesis init` and `anamnesis ontology bootstrap` on a new project
- After a significant architectural change (new service, namespace split, deploy path migration)
- When `/load-context` reveals the ontology summary feels thin or generic

## When NOT to invoke

- The bootstrap files don't exist yet — run `anamnesis ontology bootstrap` first
- The user is asking for a code change. This skill produces ontology, not code.
- The project has no agent-discernible intent beyond what the static fragments already say (e.g., a tiny single-service repo)
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-hook-inject-ontology fragment=base@14 -->
### base hook: `inject-ontology.sh`

**When:** `SessionStart` (Claude Code event; Codex uses native support where available, otherwise fallback instructions).

**Codex native path:** when executable adapter writes are allowed, anamnesis installs `.anamnesis/codex-native-hooks/session-start.mjs` and registers it in `.codex/hooks.json`. This region remains the manual fallback.

**Declared side effects:** `read-only`.

**Intent:** the script below documents what should happen at this trigger point. Codex agents should manually invoke or replicate the behavior when the corresponding situation arises (e.g., after editing a file matching the event).

```bash
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
```
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-hook-inject-handoff fragment=base@15 -->
### base hook: `inject-handoff.sh`

**When:** `SessionStart` (Claude Code event; Codex uses native support where available, otherwise fallback instructions).

**Codex native path:** when executable adapter writes are allowed, anamnesis installs `.anamnesis/codex-native-hooks/session-start.mjs` and registers it in `.codex/hooks.json`. This region remains the manual fallback.

**Declared side effects:** `read-only`.

**Intent:** the script below documents what should happen at this trigger point. Codex agents should manually invoke or replicate the behavior when the corresponding situation arises (e.g., after editing a file matching the event).

```bash
#!/bin/bash
# anamnesis SessionStart hook — inject active and recent agent handoff context.
#
# Looks for `.anamnesis/handoff/active.md` plus active-referenced warm
# archives, then emits a compact active-task summary plus source pointers.
# This bridges sessions across token-limit boundaries and across different
# agents (Claude → Codex, etc.) without injecting full archives by default.
#
# Set ANAMNESIS_SESSION_CONTEXT_MODE=full to emit full file bodies for
# compatibility/debugging.
#
# Silent (exit 0) when no handoff dir or no handoff files exist —
# brand-new projects don't need to spam an empty notice.

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
HANDOFF_DIR="$PROJECT_ROOT/.anamnesis/handoff"
SESSION_CONTEXT_MODE="${ANAMNESIS_SESSION_CONTEXT_MODE:-compact}"

[[ -d "$HANDOFF_DIR" ]] || exit 0

shopt -s nullglob
files=("$HANDOFF_DIR"/*.md)
shopt -u nullglob

(( ${#files[@]} > 0 )) || exit 0

# Prefer active.md when present. It is the multi-task index maintained by
# /handoff-prepare. Only Current focus / Active tasks archive references are
# considered startup-active; Recently completed archive pointers are history.
active="$HANDOFF_DIR/active.md"

archive_is_inactive() {
  local file="$1"
  awk '
    BEGIN { in_fm = 0; inactive = 0 }
    NR == 1 && $0 == "---" { in_fm = 1; next }
    in_fm && $0 == "---" { in_fm = 0; next }
    in_fm {
      line = tolower($0)
      gsub(/["'\''"]/, "", line)
      if (line ~ /^handoff_status:[[:space:]]*(closed|deprecated|superseded)([[:space:]]|$)/) inactive = 1
      if (line ~ /^retention_tier:[[:space:]]*(cold|deprecated)([[:space:]]|$)/) inactive = 1
      if (line ~ /^superseded_by:[[:space:]]*[^[:space:]]+/) inactive = 1
    }
    END { exit inactive ? 0 : 1 }
  ' "$file"
}

active_archive_refs() {
  local file="$1"
  {
    awk '
      /^## Current focus$/ { section = 1; next }
      /^## Active tasks$/ { section = 1; next }
      /^## / { section = 0; next }
      section == 1 && /^- / { print }
    ' "$file" |
      grep -Eo '\.anamnesis/handoff/[^`[:space:])]+\.md' |
      grep -Ev '^\.anamnesis/handoff/(active|draft)\.md$|^\.anamnesis/handoff/drafts/' |
      sort -u
  } || true
}

archive_abs_from_ref() {
  local ref="$1"
  case "$ref" in
    .anamnesis/handoff/*.md) ;;
    *) return 1 ;;
  esac
  [[ "$ref" != *".."* ]] || return 1
  [[ "$ref" != .anamnesis/handoff/drafts/* ]] || return 1
  printf '%s/%s\n' "$PROJECT_ROOT" "$ref"
}

newest_eligible_archive() {
  local newest=""
  local newest_mtime=0
  local f=""
  local name=""
  local mtime=""

  for f in "${files[@]}"; do
    name="$(basename "$f")"
    [[ "$name" != "active.md" && "$name" != "draft.md" ]] || continue
    archive_is_inactive "$f" && continue
    if mtime=$(stat -f '%m' "$f" 2>/dev/null); then
      : # BSD stat (macOS)
    elif mtime=$(stat -c '%Y' "$f" 2>/dev/null); then
      : # GNU stat (Linux)
    else
      continue
    fi
    if (( mtime > newest_mtime )); then
      newest_mtime=$mtime
      newest="$f"
    fi
  done
  printf '%s\n' "$newest"
}

selected_archives=()
if [[ -f "$active" ]]; then
  while IFS= read -r ref; do
    archive_abs="$(archive_abs_from_ref "$ref" || true)"
    [[ -n "${archive_abs:-}" && -f "$archive_abs" ]] || continue
    archive_is_inactive "$archive_abs" && continue
    selected_archives+=("$archive_abs")
  done < <(active_archive_refs "$active")
else
  latest="$(newest_eligible_archive)"
  if [[ -n "$latest" ]]; then
    selected_archives+=("$latest")
  fi
fi

[[ -f "$active" || ${#selected_archives[@]} -gt 0 ]] || exit 0

file_stats() {
  local file="$1"
  local bytes=""
  local lines=""

  bytes=$(wc -c < "$file" | tr -d ' ')
  lines=$(wc -l < "$file" | tr -d ' ')
  printf '%s bytes, %s lines' "$bytes" "$lines"
}

echo "=== anamnesis: handoff ==="
echo
echo "이전 세션이 남긴 작업 인계서. active.md 요약을 먼저 보고, 세부 내용은 active archive pointer 를 직접 읽는다."
echo "cold/deprecated archive 는 SessionStart 에 주입하지 않는다. git history 기준으로 stale 이면 무시하고 새 작업으로 진행한다."
echo

source_pointer() {
  local file="$1"
  local rel="${file#$PROJECT_ROOT/}"
  printf -- "- %s (%s)\n" "$rel" "$(file_stats "$file")"
}

active_summary() {
  local file="$1"
  awk '
    /^## Current focus$/ { section=1; next }
    /^## Active tasks$/ { section=1; next }
    /^## / { section=0; next }
    section == 1 && /^- / {
      print
      count++
      if (count >= 12) exit
    }
  ' "$file"
}

if [[ "$SESSION_CONTEXT_MODE" != "full" ]]; then
  echo "Mode: compact (set ANAMNESIS_SESSION_CONTEXT_MODE=full for full file injection)"
  echo
  echo "Source pointers:"
  if [[ -f "$active" ]]; then
    source_pointer "$active"
  fi
  if (( ${#selected_archives[@]} > 0 )); then
    for archive in "${selected_archives[@]}"; do
      source_pointer "$archive"
    done
  fi
  if [[ -f "$active" ]]; then
    echo
    echo "Active task summary:"
    active_summary "$active"
  fi
  echo
  if (( ${#selected_archives[@]} > 0 )); then
    echo "Retrieval rule: read active.md and the referenced warm archive before continuing non-trivial in-flight work."
  else
    echo "Retrieval rule: read active.md before continuing non-trivial in-flight work; no warm archive is startup-active."
  fi
  echo "--- end of handoff ---"
  exit 0
fi

if [[ -f "$active" ]]; then
  rel_active="${active#$PROJECT_ROOT/}"
  echo "Source: $rel_active"
  echo
  cat "$active"
  echo
fi

if (( ${#selected_archives[@]} > 0 )); then
  for archive in "${selected_archives[@]}"; do
    rel="${archive#$PROJECT_ROOT/}"
    echo "--- active referenced archived handoff: $rel ---"
    echo
    cat "$archive"
    echo
  done
fi

echo "--- end of handoff ---"
exit 0
```
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-hook-remind-uncommitted fragment=base@14 -->
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
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-hook-handoff-reminder fragment=base@14 -->
### base hook: `handoff-reminder.sh`

**When:** `Stop` (Claude Code event; Codex uses native support where available, otherwise fallback instructions).

**Codex native path:** when executable adapter writes are allowed, anamnesis installs a JSON wrapper under `.anamnesis/codex-native-hooks/` and registers `Stop` in `.codex/hooks.json`. This region remains the manual fallback.

**Declared side effects:** `local-write`, `repo-external-write`.

**Intent:** the script below documents what should happen at this trigger point. Codex agents should manually invoke or replicate the behavior when the corresponding situation arises (e.g., after editing a file matching the event).

```bash
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
```
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-skill-anamnesis-init fragment=base@14 -->
### Skill: `anamnesis-init`

When the user asks for "anamnesis-init" or the situation matches this procedure, follow the steps below. (CC users invoke this as a native skill; Codex agents read it from this region.)

**Declared side effects:** `local-write`.

# anamnesis-init

Use this skill when the user asks the agent to initialize a project with
anamnesis, install anamnesis surfaces, or "run init" on their behalf.

`anamnesis init` is a CLI command, not a skill. This skill is the agent-facing
adoption workflow that decides which CLI flags to use.

## Required Question

Before running `anamnesis init`, ask exactly one multiple-choice question unless
the user already gave an explicit docs preference such as "don't touch README",
"create docs", "enhance existing docs", `--scaffold-docs`, or `--enhance-docs`.

Question:

```text
README/docs 처리 방식을 선택해줘.
```

Choices:

```text
1. 문서 건드리지 않음 (Recommended) - AGENTS/CLAUDE/context/ontology만 설치하고 README/docs는 그대로 둠.
2. 누락 문서만 생성 - README.md와 docs/PROJECT-CONTEXT.md가 없을 때만 생성함. 기존 문서는 그대로 둠.
3. 기존 문서도 보완 - 기존 README/docs에 anamnesis 관리 region을 추가하거나 갱신하고, 누락 문서도 생성함.
```

If the agent runtime has a native multiple-choice question UI, use it. If not,
ask the same numbered question in plain text and wait for the user's answer.

## Map Answer To CLI Flags

- Choice 1: no docs flag.
- Choice 2: add `--scaffold-docs`.
- Choice 3: add `--enhance-docs`.

Do not use both docs flags. `--enhance-docs` already covers missing docs plus
existing-doc enhancement.

## Execution

1. Determine the target project root. Use the current working directory unless
   the user gave a path.
2. Run `anamnesis init --dry-run` first with the selected docs flag and any
   user-requested tool flags.
3. Review the dry-run output for blocked executable adapter writes, existing
   `Agentfile`, or unexpected user-owned document changes.
4. If the user already asked you to perform the install, run the apply command
   after dry-run succeeds:
   - Add `--allow-exec-adapters` when the user requested native hooks,
     commands, skills, Codex hooks, Cursor rules, or `--tools all`.
   - Preserve any user-supplied `--tools`, `--project-root`, `--library`,
     `--monorepo`, `--no-bootstrap`, or `--no-context-bootstrap` flags.
5. Report the docs choice, generated context files, and any follow-up agent
   work such as `/ontology-enrich`.

## Safety

- Never modify README/docs without either the user's explicit preference or the
  multiple-choice answer above.
- Never invent project facts. Starter docs and zero-context ontology drafts
  should contain open questions and review checklists until evidence exists.
- If `Agentfile` already exists, stop the init path and use
  `anamnesis update --dry-run` instead.
<!-- /anamnesis:region -->

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

<!-- anamnesis:region id=anamnesis-base fragment=base@11 -->
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
  결과는 `.anamnesis/handoff/<ts>.md` 아카이브와 `.anamnesis/handoff/active.md` 현재 작업 인덱스에 저장되고, 다음 세션 시작 시 자동 주입됨.
- `anamnesis-init` skill — 에이전트가 `anamnesis init` 을 대신 진행할 때 README/docs 처리 방식을 객관식으로 물어보고 CLI 플래그를 선택.
- `anamnesis status` — 설치된 fragment·드리프트 상태.
- `anamnesis update --dry-run` — 라이브러리 갱신 변경사항 미리보기.

### Session start: handoff 자동 확인 (도구 비종속)

세션 시작 시 (Claude Code · Codex · Cursor 어느 도구든) 다음 절차 따를 것:

1. `.anamnesis/handoff/` 디렉토리 존재 확인.
2. `.anamnesis/handoff/active.md` 가 있으면 먼저 읽고 현재 작업 인덱스로 사용.
3. active.md 가 가리키는 archive 또는 가장 최근 mtime 의 timestamp `*.md` 파일 1개를 추가로 읽기 (`active.md` 제외).
4. frontmatter (created/updated / agent / git_ref) 와 본문 (Goal / Done / In flight / Decisions / Open questions / Next steps) 을 task context 로 받아들이고 작업 재개.
5. 핸드오프가 stale (`git log` 와 비교해 이미 진행됨) 이라면 사용자에게 확인 후 무시하고 새 작업으로 진행.

Claude Code 는 SessionStart 훅 (`inject-handoff.sh`) 으로 자동 stdout 주입됨.
Codex 는 `--allow-exec-adapters` 로 `.codex/hooks.json` native SessionStart wrapper 가 설치된 경우 자동 주입되고, 설치되지 않은 환경에서는 위 절차를 **agent 가 매 세션 시작 시 직접 수행**해야 함.
Cursor 는 native SessionStart hook 이 없으므로 위 절차를 **agent 가 매 세션 시작 시 직접 수행**해야 함.
Claude Code 는 Stop 훅 (`handoff-reminder.sh`) 으로 커밋되지 않은 변경이 최신 handoff 보다 새로울 때 `/handoff-prepare` 실행을 알림.
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-cmd-load-context fragment=base@6 -->
### Command: `/load-context`

When the user invokes `/load-context` or asks for "load-context", follow the steps below. (CC users get this as a native slash command; Codex agents follow it from this region.)

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

<!-- anamnesis:region id=codex-cmd-handoff-prepare fragment=base@6 -->
### Command: `/handoff-prepare`

When the user invokes `/handoff-prepare` or asks for "handoff-prepare", follow the steps below. (CC users get this as a native slash command; Codex agents follow it from this region.)

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

<!-- anamnesis:region id=codex-skill-load-context fragment=base@6 -->
### Skill: `load-context`

When the user asks for "load-context" or the situation matches this procedure, follow the steps below. (CC users invoke this as a native skill; Codex agents read it from this region.)

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

<!-- anamnesis:region id=codex-skill-ontology-enrich fragment=base@8 -->
### Skill: `ontology-enrich`

When the user asks for "ontology-enrich" or the situation matches this procedure, follow the steps below. (CC users invoke this as a native skill; Codex agents read it from this region.)

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

<!-- anamnesis:region id=codex-hook-inject-ontology fragment=base@11 -->
### base hook: `inject-ontology.sh`

**When:** `SessionStart` (Claude Code event; Codex uses native support where available, otherwise fallback instructions).

**Codex native path:** when executable adapter writes are allowed, anamnesis installs `.anamnesis/codex-native-hooks/session-start.mjs` and registers it in `.codex/hooks.json`. This region remains the manual fallback.

**Intent:** the script below documents what should happen at this trigger point. Codex agents should manually invoke or replicate the behavior when the corresponding situation arises (e.g., after editing a file matching the event).

```bash
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
```
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-hook-inject-handoff fragment=base@9 -->
### base hook: `inject-handoff.sh`

**When:** `SessionStart` (Claude Code event; Codex uses native support where available, otherwise fallback instructions).

**Codex native path:** when executable adapter writes are allowed, anamnesis installs `.anamnesis/codex-native-hooks/session-start.mjs` and registers it in `.codex/hooks.json`. This region remains the manual fallback.

**Intent:** the script below documents what should happen at this trigger point. Codex agents should manually invoke or replicate the behavior when the corresponding situation arises (e.g., after editing a file matching the event).

```bash
#!/bin/bash
# anamnesis SessionStart hook — inject active and recent agent handoff context.
#
# Looks for `.anamnesis/handoff/active.md` plus the most recent archived
# handoff, and prints them to stdout so Claude Code injects them into the
# session context. This bridges sessions across token-limit boundaries and
# across different agents (Claude → Codex, etc.).
#
# Silent (exit 0) when no handoff dir or no handoff files exist —
# brand-new projects don't need to spam an empty notice.

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
HANDOFF_DIR="$PROJECT_ROOT/.anamnesis/handoff"

[[ -d "$HANDOFF_DIR" ]] || exit 0

shopt -s nullglob
files=("$HANDOFF_DIR"/*.md)
shopt -u nullglob

(( ${#files[@]} > 0 )) || exit 0

# Prefer active.md when present. It is the multi-task index maintained by
# /handoff-prepare. Also include the newest timestamped archive for detail.
active="$HANDOFF_DIR/active.md"

# Find newest archived handoff by mtime — portable across BSD (macOS) and
# GNU stat. Exclude active.md because it is an index, not an archive.
latest=""
latest_mtime=0
for f in "${files[@]}"; do
  [[ "$(basename "$f")" != "active.md" ]] || continue
  if mtime=$(stat -f '%m' "$f" 2>/dev/null); then
    : # BSD stat (macOS)
  elif mtime=$(stat -c '%Y' "$f" 2>/dev/null); then
    : # GNU stat (Linux)
  else
    continue
  fi
  if (( mtime > latest_mtime )); then
    latest_mtime=$mtime
    latest="$f"
  fi
done

[[ -f "$active" || -n "$latest" ]] || exit 0

echo "=== anamnesis: handoff ==="
echo
echo "이전 세션이 남긴 작업 인계서. 무엇을 이어받는지 확인하고 작업 재개."
echo "더 이상 유효하지 않으면 무시하고 새 작업 시작."
echo

if [[ -f "$active" ]]; then
  rel_active="${active#$PROJECT_ROOT/}"
  echo "Source: $rel_active"
  echo
  cat "$active"
  echo
fi

if [[ -n "$latest" ]]; then
  rel="${latest#$PROJECT_ROOT/}"
  echo "--- most recent archived handoff: $rel ---"
  echo
  cat "$latest"
  echo
fi

echo "--- end of handoff ---"
exit 0
```
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-hook-remind-uncommitted fragment=base@10 -->
### base hook: `remind-uncommitted.sh`

**When:** `PostToolUse:Edit` (Claude Code event; Codex uses native support where available, otherwise fallback instructions).

**Codex native path:** when executable adapter writes are allowed, anamnesis installs a JSON wrapper under `.anamnesis/codex-native-hooks/` and registers `PostToolUse:Edit|Write|apply_patch` in `.codex/hooks.json`. This region remains the manual fallback.

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

<!-- anamnesis:region id=codex-hook-handoff-reminder fragment=base@10 -->
### base hook: `handoff-reminder.sh`

**When:** `Stop` (Claude Code event; Codex uses native support where available, otherwise fallback instructions).

**Codex native path:** when executable adapter writes are allowed, anamnesis installs a JSON wrapper under `.anamnesis/codex-native-hooks/` and registers `Stop` in `.codex/hooks.json`. This region remains the manual fallback.

**Intent:** the script below documents what should happen at this trigger point. Codex agents should manually invoke or replicate the behavior when the corresponding situation arises (e.g., after editing a file matching the event).

```bash
#!/bin/bash
# anamnesis Stop hook — remind the agent to leave a handoff for real WIP.
#
# Claude Code runs Stop hooks when the agent is about to stop. This hook is
# intentionally read-only: it inspects git dirtiness and the newest handoff
# timestamp, then prints a reminder only when current work appears newer than
# the last handoff.

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
HANDOFF_DIR="$PROJECT_ROOT/.anamnesis/handoff"

[[ "${ANAMNESIS_HANDOFF_REMINDER:-1}" != "0" ]] || exit 0

cd "$PROJECT_ROOT"

# Only act inside a git repo.
git rev-parse --git-dir > /dev/null 2>&1 || exit 0

dirty_count=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
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
  if mtime=$(stat -f '%m' "$file" 2>/dev/null); then
    : # BSD stat (macOS)
  elif mtime=$(stat -c '%Y' "$file" 2>/dev/null); then
    : # GNU stat (Linux)
  else
    continue
  fi
  if (( mtime > latest_dirty_mtime )); then
    latest_dirty_mtime=$mtime
  fi
done < <(git status --porcelain 2>/dev/null | sed 's/^...//')

if (( latest_dirty_mtime == 0 )); then
  latest_dirty_mtime=$(date +%s)
fi

if (( latest_handoff_mtime >= latest_dirty_mtime && latest_handoff_mtime > 0 )); then
  exit 0
fi

echo "[anamnesis] $dirty_count uncommitted change(s) are newer than the latest handoff." >&2
echo "[anamnesis] If you are stopping or switching agents, run /handoff-prepare so .anamnesis/handoff/active.md and an archive are current." >&2

exit 0
```
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-skill-anamnesis-init fragment=base@11 -->
### Skill: `anamnesis-init`

When the user asks for "anamnesis-init" or the situation matches this procedure, follow the steps below. (CC users invoke this as a native skill; Codex agents read it from this region.)

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

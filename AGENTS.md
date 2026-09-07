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

- Run tests: `npm test` (vitest)
- Type-check: `npm run typecheck`
- Lint: `npm run lint` (Biome); auto-fix with `npm run lint:fix`
- Local CLI: `npx tsx cli/src/index.ts <cmd>` (skips build)
- Build for distribution: `npm run build` → `cli/dist/`

## Release operations

Agents must not rely on memory or manual release checklists for this repo.
Normal releases must use the repo release runner:

1. `npm run release:prepare -- --version X.Y.Z`
2. `npm run release:publish -- --version X.Y.Z --push --cleanup-branch`
3. `npm run release:verify -- --version X.Y.Z`

Do not hand-run `npm publish`, hand-create GitHub Releases, or hand-create /
push release tags during the normal path. The only exception is the documented
incident recovery path in `docs/RELEASING.md`.

## Conventions

- Tests are co-located (`*.test.ts` next to the implementation).
- New core changes need tests + a CHANGELOG entry.
- New fragments need a rulebook rule and (ideally) a sanitized-fixture dry-run.
- Korean or English commit messages both fine; commits stay focused.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for fragment authoring details.

## Status

Current release state is tracked in `package.json`, `CHANGELOG.md`, and
`docs/ROADMAP.md`. Verify public availability with `npm run release:status`
and `npm run release:verify -- --version <version>`.

---

<!-- anamnesis:region id=anamnesis-base fragment=base@27 -->
## anamnesis baseline

이 프로젝트는 [anamnesis](https://github.com/MCprotein/anamnesis) 로 관리됨.
세션마다 에이전트가 프로젝트 맥락을 처음부터 다시 배우지 않도록 컨텍스트·온톨로지·훅·스킬을 자동 동기화.

### 운영 원칙

- `<!-- anamnesis:region ... -->` 으로 감싸진 영역은 자동 갱신 대상. 직접 편집하지 말 것.
- 영역 밖은 자유. 사용자가 작성한 내용은 보존됨.
- 작업 시작 전 `.anamnesis/ontology/*.yaml` 와 `system_graph.yaml`(있을 경우) 의 온톨로지를 먼저 확인.
- 읽기 전용 작업에서 필요한 원문 경로가 현재 요청·startup pointer·이번 세션의 근거로 이미 명확하면 그 원문을 직접 읽을 것. 경로만 주어졌다고 근거가 충분한 것은 아님. 필요한 근거가 누락·불명확·오래됨·불충분하거나 파일을 수정하는 작업이면 `anamnesis context query "<검색어>"` 로 필요한 source pointer 를 찾고, 반환된 `source_path` / `stable_ref` 원문을 읽은 뒤 주장하거나 수정할 것. query snippet 과 compact digest 는 근거가 아니라 위치 힌트임.
- 필수 온톨로지·active handoff 확인은 유지함. 서로 독립적인 startup 확인과 이미 경로를 아는 원문 읽기는 가능한 경우 한 번의 도구 호출에 묶고, 확인된 제약을 적용한 뒤 답변하거나 수정할 것. 새로 발견한 pointer 는 확인 후 후속으로 읽으며, 파일 누락·읽기 실패를 숨기지 않음.
- 자동 startup 확인이나 작업 중 보조 checkpoint/orientation 은 현재 사용자가 요청한 작업의 일부로만 수행하고, 확인이 끝나면 원래 작업을 계속할 것. 이 절차와 과거 handoff 는 현재 요청의 권한이나 범위를 넓히지 않음.
- 사용자가 `/load-context` 또는 `/handoff-prepare` 자체만 명시적으로 요청한 경우에는 해당 결과를 제공한 뒤 멈춤.
- 라이브러리 갱신 반영: `anamnesis apply --dry-run` 으로 변경 검토 → 문제 없으면 `anamnesis apply`.
- `.claude/hooks`, `.claude/commands`, `.claude/skills`, `.codex/skills`, `.codex/hooks.json`, `.anamnesis/codex-native-hooks` 같은 실행 가능/에이전트 동작 어댑터는 `--allow-exec-adapters` 플래그가 있어야만 갱신됨 (supply-chain 보호).

### 자주 쓰는 커맨드

- `/load-context` — 현재 프로젝트의 온톨로지를 한눈에 요약.
- `/handoff-prepare` — 작업 인계서 작성. 토큰 한도 임박 시 또는 다른 도구로 전환 전에 호출.
  결과는 `.anamnesis/handoff/<ts>.md` 아카이브와 `.anamnesis/handoff/active.md` 현재 작업 인덱스에 저장되고, 다음 세션 시작 시 active open task 요약과 warm archive source pointer 로 compact 자동 주입됨.
- `anamnesis-init` skill — 에이전트가 `anamnesis init` 을 대신 진행할 때 README/docs 처리 방식을 객관식으로 물어보고 CLI 플래그를 선택.
- `doc-freshness-review` skill — `anamnesis context diagnose` 이후 CLI가 확정할 수 없는 README/CLAUDE/docs 의미적 stale claim 을 에이전트가 증거 기반으로 검토.
- `anamnesis context query "<terms>"` — startup context 를 늘리지 않고 필요한 문서/온톨로지/핸드오프 source pointer 를 찾기. 결과 원문을 읽은 뒤 사용.
- `anamnesis status` — 설치된 fragment·드리프트 상태.
- `anamnesis apply --dry-run` — 라이브러리 갱신 변경사항 미리보기.

### Session start: handoff 자동 확인 (도구 비종속)

세션 시작 시 (Claude Code · Codex · Cursor 어느 도구든) 다음 절차 따를 것:

1. `.anamnesis/handoff/` 디렉토리 존재 확인.
2. `.anamnesis/handoff/active.md` 가 있으면 먼저 읽고 현재 작업 인덱스로 사용.
3. `Current focus` / `Active tasks` 가 가리키는 archive 중 `closed`, `cold`, `deprecated`, `superseded` 가 아닌 warm archive 를 필요한 경우 추가로 읽기. `Recently completed` 포인터와 cold/deprecated archive 는 startup context 로 취급하지 않음.
4. frontmatter (created/updated / agent / git_ref) 와 본문 (Goal / Done / In flight / Decisions / Open questions / Next steps) 을 task context 로 받아들이고 작업 재개.
5. `git log` 의 완료 커밋이나 현재 파일 상태 같은 정확한 근거로 핸드오프 작업이 이미 완료됐음이 명확하면 stale handoff 를 별도 확인 없이 무시할 수 있음. 현재 요청과 같은 작업인지, 계속해야 하는지, 버려도 되는지 경계가 불명확하면 사용자에게 확인할 것.

Claude Code 는 SessionStart 훅 (`inject-handoff.sh`) 으로 compact handoff 요약과 source pointer 가 자동 stdout 주입됨. 전문 주입은 `ANAMNESIS_SESSION_CONTEXT_MODE=full` 디버그 모드에서만 사용.
Codex 는 `--allow-exec-adapters` 로 `.codex/hooks.json` native SessionStart wrapper 가 설치된 경우 compact ontology/handoff 요약과 source pointer 가 자동 주입되고, 설치되지 않은 환경에서는 위 절차를 **agent 가 매 세션 시작 시 직접 수행**해야 함.
Cursor 는 native SessionStart hook 이 없으므로 위 절차를 **agent 가 매 세션 시작 시 직접 수행**해야 함.
Claude Code/Codex 는 Stop 훅 (`handoff-reminder.sh`) 으로 커밋되지 않은 변경이 최신 handoff 보다 새로울 때 `/handoff-prepare` 실행을 알림. reminder 자체는 handoff 작성 요청이 아니므로 archive 나 `active.md` 를 자동 생성·수정하지 않음. 같은 git dirty fingerprint 에서는 중복 출력하지 않음.
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-cmd-load-context fragment=base@25 -->
### Command: `/load-context`

When the user invokes `/load-context` or asks for "load-context", follow the steps below. (CC users get this as a native slash command; Codex agents follow it from this region.)

**Declared side effects:** `read-only`.

Show the current project context — entities, relationships, invariants — by reading the ontology files anamnesis maintains.

Invocation contract:

- If the user explicitly requests `/load-context` as the standalone task, provide the orientation summary and stop.
- If this procedure is invoked as auxiliary startup or orientation work during an active task, finish the read-only orientation and then continue the original task. It does not broaden the user's request or authorize additional work.

Steps:

1. Read every `*.yaml` under any `.anamnesis/ontology/` directory in the project — including nested ones for monorepo sub-scopes (e.g. `apps/api/.anamnesis/ontology/`). Use `find . -path '*/.anamnesis/ontology/*.yaml' -type f` (or equivalent) to locate them.
2. If `system_graph.yaml` exists at the project root, read it (user-managed; takes precedence over slices).
3. If the user's orientation question depends on project docs, roadmap entries, prior decisions, or evidence not present in the ontology files, run `anamnesis context query "<terms>"` and read the returned `source_path` / `stable_ref` before summarizing. Treat query snippets as source pointers, not authority.
4. Summarize concisely, grouping by scope when nested ontology dirs are present:
   - Main entities (services, hosts, identifiers, paths)
   - Relationships (who calls whom, who depends on what)
   - Stated invariants ("never do X", "always Y")
5. Don't make any edits — this is orientation only. Then follow the invocation contract: stop for a standalone request, or resume the original active task after auxiliary orientation.

If neither `.anamnesis/ontology/` nor `system_graph.yaml` exists, say so plainly and suggest running `anamnesis init`.
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-cmd-handoff-prepare fragment=base@27 -->
### Command: `/handoff-prepare`

When the user invokes `/handoff-prepare` or asks for "handoff-prepare", follow the referenced procedure. (CC users get this as a native slash command; Codex agents follow it from this region.)
**Declared side effects:** `local-write`.

Full procedure and manual fallback (relative to project root): `.anamnesis/codex-instructions/file-AGENTS.md/codex-cmd-handoff-prepare.md`.
When the user invokes this command, read the full procedure and preserve its standalone or auxiliary continuation rules. Do not preload it for unrelated tasks.
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-skill-load-context fragment=base@27 -->
### Skill: `load-context`

When the user asks for "load-context" or the situation matches this procedure, follow the referenced procedure. Codex should load the native project skill from `.codex/skills/load-context/SKILL.md` when available; this region is the compatibility fallback.
**Declared side effects:** `read-only`.

Full procedure and manual fallback (relative to project root): `.anamnesis/codex-instructions/file-AGENTS.md/codex-skill-load-context.md`.
A routine startup check does not itself invoke this skill. Read its full procedure when the current task matches its purpose or relevant context is missing; preserve its invocation and continuation rules.
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-skill-ontology-enrich fragment=base@27 -->
### Skill: `ontology-enrich`

When the user asks for "ontology-enrich" or the situation matches this procedure, follow the referenced procedure. Codex should load the native project skill from `.codex/skills/ontology-enrich/SKILL.md` when available; this region is the compatibility fallback.
**Declared side effects:** `local-write`.

Full procedure and manual fallback (relative to project root): `.anamnesis/codex-instructions/file-AGENTS.md/codex-skill-ontology-enrich.md`.
A routine startup check does not itself invoke this skill. Read its full procedure when the current task matches its purpose or relevant context is missing; preserve its invocation and continuation rules.
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-hook-inject-ontology fragment=base@27 -->
### base hook: `inject-ontology.sh`

**When:** `SessionStart` (Claude Code event; Codex uses native support where available, otherwise fallback instructions).
**Codex native path:** when executable adapter writes are allowed, anamnesis installs `.anamnesis/codex-native-hooks/session-start.mjs` and registers it in `.codex/hooks.json`. This region remains the manual fallback.
**Declared side effects:** `read-only`.
**Intent:** the referenced procedure documents what should happen at this trigger point. Use the manual fallback only when the corresponding native execution is unavailable.

Full procedure and manual fallback (relative to project root): `.anamnesis/codex-instructions/file-AGENTS.md/codex-hook-inject-ontology.md`.
Read this manual only at its declared trigger when this specific handler lacks enabled native support, or when asked to inspect it. Enabled native handlers may succeed silently; absent output alone is not a fallback trigger. Another handler on the same event does not establish support for this one. Do not preload future-trigger manuals or replay enabled native handlers.
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-hook-inject-handoff fragment=base@27 -->
### base hook: `inject-handoff.sh`

**When:** `SessionStart` (Claude Code event; Codex uses native support where available, otherwise fallback instructions).
**Codex native path:** when executable adapter writes are allowed, anamnesis installs `.anamnesis/codex-native-hooks/session-start.mjs` and registers it in `.codex/hooks.json`. This region remains the manual fallback.
**Declared side effects:** `read-only`.
**Intent:** the referenced procedure documents what should happen at this trigger point. Use the manual fallback only when the corresponding native execution is unavailable.

Full procedure and manual fallback (relative to project root): `.anamnesis/codex-instructions/file-AGENTS.md/codex-hook-inject-handoff.md`.
Read this manual only at its declared trigger when this specific handler lacks enabled native support, or when asked to inspect it. Enabled native handlers may succeed silently; absent output alone is not a fallback trigger. Another handler on the same event does not establish support for this one. Do not preload future-trigger manuals or replay enabled native handlers.
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-hook-remind-uncommitted fragment=base@27 -->
### base hook: `remind-uncommitted.sh`

**When:** `PostToolUse:Edit` (Claude Code event; Codex uses native support where available, otherwise fallback instructions).
**Codex native path:** when executable adapter writes are allowed, anamnesis installs a JSON wrapper under `.anamnesis/codex-native-hooks/` and registers `PostToolUse:Edit|Write|apply_patch` in `.codex/hooks.json`. This region remains the manual fallback.
**Declared side effects:** `read-only`.
**Intent:** the referenced procedure documents what should happen at this trigger point. Use the manual fallback only when the corresponding native execution is unavailable.

Full procedure and manual fallback (relative to project root): `.anamnesis/codex-instructions/file-AGENTS.md/codex-hook-remind-uncommitted.md`.
Read this manual only at its declared trigger when this specific handler lacks enabled native support, or when asked to inspect it. Enabled native handlers may succeed silently; absent output alone is not a fallback trigger. Another handler on the same event does not establish support for this one. Do not preload future-trigger manuals or replay enabled native handlers.
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-hook-handoff-reminder fragment=base@27 -->
### base hook: `handoff-reminder.sh`

**When:** `Stop` (Claude Code event; Codex uses native support where available, otherwise fallback instructions).
**Codex native path:** when executable adapter writes are allowed, anamnesis installs a JSON wrapper under `.anamnesis/codex-native-hooks/` and registers `Stop` in `.codex/hooks.json`. This region remains the manual fallback.
**Declared side effects:** `local-write`, `repo-external-write`.
**Intent:** the referenced procedure documents what should happen at this trigger point. Use the manual fallback only when the corresponding native execution is unavailable.

Full procedure and manual fallback (relative to project root): `.anamnesis/codex-instructions/file-AGENTS.md/codex-hook-handoff-reminder.md`.
Read this manual only at its declared trigger when this specific handler lacks enabled native support, or when asked to inspect it. Enabled native handlers may succeed silently; absent output alone is not a fallback trigger. Another handler on the same event does not establish support for this one. Do not preload future-trigger manuals or replay enabled native handlers.
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-skill-anamnesis-init fragment=base@27 -->
### Skill: `anamnesis-init`

When the user asks for "anamnesis-init" or the situation matches this procedure, follow the referenced procedure. Codex should load the native project skill from `.codex/skills/anamnesis-init/SKILL.md` when available; this region is the compatibility fallback.
**Declared side effects:** `local-write`.

Full procedure and manual fallback (relative to project root): `.anamnesis/codex-instructions/file-AGENTS.md/codex-skill-anamnesis-init.md`.
A routine startup check does not itself invoke this skill. Read its full procedure when the current task matches its purpose or relevant context is missing; preserve its invocation and continuation rules.
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-skill-doc-freshness-review fragment=base@27 -->
### Skill: `doc-freshness-review`

When the user asks for "doc-freshness-review" or the situation matches this procedure, follow the referenced procedure. Codex should load the native project skill from `.codex/skills/doc-freshness-review/SKILL.md` when available; this region is the compatibility fallback.
**Declared side effects:** `read-only`.

Full procedure and manual fallback (relative to project root): `.anamnesis/codex-instructions/file-AGENTS.md/codex-skill-doc-freshness-review.md`.
A routine startup check does not itself invoke this skill. Read its full procedure when the current task matches its purpose or relevant context is missing; preserve its invocation and continuation rules.
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-hook-work-briefing fragment=base@27 -->
### base hook: `work-briefing.sh`

**When:** `UserPromptSubmit` (Claude Code event; Codex uses native support where available, otherwise fallback instructions).
**Codex native path:** when executable adapter writes are allowed, anamnesis installs a JSON wrapper under `.anamnesis/codex-native-hooks/` and registers `UserPromptSubmit` in `.codex/hooks.json`. This region remains the manual fallback.
**Declared side effects:** `local-write`.
**Intent:** native adapters invoke this only with the documented hook payload. When that transport is unavailable, do not synthesize session or turn IDs; use `anamnesis work brief` explicitly at a safe boundary instead.

Full procedure and manual fallback (relative to project root): `.anamnesis/codex-instructions/file-AGENTS.md/codex-hook-work-briefing.md`.
Read this manual only at its declared trigger when this specific handler lacks enabled native support, or when asked to inspect it. Enabled native handlers may succeed silently; absent output alone is not a fallback trigger. Another handler on the same event does not establish support for this one. Do not preload future-trigger manuals or replay enabled native handlers.
<!-- /anamnesis:region -->

<!-- anamnesis:region id=codex-hook-work-post-tool-use fragment=base@27 -->
### base hook: `work-post-tool-use.mjs`

**When:** `PostToolUse:^(Bash|apply_patch|Agent|spawn_agent|collaborationspawn_agent)$` (Claude Code event; Codex uses native support where available, otherwise fallback instructions).
**Codex native path:** when executable adapter writes are allowed, anamnesis installs a JSON wrapper under `.anamnesis/codex-native-hooks/` and registers `PostToolUse:^(Bash|apply_patch|Agent|spawn_agent|collaborationspawn_agent)$` in `.codex/hooks.json`. This region remains the manual fallback.
**Declared side effects:** `read-only`, `local-write`.
**Intent:** the referenced procedure documents what should happen at this trigger point. Use the manual fallback only when the corresponding native execution is unavailable.

Full procedure and manual fallback (relative to project root): `.anamnesis/codex-instructions/file-AGENTS.md/codex-hook-work-post-tool-use.md`.
Read this manual only at its declared trigger when this specific handler lacks enabled native support, or when asked to inspect it. Enabled native handlers may succeed silently; absent output alone is not a fallback trigger. Another handler on the same event does not establish support for this one. Do not preload future-trigger manuals or replay enabled native handlers.
<!-- /anamnesis:region -->

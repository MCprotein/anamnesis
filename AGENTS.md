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

<!-- anamnesis:region id=anamnesis-base fragment=base@5 -->
## anamnesis baseline

이 프로젝트는 [anamnesis](https://github.com/MCprotein/anamnesis) 로 관리됨.
세션마다 에이전트가 프로젝트 맥락을 처음부터 다시 배우지 않도록 컨텍스트·온톨로지·훅·스킬을 자동 동기화.

### 운영 원칙

- `<!-- anamnesis:region ... -->` 으로 감싸진 영역은 자동 갱신 대상. 직접 편집하지 말 것.
- 영역 밖은 자유. 사용자가 작성한 내용은 보존됨.
- 작업 시작 전 `.anamnesis/ontology/*.yaml` 와 `system_graph.yaml`(있을 경우) 의 온톨로지를 먼저 확인.
- 라이브러리 갱신 반영: `anamnesis update --dry-run` 으로 변경 검토 → 문제 없으면 `--apply`.
- `.claude/hooks`, `.claude/commands`, `.claude/skills` 같은 실행 가능 어댑터는 `--allow-exec-adapters` 플래그가 있어야만 갱신됨 (supply-chain 보호).

### 자주 쓰는 커맨드

- `/load-context` — 현재 프로젝트의 온톨로지를 한눈에 요약.
- `/handoff-prepare` — 작업 인계서 작성. 토큰 한도 임박 시 또는 다른 도구로 전환 전에 호출.
  결과는 `.anamnesis/handoff/<ts>.md` 로 저장되고, 다음 세션 시작 시 자동 주입됨.
- `anamnesis status` — 설치된 fragment·드리프트 상태.
- `anamnesis update --dry-run` — 라이브러리 갱신 변경사항 미리보기.

### Session start: handoff 자동 확인 (도구 비종속)

세션 시작 시 (Claude Code · Codex · Cursor 어느 도구든) 다음 절차 따를 것:

1. `.anamnesis/handoff/` 디렉토리 존재 확인.
2. 있다면 가장 최근 mtime 의 `*.md` 파일 1개 읽기 (`ls -t` / `find -printf` 등 사용).
3. 그 파일의 frontmatter (created / agent / git_ref) 와 본문 (Goal / Done / In flight / Decisions / Open questions / Next steps) 을 task context 로 받아들이고 작업 재개.
4. 핸드오프가 stale (`git log` 와 비교해 이미 진행됨) 이라면 사용자에게 확인 후 무시하고 새 작업으로 진행.

Claude Code 는 SessionStart 훅 (`inject-handoff.sh`) 으로 자동 stdout 주입되지만, Codex / Cursor 는 자동 hook 없으므로 위 절차를 **agent 가 매 세션 시작 시 직접 수행**해야 함.
<!-- /anamnesis:region -->

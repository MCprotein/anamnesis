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

# anamnesis — 설계 문서 (v0.1 draft)

> 이 문서는 anamnesis 의 초기 설계를 기록한다. v0.1 구현의 근거이자, 이후 결정의 기준점.
> 공개 문서(README)는 이 설계가 안정된 뒤 별도로 작성한다.
>
> 현재 구현 상태와 버전별 계획은 [ROADMAP.md](ROADMAP.md)를 기준으로 한다.
> 이 문서는 핵심 설계 원칙의 기준점이며, 최신 릴리스 상태를 모두 반영하는
> 운영 문서는 아니다.

## 0. TL;DR

anamnesis 는 **AI 코딩 에이전트가 세션마다 프로젝트 맥락을 처음부터 다시 배우지 않도록** 프로젝트의 컨텍스트·온톨로지·핸드오프·훅·스킬·슬래시 커맨드를 생성·동기화·진화시키는 도구다.

제품의 두 가지 핵심 약속:

1. 프로젝트마다 필요한 **온톨로지와 컨텍스트를 매 세션 자동으로 주입**한다.
2. Claude Code, Codex, Cursor 같은 에이전트를 바꿔도 **동일한 프로젝트
   맥락을 자동으로 받아 별도 재지시 없이 이어서 작업**하게 한다.

어원 — `ana-` (다시) + `mnesis` (기억). "잊지 않음". **amnesia 의 반대말**.

포지셔닝은 "스캐폴딩 툴" 이 아니라 **AI coding agent config lifecycle manager**. 만드는 것보다 **계속 살아있게 유지하는 것** 이 핵심 가치다.

---

## 1. 문제

### 1.1 반복되는 수동 구성

매 프로젝트마다 같은 패턴을 손으로 구성 중이다:

- `AGENTS.md` — canonical 프로젝트 맥락
- `.anamnesis/ontology/*.yaml` — 온톨로지와 bootstrap/enriched 기억
- `CLAUDE.md` / `system_graph.yaml` — Claude Code entrypoint 또는 사용자 관리 보조 표면
- `.claude/hooks/*.sh` — 자동화 훅 (inject-ontology, remind-uncommitted, post-*-verify)
- `.claude/skills/` — 재사용 가능한 작업 절차
- `.claude/commands/` — 슬래시 커맨드
- `.claude/settings.json` — 훅/스킬 등록

공통 뼈대는 반복이고, 프로젝트 특화 부분은 스택(prisma·k8s·nestjs·ml)별로 비슷한 패턴이다.

### 1.2 드리프트

구성은 프로젝트가 자라면서 **계속 드리프트** 한다:
- 새 서비스 추가 → 온톨로지 갱신 필요
- 리팩터 → AGENTS.md / ontology 의 구조 설명이 낡음
- 새 스택 도입 → 해당 스택 전용 훅/스킬 추가 필요

최초 스캐폴딩이 아니라 **지속적 동기화** 가 진짜 문제다.

### 1.3 도구 종속

현재는 Claude Code 에 깊게 결합되어 있다. Codex·Cursor 에서도 같은 맥락을 공유하려면 각각 포맷에 맞게 다시 구성해야 한다.

목표는 도구별 UI를 byte-for-byte 동일하게 만드는 것이 아니다. 각 도구의
native surface 는 다르다. 목표는 **사용자 관점의 동일성**이다: 어떤
에이전트로 열어도 project memory, ontology, handoff state, 운영 원칙을
같은 의미로 받아 작업을 이어갈 수 있어야 한다.

---

## 2. 비목표 (Non-goals)

명확히 **안 하는 것** 을 선언해 스코프 크립을 막는다:

- **범용 프로젝트 스캐폴더 아님** — cookiecutter/Yeoman 과 경쟁하지 않는다. `package.json`·Dockerfile·소스 코드 뼈대를 생성하지 않는다. anamnesis 가 건드리는 건 **AI 에이전트용 설정/지침 파일만**이다.
- **에이전트 런타임/오케스트레이터 아님** — OMC·LangGraph 와 다르다. 에이전트를 실행하지 않는다. 에이전트가 읽을 **파일만** 관리한다.
- **프롬프트 라이브러리 아님** — awesome-prompts 류와 다르다. 재사용 가능한 **절차·훅·온톨로지 형태** 의 조각을 다룬다.
- **자동 에이전트 생성 도구 아님** — 지침·훅·스킬을 생성하되, 에이전트의 행동 자체는 도구 밖의 문제다.

---

## 3. 포지셔닝

**AI coding agent config lifecycle manager.**

다음 한 문장으로 요약 가능해야 한다:

> anamnesis keeps your AI coding agents from forgetting what your project is.

핵심 가치 6개:

1. **Context-first** — 생성되는 파일은 소스 코드가 아니라 "에이전트가 읽을 지식" 이다.
2. **Ontology as memory substrate** — 사람이 설명하지 않아도 agent 가 프로젝트 구조와 관계를 찾을 수 있도록 structured reference 를 유지한다.
3. **Tool-agnostic core** — 내부는 도구 중립 (content + capabilities), 출력단에서만 도구별 어댑터가 렌더링.
4. **Lifecycle, not one-shot** — init 은 시작일 뿐. update·status·doctor·promote 로 계속 진화.
5. **Agent-switch continuity** — 어떤 에이전트로 바꿔도 같은 맥락과 현재 작업 상태를 받아야 한다.
6. **Project-local promotion** — 프로젝트에서 유용한 조각은 라이브러리로 승격 가능. 양방향 흐름.

---

## 4. 아키텍처

### 4.1 3-layer 모델

```
┌─────────────────────────────────────────────┐
│ content (tool-agnostic)                     │  ← 자유 형식 마크다운·YAML
│   AGENTS.md 섹션, ontology snippet 등        │
├─────────────────────────────────────────────┤
│ capabilities (intermediate representation)  │  ← 의미 단위 (project_memory, hook, skill ...)
│   각 capability 는 렌더링 계약을 정의       │
├─────────────────────────────────────────────┤
│ adapters (tool-specific)                    │  ← 각 도구로 내보내는 어댑터
│   claude-code / codex / cursor              │
└─────────────────────────────────────────────┘
```

- **content**: 자유 형식. AGENTS.md 섹션 등 사람이 읽는 마크다운·YAML. 도구 무관.
- **capabilities**: 중간 IR. `project_memory`·`ontology`·`executable_hook`·`skill`·`slash_command`·`task_harness` 같은 **의미 단위**. 각 capability 는 어떤 도구가 어떻게 렌더링하는지 계약을 가진다.
- **adapters**: capability → 도구별 파일 변환. 예: `executable_hook` → CC 는 `.claude/hooks/*.sh` + `settings.json` 등록, Codex 는 native lifecycle wrapper + AGENTS.md 지시문 + git hook fallback.

이 구조가 Codex 가 지적한 "중간 IR 필요" 를 해결한다.

### 4.2 Capabilities (v0.1)

| # | Capability | 설명 | CC 구현 | Codex 구현 | Cursor 구현 |
|---|------------|------|---------|------------|-------------|
| 1 | `project_memory` | 항상 로드되는 자유 형식 맥락 | `AGENTS.md` + `CLAUDE.md` entrypoint + optional `.claude/` surfaces | `AGENTS.md` | `AGENTS.md` |
| 2 | `ontology` | 구조화된 레퍼런스 (불변 관계) | SessionStart 훅 주입 | native SessionStart wrapper + AGENTS.md fallback | rules 지시문 |
| 3 | `executable_hook` | 이벤트 기반 자동 실행 | `.claude/hooks/` + `settings.json` | native wrappers for Codex-supported events; git hook + LLM 지시문 fallback | git hook + LLM 지시문 |
| 4 | `skill` | 재사용 가능한 작업 절차 | `.claude/skills/<name>/SKILL.md` | AGENTS.md 섹션으로 fallback | rules 로 fallback |
| 5 | `slash_command` | 사용자 호출 커맨드 | `.claude/commands/*.md` | AGENTS.md 섹션으로 fallback | rules 로 fallback |
| 6 | `task_harness` | 목표·범위·증거·테스트·rubric 작업 계약 | `.anamnesis/task-harnesses/*.yaml` 검색 대상 | `.anamnesis/task-harnesses/*.yaml` 검색 대상 | `.anamnesis/task-harnesses/*.yaml` 검색 대상 |

`task_harness`는 자동 시작 컨텍스트가 아니라 repo-local retrieval target 이다.
세션 시작에는 매칭된 harness 1개만 들어갈 수 있어야 하며, 나머지는
context index/source pointer 로 검색한다. `current` harness 는 작업 종료 후
active context 에서 제거되고, `reusable` harness 는 `last_used`,
`use_count`, `deprecated`, `superseded_by` 같은 lifecycle metadata 와
retention/GC 정책으로 관리한다.

### 4.2.1 Handoff lifecycle direction

`handoff`는 에이전트 전환이나 새 세션 재개를 위한 curated task-state
artifact 로 남겨야 한다.

현재 구현은 `/handoff-prepare`가 `.anamnesis/handoff/active.md`와
timestamped archive 를 쓰고, SessionStart 훅이 compact summary 와 source
pointer 를 주입하며, Stop 훅이 dirty work 기준으로 handoff refresh 를
알린다. 이 구조는 컨텍스트 유지에는 충분하지만 archive 생명주기를 자동
관리하지는 않는다.

v1.8 방향은 repo-local markdown 과 regenerable context index 로 관리하는
것이다:

- `hot`: `active.md`의 현재 작업. SessionStart 에 짧은 요약만 주입.
- `warm`: 최근 또는 active 가 참조하는 archive. SessionStart 에는 source
  pointer 만 주입.
- `cold`: 오래된 완료 archive. 시작 컨텍스트에는 넣지 않고 query/resume
  대상으로만 유지.
- `deprecated`: 너무 오래됐거나 superseded/stale 인 archive. 주입 금지,
  GC 후보로만 보고.

상세 설계는 [HANDOFF-LIFECYCLE.md](HANDOFF-LIFECYCLE.md)에 둔다.

**향후 추가 후보**: `scoped_rule` (Cursor 네이티브 — glob 기반 조건부 주입), `pre_commit_check` (executable_hook 의 특수형).

**중요**: `executable_hook` 은 도구마다 보장 수준이 다르다. CC 는 전용 훅 표면을 쓰고, Codex 는 현재 지원되는 lifecycle event 에 native wrapper 를 쓰되 fallback 으로 AGENTS 지시문과 git hook bridge 를 유지한다. Cursor 는 best-effort rules 지시문이다. 이 한계는 어댑터 문서에 명시한다.

### 4.3 Fragment 모델

Fragment = **한 스택/관심사에 필요한 capabilities 의 묶음**.

```
fragments/prisma/
├── fragment.yaml              # 메타데이터 (id, version, requires, capabilities)
├── content/                   # 도구 무관
│   ├── agents.snippet.md      # AGENTS.md 에 삽입될 섹션
│   └── ontology.snippet.yaml  # .anamnesis/ontology/<id>.yaml 로 렌더링될 조각
└── adapters/
    ├── claude-code/
    │   ├── hooks/prisma-validate.sh
    │   ├── settings.patch.json
    │   └── skills/...
    ├── codex/                 # 대부분 content 로 해결되지만 필요 시 override
    └── cursor/                # v0.2 이후
```

`fragment.yaml` 스키마:

```yaml
id: prisma
version: 1
description: Prisma ORM 관리 지침 + schema drift 검증 훅
requires:                      # 의존 fragment
  - base                       # 문자열 shorthand
  - id: runtime
    min_version: 2             # optional minimum integer version
conflicts: []                  # 충돌 fragment
capabilities:                  # 이 fragment 가 제공하는 capability
  - type: project_memory
    source: content/agents.snippet.md
    region: prisma
  - type: ontology
    source: content/ontology.snippet.yaml
  - type: executable_hook
    event: PostToolUse:Edit
    source: adapters/claude-code/hooks/prisma-validate.sh
    adapters_supported: [claude-code]
    side_effects: [read-only]
  - type: slash_command
    name: handoff-prepare
    source: adapters/claude-code/commands/handoff-prepare.md
    side_effects: [local-write]
  - type: task_harness
    name: context-continuity
    source: task-harnesses/context-continuity.yaml
    lifecycle: reusable
owns:                          # 이 fragment 가 소유·관리하는 리전/파일
  - region: prisma in AGENTS.md
  - file: .claude/hooks/prisma-validate.sh
```

**Fragment 의존성** — `requires`, `conflicts`,
`capabilities[].adapters_supported` 로 표현. `requires` 는 문자열 id 또는
`{ id, min_version }` 항목을 받는다. `init` / `update` 는 누락된 의존
fragment 를 가능한 경우 자동 포함하고, `status` / `doctor` 는 누락, 최소
버전 미달, pinned 버전 차단, cycle 을 렌더 전에 보고한다. 충돌 시
`agentfile` 에서 명시적 선택 필요.

**Capability side effects** — 실행 가능하거나 에이전트 행동을 바꾸는
capability (`executable_hook`, `skill`, `slash_command`) 는 선택적으로
`side_effects` 를 선언한다. 허용값은 `read-only`, `local-write`,
`repo-external-write`, `git-hook`, `network`, `credential-touching`,
`external-production` 이다. 선언값은 renderer action 으로 전파되고,
Codex/Cursor fallback 문서와 Codex native shell wrapper metadata 에
표시된다. 선언이 없는 `executable_hook` 은 보수적으로 `local-write` 로
취급한다. `doctor`/`status` 의 위험 진단은 이 metadata 를 입력으로 삼되,
진단 규칙 자체는 별도 보안 하드닝 단계에서 확장한다.

자동 탐지 조건은 `fragment.yaml` 이 아니라 `rulebook.md` 가 소유한다.
이 분리는 로컬/번들 fragment 와 v0.9 registry discovery 를 같은
suggestion pipeline 으로 다루기 위한 현재 계약이다. 원격 registry 설계는
[`docs/FRAGMENT-REGISTRY.md`](FRAGMENT-REGISTRY.md) 를 따른다.

### 4.4 Rulebook

`rulebook.md` 는 **자동 탐지 → 제안** 매핑. **자동 설치는 하지 않는다**.

```markdown
## prisma
- trigger: package.json 에 `@prisma/client` 존재
- suggest: fragments/prisma
- reason: schema drift 사고 빈번, 전용 검증 훅 필요

## k8s
- trigger: `k8s/` 디렉토리 존재 또는 `apiVersion:` 포함 YAML 있음
- suggest: fragments/k8s
```

init 시 탐지된 fragment 는 **제안 목록** 으로 표시되고, 사용자가 확인해야 설치된다. 확정된 선택은 `agentfile.yaml` 에 기록되어 향후 `update` 에서 기준이 된다.

### 4.5 Agentfile (프로젝트 manifest, 1급 개념)

프로젝트 루트에 생성되는 `agentfile.yaml` 이 **단일 진실의 소스** 다.

```yaml
version: 1
project:
  name: example-service
  scopes:                      # monorepo 지원
    - path: .
    - path: apps/api
      extends: .

tools:                         # 활성화할 어댑터
  - claude-code
  - codex

fragments:
  - id: prisma
    version: 1
    params:
      schema_path: prisma/schema.prisma
  - id: k8s
    version: 2

# 의도적으로 탐지되지만 설치 안 한 fragment (재제안 방지)
declined:
  - id: nextjs
    reason: 이 repo 는 backend-only
```

`Agentfile` 이라는 이름은 **Dockerfile 과 같은 계열**의 1급 설정 파일임을 시사한다. 확장자는 `.yaml` 로 두되, 바이너리 차원에서 `Agentfile` 도 수용.

---

## 5. 라이프사이클 — 3 커맨드

Codex 리뷰 반영으로 4개 → 3개로 축소. `sync` 와 `refresh` 구분이 약해서 `update` 로 통합, `diff` 는 `update --dry-run` 으로 흡수.

### 5.1 `anamnesis init`

최초 생성. 대화형.

1. 현재 디렉토리 분석 (`package.json`, `pyproject.toml`, `k8s/`, `Dockerfile`, `prisma/` 등)
2. rulebook 에 매칭되는 fragment → **제안 목록** 표시
3. 사용자가 선택 / 거절 / 파라미터 입력
4. `base/` 를 **무조건** 설치, 선택된 fragment 의 capabilities 를 선택된
   `tools` 어댑터로 렌더링 (`--tools all` 또는
   `--tools claude-code,codex,cursor` 로 첫 설치부터 다중 에이전트 surface 생성)
5. 기존 프로젝트 전용 agent surface 가 표준 anamnesis surface 와 충돌하면
   안전하게 보존한다. 예: 사용자 작성 `.claude/skills/load-context` 는
   `.claude/skills/project-load-context` 로 이동한 뒤 표준 `load-context` 를
   설치한다.
6. `Agentfile`·`.anamnesis/manifest.json` 변경 계획 생성
7. 생성된 adapter surface 를 쓰기 전에, 원래 프로젝트 상태를 기준으로
   `system_graph.yaml` 이 없으면 보수적인 프로젝트 컨텍스트 초안을
   생성한다. safe local signal(`package.json`, README, CLAUDE.md, docs 구조,
   일반 dependency/디렉토리 이름) 이 있으면 factual entity/relationship
   후보를 담고, 신호가 하나도 없으면 프로젝트명·안전 invariant·open
   question 만 담는다. `.env`, Terraform tfvars/state, PEM, token/key/log
   값은 읽거나 출력하지 않는다. `--no-context-bootstrap` 으로 생략 가능.
8. 에이전트가 사용자를 대신해 `init` 을 진행하는 경우 `anamnesis-init`
   skill 이 README/docs 처리 방식을 객관식으로 먼저 묻고, 답변을
   아래 플래그 중 하나로 매핑한다.
9. `--scaffold-docs` 가 있으면 누락된 `README.md` 와
   `docs/PROJECT-CONTEXT.md` 에 starter region 을 만든다. 이미 존재하는
   사용자 문서는 건드리지 않는다.
10. `--enhance-docs` 가 있으면 기존 `README.md`/`docs/PROJECT-CONTEXT.md`
   를 보존한 채 관리 region 을 추가 또는 갱신한다. 이 플래그가 없는
   기본 init 은 사용자 문서를 보완하지 않는다.
11. 계획된 파일과 manifest 를 적용
12. 결과 diff 요약 후 확인 → commit 여부 프롬프트

### 5.2 `anamnesis update`

라이브러리 개선 · 프로젝트 드리프트 양쪽 모두 처리.

- 기본 `--dry-run`. `--apply` 로만 실제 적용.
- `--allow-exec-adapters` 없으면 실행 가능 파일(hooks/commands/skills 스크립트) 덮어쓰기 차단.
- 동작:
  1. `agentfile.yaml` 읽기
  2. 각 fragment 의 현재 라이브러리 버전 vs 프로젝트에 적용된 버전 비교
  3. 프로젝트 파일 해시 vs manifest 의 `last_applied_hash` 비교 → 사용자 수정 감지
  4. **세 축의 diff 프레젠테이션**:
     - 신규 fragment (라이브러리에 추가됨, 프로젝트 미설치)
     - 갱신 fragment (버전 올라감)
     - 사용자 수정 감지 fragment (local override 로 승격 권유)
  5. git 스타일 patch preview, `--apply` 확정

### 5.3 `anamnesis promote`

프로젝트의 로컬 조각을 라이브러리로 승격.

```bash
anamnesis promote ./.claude/hooks/my-custom-validate.sh
```

- 어느 capability 로 승격할지 선택
- 어느 fragment 에 포함시킬지 선택 (신규 fragment 생성 가능)
- 라이브러리 로컬 복사본에 쓰기 (PR 제출은 사용자가)

### 5.4 상위 커맨드 (보조)

- `anamnesis status` — 현재 프로젝트의 설치 상태 요약
- `anamnesis doctor` — 설치 무결성 검사 (누락 파일, 해시 불일치, 어댑터 지원 누락)
- `anamnesis benchmark report` — static/bootstrap/enriched context surface 와
  continuity readiness 를 markdown/json 으로 기록
- `anamnesis benchmark prompt-gate` — Codex prompt-time context delta 를
  기본 동작으로 켜기 전에 evidence, token budget, duplicate risk 를 판정

v0.1 에서 `status` 는 필수, `doctor` 는 선택.

---

## 6. 멱등성 모델

Codex 가 지적한 대로 가장 난이도가 높은 영역. 파일 해시만으로 부족.

### 6.1 리전 앵커

텍스트 파일 (AGENTS.md 및 관리되는 markdown/yaml 출력) 은 리전 또는
manifest 해시 단위로 관리:

```markdown
<!-- anamnesis:region id=prisma fragment=prisma@1 -->
... auto-managed content ...
<!-- /anamnesis:region -->
```

앵커 밖은 사용자 자유 영역. 재생성 시 건드리지 않는다.

**주의**: JSON/YAML 설정 파일(settings.json 등)은 주석/키 순서가 의미 가지므로 리전 앵커 대신 **구조적 머지** (키 단위 패치 적용) 로 처리.

### 6.2 Manifest (`.anamnesis/manifest.json`)

도구 중립 위치. `.claude/` 밖에 둔다.

```json
{
  "version": 1,
  "regions": [
    {
      "file": "AGENTS.md",
      "region_id": "prisma",
      "fragment_id": "prisma",
      "fragment_version": 1,
      "template_version": 3,
      "params": { "schema_path": "prisma/schema.prisma" },
      "base_rendered_hash": "sha256:...",
      "last_applied_hash": "sha256:...",
      "current_user_hash": "sha256:..."
    }
  ],
  "files": [
    {
      "path": ".claude/hooks/prisma-validate.sh",
      "fragment_id": "prisma",
      "fragment_version": 1,
      "last_applied_hash": "sha256:...",
      "current_user_hash": "sha256:..."
    }
  ]
}
```

각 region/file 에 **6개 필드**:
- `fragment_id`, `fragment_version` — 어느 fragment 가 소유하는가
- `template_version`, `params` — 생성에 사용된 템플릿/파라미터
- `base_rendered_hash` — 깔릴 때의 렌더링 결과 해시 (변경 기준선)
- `last_applied_hash` — 마지막으로 anamnesis 가 쓴 상태 해시
- `current_user_hash` — 현재 파일 해시 (update 때 재계산)

### 6.3 사용자 수정 감지 UX

`last_applied_hash ≠ current_user_hash` → 사용자 수정 있음.

이때 자동 3-way merge 보다 **"로컬 오버라이드로 승격"** 을 기본 UX 로 둔다:

```
[detected] AGENTS.md region=prisma has local edits.

  a) Keep local (pin this region as user-owned, skip future updates)
  b) Promote to local fragment (save edit to .anamnesis/overrides/prisma.md, apply on update)
  c) Discard local and take library update (destructive, needs confirmation)
  d) View 3-way diff
```

기본 선택은 (a). 실수로 사용자 작업이 날아갈 여지를 없앤다.

### 6.4 백업

`--apply` 전에 자동 백업:

```
.anamnesis/backups/{ISO timestamp}/
```

`settings.backup_retention` controls lifecycle cleanup for those backup
directories during `update --apply`: keep the newest N backup directories,
or keep all backups when set to `0`.

단 Codex 지적대로 백업 디렉토리는 **최후의 안전망**. 주 UX 는 `git diff` 프리뷰와 사용자 수정 승격. 백업은 "실수로 눌렀을 때만" 쓴다.

---

## 7. 보안 모델

`.claude/hooks/`·`.claude/commands/`·`.claude/skills/` 는 실행 가능한 자동화 표면이다. 라이브러리 update 로 이걸 덮는 것은 **supply-chain 리스크**.

### 7.1 실행 어댑터 분리

`update` 는 기본적으로 **컨텐츠(AGENTS.md·ontology) 만 갱신**. 실행 가능 파일은 `--allow-exec-adapters` 명시 플래그 없으면 건드리지 않는다.

```bash
anamnesis update                          # 컨텐츠만
anamnesis update --apply                  # 컨텐츠만 실제 적용
anamnesis update --apply --allow-exec-adapters  # 훅/커맨드/스킬 스크립트 포함
```

### 7.2 Fragment 서명 (v0.2+)

커뮤니티 fragment 를 받기 시작하면 서명·체크섬·pinning 필요. v0.1 은 로컬 라이브러리만 쓰니까 연기.

### 7.3 Hook 실행 권한

생성되는 hook 스크립트는 `chmod 755` 기본. `chmod +x` 필요 없도록 처음부터 실행 권한 부여.

---

## 8. 디렉토리 구조

### 8.1 라이브러리 (이 리포지토리)

```
anamnesis/
├── README.md                  # 공개용 (영문)
├── LICENSE                    # MIT 예정
├── package.json               # TypeScript CLI
├── docs/
│   ├── DESIGN.md              # 이 문서
│   └── capabilities/
│       ├── project_memory.md
│       ├── ontology.md
│       ├── executable_hook.md
│       ├── skill.md
│       └── slash_command.md
├── specs/
│   ├── agentfile.md           # agentfile.yaml 스키마
│   ├── fragment.md            # fragment.yaml 스키마
│   ├── manifest.md            # .anamnesis/manifest.json 스키마
│   └── rulebook.md            # rulebook.md 포맷
├── base/                      # 공통 뼈대
│   ├── AGENTS.md.tmpl
│   ├── content/
│   │   └── ontology.yaml.tmpl
│   └── adapters/
│       └── claude-code/
│           ├── hooks/
│           │   ├── inject-ontology.sh.tmpl
│           │   └── remind-uncommitted.sh
│           ├── skills/load-context/
│           ├── commands/load-context.md
│           └── settings.json.tmpl
├── fragments/                 # 조건부 조각
│   ├── prisma/
│   ├── k8s/
│   ├── nestjs/
│   ├── nextjs/
│   ├── fastapi/
│   ├── python-uv/
│   └── docker-compose/
├── capabilities/              # 중간 IR 정의 (렌더링 계약)
│   ├── project_memory.ts
│   ├── ontology.ts
│   ├── executable_hook.ts
│   ├── skill.ts
│   └── slash_command.ts
├── rulebook.md                # 자동 탐지 → 제안 매핑
├── cli/                       # TypeScript CLI 본체
│   ├── src/
│   └── tsconfig.json
└── CONTRIBUTING.md
```

### 8.2 프로젝트 (소비자)

```
<user-project>/
├── Agentfile                  # 심볼릭 혹은 ↓ yaml 로
├── agentfile.yaml             # 1급 manifest (사용자가 편집)
├── AGENTS.md                  # canonical content (tool-agnostic)
├── .anamnesis/
│   ├── manifest.json          # 리전·파일 해시 기록
│   ├── ontology/              # static + bootstrap + enriched ontology
│   ├── handoff/               # active.md + timestamped archives; v1.8 lifecycle tiers planned
│   ├── task-harnesses/         # reusable/current task contracts
│   ├── overrides/             # 사용자 승격된 로컬 오버라이드
│   └── backups/               # update 전 백업
├── .claude/                   # Claude Code 어댑터 산출물
│   ├── hooks/
│   ├── skills/
│   ├── commands/
│   └── settings.json
├── .cursor/rules/             # Cursor 어댑터 산출물
├── .anamnesis/codex-hooks/    # Codex git-hook bridge
├── CLAUDE.md                  # Claude Code entrypoint redirecting to AGENTS.md
├── system_graph.yaml          # legacy / optional user-managed ontology
└── (기타 프로젝트 파일)
```

---

## 9. 도구 커버 매트릭스

Canonical, test-backed adapter parity is maintained in
[ADAPTER-PARITY.md](ADAPTER-PARITY.md). This section keeps the design-level
summary.

| Capability | Claude Code | Codex | Cursor |
|------------|-------------|-------|----------------|
| project_memory | ✅ AGENTS.md + CLAUDE.md entrypoint + optional CC surfaces | ✅ AGENTS.md 자동 로드 | ✅ AGENTS.md 자동 로드 |
| ontology | ✅ SessionStart 훅 주입 | ✅ native SessionStart wrapper + AGENTS fallback | 🟡 rules 지시문 |
| executable_hook | ✅ 네이티브 훅 | 🟡 native Codex lifecycle wrappers + AGENTS fallback + optional git pre-commit bridge | 🟡 `.cursor/rules` 지시 |
| skill | ✅ `.claude/skills/` | 🟡 AGENTS.md 섹션 | 🟡 rules |
| slash_command | ✅ `.claude/commands/` | 🟡 AGENTS.md 섹션 | 🟡 rules |
| task_harness | 🟡 `.anamnesis/task-harnesses/*.yaml` retrieval | 🟡 `.anamnesis/task-harnesses/*.yaml` retrieval | 🟡 `.anamnesis/task-harnesses/*.yaml` retrieval |

- ✅ = 네이티브 자동 동작
- 🟡 = best-effort, LLM 지시문 + 외부 fallback
- ❌ = 지원 불가 (limitations.md 에 명시)

**원칙**: 각 어댑터가 지원 못 하는 capability 는 무시하지 않고 생성된
지침과 진단 출력에서 한계를 드러낸다. "Codex 에선 이 훅이 네이티브로
자동 실행되지 않지만 git pre-commit bridge 와 AGENTS.md 지시문이
설치됐습니다" 같은 메시지가 필요하다.

---

## 10. 로드맵

현재 로드맵은 [ROADMAP.md](ROADMAP.md)가 canonical 이다. 이 설계 문서의
초기 버전별 구상은 v0.1 구현의 기준점이었고, 현재 제품 방향은 다음 두
축으로 정리됐다:

1. 모든 세션에서 current context + ontology 를 자동으로 주입한다.
2. 에이전트를 바꿔도 handoff + project memory + ontology 를 이어받아
   별도 재지시 없이 계속 작업할 수 있게 한다.

따라서 이후 개발은 "지원 프레임워크 개수"보다 dogfood 로 확인된
context-continuity 품질, adapter user-facing parity, ontology drift/enrichment
lifecycle 을 우선한다.

---

## 11. 열린 질문 (구현 전 결정 필요)

1. **Agentfile 파일명** — `Agentfile` vs `agentfile.yaml` vs 둘 다 지원. 현재 안: 둘 다 지원하되 내부는 yaml.
2. **구현 언어** — TypeScript (Node 20+) 로 가되, 배포 경로는 npm + 추후 단일 바이너리(pkg/bun compile). v0.1 은 `npx anamnesis` 로 충분.
3. **모노레포 스코프** — `scopes[]` 설계는 잡혀 있지만 v0.1 에 포함할지 v0.2 로 미룰지. 내부 3 프로젝트 중 monorepo 없으면 v0.2 로 미루는 게 합리적.
4. **온톨로지 병합** — 여러 fragment 가 `ontology.snippet.yaml` 을 제공할 때 병합 전략. YAML merge 라이브러리 (yaml ast) 필요.
5. **Fragment 버전 관리** — semver? 단일 증가? v0.1 은 단일 정수로 시작, 외부 공개 전 semver 로 전환.
6. **라이브러리 배포** — fragments 는 npm 에 묶여서 가느냐 별도 git 저장소냐. v0.1 은 한 저장소 내부.
7. **CLAUDE.md 의 위치** — resolved as a Claude Code entrypoint.
   AGENTS.md is canonical project memory; `.claude/` carries native CC
   hooks, skills, commands, and settings. CLAUDE.md receives an
   anamnesis-managed region pointing Claude Code at AGENTS.md, ontology,
   and handoff state while preserving any user prose outside the region.

---

## 12. 참고 (prior art)

- **cookiecutter / Yeoman** — 최초 스캐폴딩 중심, lifecycle 없음
- **Dockerfile** — 1급 manifest 개념 (Agentfile 작명의 영감)
- **Terraform** — state file + plan/apply 분리 (update --dry-run 설계의 참고)
- **asdf-vm / mise** — 프로젝트별 manifest + 도구 자동 선택
- **pre-commit** — git hook 기반 검증 자동화
- **Anthropic Claude Code** — hooks, skills, memory 네이티브 표면
- **Cursor Project Rules** — MDC metadata 포맷
- **OpenAI Codex** — AGENTS.md 관습

# Agentfile 스펙 (v1)

> `Agentfile` / `agentfile.yaml` 은 프로젝트에서 anamnesis 가 **단일 진실의 소스(single source of truth)** 로 삼는 파일이다.
> 어떤 fragment 를 설치했고, 어떤 도구를 타겟하며, 어떤 파라미터를 썼는지 명시한다.
> **사람이 편집 가능** 해야 하고, **머신이 파싱 안정** 해야 하며, **diff 친화적** 이어야 한다.

---

## 1. 파일 발견 (discovery)

anamnesis CLI 는 다음 순서로 찾는다:

1. `$PWD/Agentfile`
2. `$PWD/agentfile.yaml`
3. `$PWD/agentfile.yml`
4. `$PWD/.anamnesis/agentfile.yaml`

하나만 존재해야 한다. 둘 이상 발견 시 **에러**. (혼란·드리프트 방지)

**권장**: `Agentfile` 이름 사용 (Dockerfile 관습). 확장자 없음. 내부 포맷은 YAML.

---

## 2. 최소 예시

```yaml
version: 1

project:
  name: example-service

tools:
  - claude-code

fragments:
  - id: k8s
    version: 1
```

---

## 3. 완전한 예시

```yaml
version: 1

project:
  name: example-service
  description: >
    MicroK8s 단일 노드 홈서버 인프라 워크스페이스.
    Zot 레지스트리, Traefik, GitHub ARC runner 운영.
  scopes:
    - path: .
    - path: k8s/tenant/overlays/jaemin
      extends: .
      overrides:
        tools: [claude-code]

tools:
  - claude-code
  - codex

fragments:
  - id: k8s
    version: 2
    params:
      namespace_style: workload-per-namespace

  - id: prisma
    version: 1
    params:
      schema_path: prisma/schema.prisma

  - id: nextjs
    version: 1
    adapters:
      claude-code: true
      codex: false     # Next.js 어댑터는 CC 에서만 활성

declined:
  - id: fastapi
    reason: 이 repo 는 Python 워크로드 없음
    declined_at: 2026-04-23

settings:
  ontology_file: system_graph.yaml # legacy / optional user-managed ontology overlay
  agents_md_path: AGENTS.md
  claude_md_path: CLAUDE.md      # Claude Code entrypoint surface
  commit_on_apply: false       # update --apply 후 자동 커밋 여부
  backup_retention: 10         # 최근 N개 백업만 유지

overrides:
  regions:
    - file: AGENTS.md
      region_id: k8s
      locked: true             # update 에서 건드리지 않음
      reason: 팀 합의로 문구 직접 관리
```

---

## 4. 스키마 (필드별)

### 4.1 최상위

| 키 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `version` | `int` | ✅ | Agentfile 스키마 버전. 현재 `1` |
| `project` | `Project` | ✅ | 프로젝트 메타 |
| `tools` | `string[]` | ✅ | 활성 어댑터. `claude-code` \| `codex` \| `cursor`. `init` 기본값은 `claude-code`; 첫 설치부터 전체 surface 를 원하면 `anamnesis init --tools all` 을 사용한다. |
| `fragments` | `Fragment[]` | ✅ | 설치된 fragment 목록 (순서는 병합 우선순위) |
| `declined` | `Declined[]` | ⛔ | 의도적으로 거절한 fragment. rulebook 재제안 방지 |
| `settings` | `Settings` | ⛔ | 프로젝트 레벨 동작 조정 |
| `overrides` | `Overrides` | ⛔ | 리전/파일별 특수 취급 |

### 4.2 `project`

| 키 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `name` | `string` | ✅ | 프로젝트 식별자 |
| `description` | `string` | ⛔ | 짧은 설명. AGENTS.md 상단 생성에 사용 |
| `scopes` | `Scope[]` | ⛔ | 모노레포 하위 스코프 (v0.2+). 비우면 루트 단일 스코프 |

### 4.3 `Scope` (모노레포 — v0.2+)

| 키 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `path` | `string` | ✅ | 프로젝트 루트 기준 상대 경로 |
| `extends` | `string` | ⛔ | 다른 scope `path` 를 베이스로 상속 |
| `overrides` | `object` | ⛔ | 이 스코프만의 `tools` / `fragments` 부분 오버라이드 |

단일 프로젝트는 `scopes` 를 생략하거나 `- path: .` 만 둔다. 모노레포는
루트와 하위 앱/패키지를 scope 로 선언한다.

### 4.4 `Fragment`

| 키 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | `string` | ✅ | 라이브러리의 fragment id (예: `prisma`) |
| `version` | `int` | ✅ | 설치된 fragment 버전. `update` 가 참조 |
| `params` | `object` | ⛔ | fragment 가 선언한 파라미터에 대한 값 |
| `adapters` | partial `object<tool, bool>` | ⛔ | 어댑터별 활성/비활성 오버라이드. 필요한 도구만 적는다. 기본: `tools` 전부 활성 |
| `pinned` | `bool` | ⛔ | `true` 면 `update` 가 자동 bump 하지 않고 `fragments/<id>/.versions/<version>/`(base 는 `base/.versions/<version>/`) 에서 해당 버전을 렌더링. `update --bump-pinned` 로만 명시적 bump |

**순서** — 배열의 순서가 곧 **병합/충돌 해결 우선순위**. 아래 순번일수록 나중에 렌더링되어 덮어씀. 충돌 시 anamnesis 는 경고만 내고 순서를 믿는다.

### 4.5 `Declined`

| 키 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | `string` | ✅ | 거절한 fragment id |
| `reason` | `string` | ⛔ | 로그용 이유 |
| `declined_at` | `ISO 8601 date` | ⛔ | `init` 에서 자동 기록 |

rulebook 이 `declined` 에 있는 fragment 를 매칭해도 **다시 제안하지 않는다**. 단 `--force-rescan` 시 재제안.

### 4.6 `Settings`

| 키 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `ontology_file` | `string` | `system_graph.yaml` | legacy / optional 사용자 관리 top-level 온톨로지 파일. fragment ontology slices 는 별도로 `.anamnesis/ontology/<id>.yaml` 에 렌더링됨 |
| `agents_md_path` | `string` | `AGENTS.md` | canonical content 파일 경로 |
| `claude_md_path` | `string` | `CLAUDE.md` | Claude Code entrypoint 파일 경로. canonical project memory 는 AGENTS.md 이며 CLAUDE.md 는 그 위치를 가리키는 CC 특화 managed region 을 담음 |
| `commit_on_apply` | `bool` | `false` | `update --apply` 후 자동 git commit |
| `backup_retention` | `int` | `10` | 백업 디렉토리 유지 개수. 0 = 무제한 |

### 4.7 `Overrides`

| 키 | 타입 | 설명 |
|---|---|---|
| `regions` | `RegionOverride[]` | 리전 단위 특수 처리 |
| `files` | `FileOverride[]` | 파일 단위 특수 처리 |

`RegionOverride`:

| 키 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `file` | `string` | ✅ | 대상 파일 |
| `region_id` | `string` | ✅ | 리전 id |
| `locked` | `bool` | ⛔ | `true` 면 `update` 가 이 리전을 스킵 |
| `reason` | `string` | ⛔ | 로그용 |

`FileOverride` — 파일 전체를 사용자 소유로 선언:

| 키 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `path` | `string` | ✅ | 파일 경로 |
| `locked` | `bool` | ⛔ | `update` 가 이 파일을 건드리지 않음 |

---

## 5. 검증 규칙 (validation)

검증은 두 층으로 나뉜다. `parseAgentfile` 은 파일 하나만 보고 판단할
수 있는 schema / semantic 오류를 거부한다. fragment library, rulebook,
manifest, filesystem 상태가 필요한 검증은 `status`, `doctor`, `init`,
`update` 같은 command 레이어가 담당한다.

### 5.1 Parser-level hard errors

`Agentfile` 을 읽는 즉시 거부:

1. `version` 이 지원 범위 밖 (`1`만 지원)
2. `project.name` 누락 또는 빈 문자열
3. `tools` 누락, 빈 배열, 또는 알 수 없는 어댑터 이름
4. `fragments[].id` 누락 또는 중복
5. `fragments[].version` 이 양의 정수가 아님
6. `fragments[].adapters` 에 알 수 없는 어댑터 키가 있음
7. `declined[].id` 누락 또는 중복
8. `project.scopes[].path` 중복
9. `project.scopes[].extends` 가 선언되지 않은 scope path 를 가리킴
10. `project.scopes[].extends` 가 자기 자신을 가리킴
11. YAML 문법 오류 또는 필드 타입 오류

### 5.2 Library/project-aware diagnostics

다음 검증은 파일 단독으로는 판단할 수 없으므로 command 레이어에서
에러 또는 경고로 보고한다:

- 존재하지 않는 `fragments[].id`
- pinned fragment archive 누락 또는 archive 내부 version 불일치
- 설치된 fragment 의 버전이 라이브러리의 최신보다 낮음
- 라이브러리가 선언하지 않은 `params` 키
- 필수 파라미터 누락 (fragment 가 `required` 로 선언한 경우)
- `scopes[].path` 가 실제로 존재하지 않음
- `declined` 에 있는데 현재 rulebook 과 매칭되지 않는 stale declined
  entry
- `overrides.regions[].region_id` 가 실제 manifest 에 없음

`status` 는 가능한 한 drift / update / stale 상태를 구조적으로
보고하고, `doctor` 는 사용자가 실행할 수 있는 repair guidance 를 붙인다.

---

## 6. 진화 (schema evolution)

### 6.1 버전 올리는 시점

다음 중 하나:
- 필드 이름 변경
- 필드 의미 변경
- 필수 필드 추가

**추가만** 하는 경우(선택 필드 신설): 기존 `version` 유지.

### 6.2 마이그레이션

`anamnesis update` 는 `version` 이 낮으면 자동 마이그레이션 제안:

```
[migration] agentfile.yaml version 1 → 2 available.
Run `anamnesis migrate agentfile` to apply.
```

마이그레이션은 파일을 먼저 백업한 뒤 변환 규칙 적용.

### 6.3 하위 호환

v0.1 에서는 **v0.x 전체를 실험적** 으로 간주. 안정성 보장은 v1.0 부터.

---

## 7. 생성 시점

`Agentfile` 은 다음 시점에 자동 생성/갱신:

| 시점 | 동작 |
|---|---|
| `anamnesis init` | 신규 생성. 선택된 fragments 반영. `declined` 기록. |
| `anamnesis update --apply` | 버전 bump 반영. `declined` 는 유지. |
| `anamnesis promote` | 프로젝트 로컬 fragment 승격 시 `fragments[]` 에 항목 추가. |
| 사용자 직접 편집 | 허용. 다음 `update` 시 검증. |

---

## 8. AGENTS.md / CLAUDE.md 와의 관계

- `Agentfile` 은 **설정/manifest**. 사람이 편집하는 소스.
- `AGENTS.md` 는 **canonical 컨텐츠**. anamnesis 가 fragment 의
  `content/agents.snippet.md` 들을 합쳐 생성하며 Claude Code, Codex,
  Cursor 가 공유해야 하는 프로젝트 메모리의 기준이다.
- `CLAUDE.md` 는 **Claude Code 특화 entrypoint**. `claude-code` 도구가
  활성화된 scope 에서 anamnesis 는 관리 region 을 추가해 canonical
  `AGENTS.md`, ontology, handoff 위치로 Claude Code 를 안내한다. 기존
  수동 prose 는 region 밖에 보존된다. Claude Code 의 native
  hook/skill/command 출력은 주로 `.claude/` 아래에 렌더링된다.

셋은 서로 다른 층이다:
- Agentfile → "무엇을 설치했는가"
- AGENTS.md → "모든 에이전트가 알아야 할 것"
- CLAUDE.md / `.claude/` → "Claude Code 가 이 프로젝트에서 쓰는 native surface"

---

## 9. 예: 스택 진화 시나리오

**초기 (init)**:
```yaml
version: 1
project: { name: backend-api }
tools: [claude-code]
fragments:
  - { id: nestjs, version: 1 }
```

**prisma 도입 후 (status/update → suggest → Agentfile 확장)**:
```yaml
version: 1
project: { name: backend-api }
tools: [claude-code]
fragments:
  - { id: nestjs, version: 1 }
  - { id: prisma, version: 1, params: { schema_path: prisma/schema.prisma } }
```

**Codex 팀 합류 (tools 확장)**:
```yaml
version: 1
project: { name: backend-api }
tools: [claude-code, codex]
fragments:
  - { id: nestjs, version: 1 }
  - { id: prisma, version: 1, params: { schema_path: prisma/schema.prisma } }
declined:
  - { id: nextjs, reason: backend-only, declined_at: 2026-05-01 }
```

**특정 리전 팀 수동 관리 전환**:
```yaml
# ...위와 동일...
overrides:
  regions:
    - file: AGENTS.md
      region_id: prisma
      locked: true
      reason: 팀 협의 후 prisma 가이드 수동 관리
```

---

## 10. 열린 질문

- `fragments[]` 배열 순서 대신 **의존 그래프 자동 정렬** 을 해야 하나? — v0.1 은 명시 순서, v0.2+ 자동 토폴로지 정렬 고려.
- `params` 스키마 검증을 어디서 하나? — 각 fragment 의 `fragment.yaml` 에 JSON Schema 로 선언, anamnesis 가 검증.
- monorepo `scopes` 의 `overrides` 정책이 충분한가? — v0.2 설계 시 재검토.

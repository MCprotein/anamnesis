## Docker Compose

이 프로젝트는 Docker Compose 사용. 다음 운영 규칙을 따른다.

### CLI · 파일명

- **`docker compose`** (v2 플러그인) 사용. `docker-compose` (v1, deprecated) 금지.
- 메인 파일은 **`compose.yaml`** 우선. `docker-compose.yml` 도 호환되지만 신규 프로젝트는 `compose.yaml`.
- `compose.override.yaml` 자동 병합 — 로컬 개발 변형은 여기에.
- `version: "3.x"` 줄은 v2 에서 무시됨 — 새로 안 적어도 됨.

### Healthcheck · 기동 의존성

- 장수명 서비스는 **healthcheck 필수** (db, cache, queue, app server). 1회성 컨테이너는 예외.
- `depends_on` 단순 형태 (`depends_on: [db]`) 는 **컨테이너 기동만** 보장 — 서비스 준비 안 기다림. 거의 항상 잘못된 선택.
- 올바른 형태:
  ```yaml
  depends_on:
    db:
      condition: service_healthy
  ```
- healthcheck 인터벌은 합리적으로 (`interval: 10s`, `start_period: 30s`). 너무 자주면 부하, 너무 드물면 의존 서비스 기동 지연.

### Restart 정책

- 운영 비슷한 환경: `restart: unless-stopped`
- 로컬 개발: `restart: "no"` (오류 시 재시작 자동화는 디버깅 방해)
- `always` 는 거의 안 씀 — 이미 종료된 컨테이너도 재시작해 무한 루프 가능.

### 포트 바인딩

- **외부 노출이 필요 없으면 `127.0.0.1` 에 바인딩**: `"127.0.0.1:5432:5432"`. 그냥 `"5432:5432"` 는 `0.0.0.0:5432` (모든 인터페이스) 노출 — 방화벽 없으면 위험.
- 내부 통신만이면 `ports` 빼고 `expose` 만 — Compose 네트워크 안에서만 접근 가능.

### 환경 변수 계층

- `.env` (commit): 비밀 아닌 기본값 (포트, DB 이름, 디버그 플래그 등)
- `.env.local` (gitignored, 머신별): 비밀 키, 로컬 오버라이드. 모든 머신에서 동일 안 함.
- secret 파일 자체는 docker secrets 또는 외부 vault — `.env` 에 직접 안 적음.
- compose 가 자동으로 `.env` 만 로드. `.env.local` 은 명시 필요: `docker compose --env-file .env.local up` 또는 `env_file:` 디렉티브.

### 프로파일

- 옵셔널 서비스(예: 모니터링, mail catcher)는 `profiles: [dev]` / `profiles: [test]` 로 분리.
- `docker compose --profile dev up` 으로 활성. 기본 up 에는 빠짐.
- 운영은 어떤 프로파일도 활성화 안 한 게 기본 동작.

### 볼륨 · 네트워크 명명

- 볼륨 이름이 명시 안 되면 Compose 가 `<projectname>_<volumename>` 자동 생성 — 다른 프로젝트와 충돌 방지.
- 명시할 땐 그래도 `<purpose>` 만 적고 (`db_data`), Compose 의 prefix 동작 활용.
- 네트워크도 동일 — 명시적으로 외부 네트워크에 연결할 때만 `external: true`.

### 자주 하는 실수

- `depends_on: [db]` (조건 없음) → 앱이 db 기동 안 끝났는데 시작해 connection refused.
- `"5432:5432"` (호스트 IP 미지정) → 외부에서 직접 접근 가능, secret 일 때 사고.
- `version: "3.x"` 적고 v3-only 기능에 의존 → v2 플러그인은 더 새 스펙 사용, 명시 의미 없음.
- `restart: always` 로 dev 환경 → 코드 버그로 죽는 컨테이너가 계속 재시작, 로그만 쌓임.
- `.env` 에 비밀 넣고 commit → 깃 히스토리에 영구 유출.
- `docker-compose` (하이픈, v1) 사용 → "no module named '...'" 등 비호환 에러.

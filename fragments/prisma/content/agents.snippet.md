## Prisma

이 프로젝트는 Prisma ORM 사용. 설치된 버전과 schema·generator 설정을 먼저 확인한다. 아래 migrate 흐름은 Prisma 6/7 기준이며 다른 버전에서는 해당 버전 문서를 확인한다.

### Source of truth

- 프로젝트에 설정된 Prisma schema와 migration history를 함께 관리한다. `prisma/schema.prisma`는 기본 경로이며 실제 설정을 확인한다. 적용된 migration을 임의 수정해 현재 schema와 맞추지 않는다.
- 모델/필드 변경 후 반드시 `npx prisma generate` 로 클라이언트 타입 재생성.

### 마이그레이션

- 로컬 개발: `npx prisma migrate dev --name <change-description>` — 마이그레이션 파일 생성 + 적용. Prisma 7에서는 클라이언트를 자동 재생성하지 않으므로 `npx prisma generate`를 별도로 실행한다.
- 운영 배포: `npx prisma migrate deploy` — 미적용 마이그레이션만 적용. 새 파일 생성 안 함.
- **`prisma db push`** 는 prototyping 전용. 운영 환경에서 절대 사용 금지 (마이그레이션 파일 생성 안 됨).
- **`prisma migrate reset`** 은 모든 데이터 삭제. 로컬 외 환경에서 절대 사용 금지.

### 충돌·복구

- 마이그레이션 충돌: `prisma migrate resolve --applied <name>` 또는 `--rolled-back <name>` 으로 history 정리. 적용된 migration history는 임의 수정하지 않는다. 데이터 보존 등의 custom SQL이 필요하면 `prisma migrate dev --create-only`로 미적용 migration을 만들고 SQL을 검토·편집한 뒤 적용한다.
- "drift detected" 경고: 운영 DB 스키마가 마이그레이션 history 와 다름 — 무시하고 진행하지 말고 원인 추적.
- 새 환경 부트스트랩: `prisma migrate deploy` (운영) 또는 `prisma migrate dev` (로컬 첫 셋업).

### 자주 하는 실수

- `migrate dev` 후 `generate` 빠뜨려서 IDE 에 새 모델 타입이 안 보임 → `npx prisma generate` 수동 실행.
- 클라이언트 import 가 `@prisma/client` 가 아닌 다른 경로로 되어 있으면 `prisma generate` 의 output path 확인.

근거: [Prisma 7 migrate dev](https://www.prisma.io/docs/cli/v7/migrate/dev), [migration SQL 수정](https://docs.prisma.io/docs/orm/prisma-migrate/workflows/customizing-migrations).

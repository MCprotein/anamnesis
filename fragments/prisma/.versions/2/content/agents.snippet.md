## Prisma

이 프로젝트는 Prisma ORM 사용. 다음 운영 규칙을 따른다.

### Source of truth

- `prisma/schema.prisma` 가 스키마의 유일한 진실. SQL 파일이나 마이그레이션 파일을 직접 편집해서 동기화하지 말 것.
- 모델/필드 변경 후 반드시 `npx prisma generate` 로 클라이언트 타입 재생성.

### 마이그레이션

- 로컬 개발: `npx prisma migrate dev --name <change-description>` — 마이그레이션 파일 생성 + 적용 + 클라이언트 재생성.
- 운영 배포: `npx prisma migrate deploy` — 미적용 마이그레이션만 적용. 새 파일 생성 안 함.
- **`prisma db push`** 는 prototyping 전용. 운영 환경에서 절대 사용 금지 (마이그레이션 파일 생성 안 됨).
- **`prisma migrate reset`** 은 모든 데이터 삭제. 로컬 외 환경에서 절대 사용 금지.

### 충돌·복구

- 마이그레이션 충돌: `prisma migrate resolve --applied <name>` 또는 `--rolled-back <name>` 으로 history 정리. `migrations/` 디렉토리 직접 편집 금지.
- "drift detected" 경고: 운영 DB 스키마가 마이그레이션 history 와 다름 — 무시하고 진행하지 말고 원인 추적.
- 새 환경 부트스트랩: `prisma migrate deploy` (운영) 또는 `prisma migrate dev` (로컬 첫 셋업).

### 자주 하는 실수

- `migrate dev` 후 `generate` 빠뜨려서 IDE 에 새 모델 타입이 안 보임 → `npx prisma generate` 수동 실행.
- 클라이언트 import 가 `@prisma/client` 가 아닌 다른 경로로 되어 있으면 `prisma generate` 의 output path 확인.

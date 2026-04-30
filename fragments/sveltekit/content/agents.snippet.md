## SvelteKit

이 프로젝트는 SvelteKit 애플리케이션으로 취급한다.

### 라우팅

- 라우트는 `src/routes` 파일 시스템을 따른다.
- 페이지 데이터는 `+page.ts`/`+page.server.ts`, layout 데이터는 `+layout.ts`/`+layout.server.ts` 에 둔다.
- 서버 전용 데이터 접근은 `.server.ts` 또는 `$lib/server` 아래로 제한한다.

### 데이터와 액션

- mutation 은 form actions (`+page.server.ts` 의 `actions`) 우선.
- `load` 는 필요한 데이터만 반환한다. secret 이 client 로 serialize 되지 않는지 확인한다.
- shared state 는 store/context 를 쓰되, request-specific state 를 module global 에 두지 않는다.

### 환경 변수

- private env 는 `$env/static/private` 또는 `$env/dynamic/private`.
- client 노출 env 는 `PUBLIC_` prefix 와 public env module 만 사용한다.

### 검증

- 프로젝트 scripts 우선: 보통 `npm run check`, `npm test`, `npm run build`.
- adapter 변경은 배포 타겟(Node, static, edge 등)에 맞는 runtime 제약을 확인한다.

### 흔한 실수

- server-only import 를 client bundle 로 끌어오기.
- `load` 에서 secret/token 반환하기.
- module global 에 request user/session 저장하기.
- adapter runtime 에 없는 Node API 사용하기.

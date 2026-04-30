## Nuxt

이 프로젝트는 Nuxt 애플리케이션으로 취급한다.

### 구조

- 페이지 라우팅은 `pages/`, 서버 API 는 `server/api` 또는 `server/routes` 를 따른다.
- shared logic 은 `composables/` 로, server-only logic 은 `server/` 아래로 둔다.
- plugin 은 `plugins/` 에 두고 client/server suffix 로 실행 위치를 명확히 한다.

### 데이터와 설정

- runtime 설정은 `runtimeConfig` 를 사용한다. public 값만 `runtimeConfig.public` 에 둔다.
- server API 에서 secret 을 client payload 로 반환하지 않는다.
- `useFetch`/`useAsyncData` key 와 caching/revalidation 의도를 확인한다.

### 미들웨어와 렌더링

- route middleware 는 인증/redirect 같은 routing concern 에 제한한다.
- SSR/SPA/static target 과 Nitro preset 을 확인한 뒤 Node API 사용 여부를 판단한다.

### 검증

- 프로젝트 scripts 우선: `npm run build`, typecheck/check script 가 있으면 함께 실행.
- Nitro/server route 변경은 local preview 또는 app-specific integration test 로 확인한다.

### 흔한 실수

- private runtimeConfig 를 public 으로 노출.
- composable 에 server-only dependency 를 섞어 client bundle 에 포함.
- middleware 에 heavy data fetching 넣기.
- deployment preset 과 맞지 않는 Node API 사용.

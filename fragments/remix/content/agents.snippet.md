## Remix

이 프로젝트는 Remix 애플리케이션으로 취급한다.

### 라우트 모듈

- route module 은 UI, `loader`, `action`, `meta`, `headers`, error boundary 를 함께 둔다.
- server-only code 는 loader/action 또는 `.server` module 에 둔다.
- client-only code 는 `.client` module 또는 browser guard 를 사용한다.

### 데이터와 mutation

- 읽기는 `loader`, 쓰기는 `action` 이 기본이다.
- form submission 과 progressive enhancement 를 우선한다. 불필요한 client state/data fetching layer 를 추가하지 않는다.
- session/cookie 변경은 response header commit 까지 확인한다.

### 경계

- nested route 별 ErrorBoundary/CatchBoundary 역할을 고려한다.
- route file naming convention 은 현재 프로젝트의 Remix 버전과 router 설정을 따른다.

### 검증

- 프로젝트 scripts 우선: `npm test`, `npm run build`, typecheck script 가 있으면 함께 실행.
- deployment target 이 Node 가 아니면 runtime API 제약을 확인한다.

### 흔한 실수

- loader 에서 secret 포함 객체를 그대로 반환.
- action 이 mutation 후 redirect/revalidation 흐름을 명확히 하지 않음.
- session commit 누락.
- server-only dependency 를 client import 경로로 노출.

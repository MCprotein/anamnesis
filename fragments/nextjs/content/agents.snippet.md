## Next.js

이 프로젝트는 Next.js 사용. App Router 가 기본 가정.

### Router 선택

- **App Router** (`app/`) 가 기본. 새 코드는 여기서.
- Pages Router (`pages/`) 는 레거시 또는 점진 마이그레이션 중일 때만.
- 두 router 동시 사용은 가능하지만 새로운 라우트는 app/ 에만.

### Server vs Client Components

- **Server Components 가 기본**. import 의존성 큰 파일이 자동으로 서버에서 처리되어 번들 작아짐.
- `'use client'` 디렉티브는 다음 중 하나일 때만:
  - `useState`/`useEffect`/`useReducer`/`useContext` 등 React 훅 사용
  - 브라우저 API 사용 (`window`, `localStorage`, `IntersectionObserver`)
  - 이벤트 핸들러 (`onClick`, `onChange`)
  - third-party 라이브러리가 client-only
- `'use client'` 는 import 그래프에 클라이언트 경계를 만든다. 서버에서 렌더링해 `children`/props 로 전달한 Server Component 까지 자동 전환하지는 않는다. 인터랙티브 부분은 작은 Client Component 로 분리한다.

### Data Fetching

| 위치 | 방법 |
|---|---|
| RSC (server component) | 그냥 `async/await` + `fetch(url, { next: { revalidate: N } })` |
| Client component | SWR 또는 TanStack Query |
| Mutation | Server Actions (`'use server'`) 또는 Route Handler |

- `getServerSideProps` / `getStaticProps` 는 Pages Router 만. App Router 에선 RSC 의 `fetch` 가 동등.
- 같은 데이터를 여러 컴포넌트가 fetch 해도 Next.js 가 자동 dedupe (request memoization).

### 라우팅 표면

- 페이지: `app/<route>/page.tsx`
- 레이아웃: `app/<route>/layout.tsx` (다음 페이지 진입 시 재렌더 안 함)
- Template: `app/<route>/template.tsx` (매 진입 시 재렌더 — 의도적인 경우만)
- Loading UI: `app/<route>/loading.tsx`
- Error: `app/<route>/error.tsx` — **반드시 client component** (`'use client'`)
- Not found: `app/<route>/not-found.tsx`
- API: `app/<route>/route.ts` (`GET`/`POST`/등 export). Pages Router 의 `pages/api/` 대체.

### 최적화 wrapper 사용 강제

- **이미지**: `next/image` 사용. `<img>` 직접 금지 (자동 최적화·lazy load 손실).
- **폰트**: `next/font` (`next/font/google`, `next/font/local`). `<link rel="font">` 수동 금지.
- **외부 스크립트**: `next/script` (loading strategy 컨트롤). 일반 `<script>` 직접 사용 금지.
- **메타데이터**: `export const metadata` 또는 `generateMetadata`. `<head>` 수동 편집 금지.

### 미들웨어

- 설치된 버전 확인: Next.js 15의 `middleware.ts` 는 루트 또는 `src/`에서 `app/`·`pages/`와 같은 수준에 둔다. Next.js 16은 `proxy.ts` 전환 가이드를 따른다.
- Next.js 15 middleware는 기본 Edge이며 15.5부터 Node runtime도 지원한다. Next.js 16 proxy는 Node runtime을 사용한다. Edge로 실행할 때는 Node 전용 API를 사용하지 않는다.
- matcher 명시 (`config.matcher`) 로 적용 범위 좁힘. 모든 요청에 도는 미들웨어는 콜드 스타트 오래 걸림.

### 환경 변수

- 기본은 서버 전용. 클라이언트에 노출하려면 `NEXT_PUBLIC_` 접두.
- **`process.env.NEXT_PUBLIC_*` 를 server component 에서 사용 안 함** — 어차피 서버에선 일반 env 도 됨, 의도가 흐려짐. 클라이언트에 진짜 노출이 필요한 변수만 `NEXT_PUBLIC_` 표시.
- 빌드 시점 vs 런타임: `NEXT_PUBLIC_*` 은 빌드 시점에 인라인됨 → 런타임 변경 안 됨.

### 자주 하는 실수

- root layout의 client import 범위를 불필요하게 넓혀 번들을 키우기.
- `<img>` 사용 → CWV (LCP) 점수 저하.
- Pages Router 의 `getServerSideProps` 패턴을 App Router 로 가져옴 → RSC 의 자연스러운 fetch 패턴 무시.
- `error.tsx` 에 `'use client'` 안 붙임 → boundary 에서 에러 핸들 못 함.
- Edge middleware에서 Node 전용 API 사용 → 런타임 오류.

### 검증

- 프로젝트의 build/lint 스크립트를 확인한다. Next.js 16에는 `next lint`가 없으므로 ESLint/Biome을 직접 실행하며, `next build`를 lint 검증으로 간주하지 않는다.
- 버전별 근거: [Next.js 15 middleware](https://nextjs.org/docs/15/app/api-reference/file-conventions/middleware), [Next.js 16 전환](https://nextjs.org/docs/app/guides/upgrading/version-16), [Server/Client 경계](https://nextjs.org/docs/app/getting-started/server-and-client-components).

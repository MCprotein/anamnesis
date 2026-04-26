## NestJS

이 프로젝트는 NestJS 사용. 다음 운영 규칙을 따른다.

### 계층 분리

- **Controller**: HTTP/WS 진입점. 비즈니스 로직 금지. 요청 파싱·인증 통과 확인·서비스 호출·응답 직렬화만.
- **Service**: 비즈니스 로직의 단일 위치. 다른 service 호출 OK, controller 호출 금지.
- **Module**: 의존성 그래프의 단위. `imports`/`providers`/`exports` 만 두고 로직 없음.
- **Repository / Prisma**: 데이터 접근만. service 가 사용.

레이어 역전 (controller → repo 직접 호출 등) 금지.

### 입력 검증

- HTTP 입력은 항상 DTO 클래스 + `class-validator` 데코레이터로 검증.
- `ValidationPipe` 를 글로벌 등록 (`app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))`).
- `whitelist: true` → 선언 안 된 속성 자동 제거.

### Guards · Interceptors · Pipes

- 인증/인가는 Guard. service 안에서 인증 체크 금지.
- 횡단 관심사 (로깅, 응답 변환, 캐시) 는 Interceptor.
- 변환·검증은 Pipe.
- **순서**: Middleware → Guard → Interceptor (pre) → Pipe → Handler → Interceptor (post) → Filter.

### 의존성 주입

- 생성자 주입만 사용. 프로퍼티 주입 (`@Inject()` field) 지양.
- circular dependency 발생 시 모듈 구조부터 재고. `forwardRef` 는 최후 수단.

### 테스트

- service 단위 테스트: 의존성을 mock 으로 갈아끼움 (`Test.createTestingModule(...).overrideProvider(...).useValue(...)`).
- e2e 테스트: 실제 서버 부팅, `supertest`. DB 는 docker-compose 또는 testcontainers.

### 흔한 실수

- controller 에 비즈니스 로직 넣고 service 에 그냥 위임만 시킴 → 잘못된 분리.
- DTO 없이 `@Body() body: any` → 검증 우회.
- `ConfigService` 안 쓰고 `process.env.X` 직접 → 타입·검증 안 됨.

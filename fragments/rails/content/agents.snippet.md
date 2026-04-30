## Rails

이 프로젝트는 Ruby on Rails 애플리케이션으로 취급한다.

### 경계

- 모델은 persistence, validation, domain invariant 중심으로 둔다.
- 컨트롤러는 HTTP orchestration 만 담당한다. 복잡한 비즈니스 흐름은 service/form/query object 같은 명시적 객체로 분리한다.
- view helper 는 표시 로직만 둔다. DB query 나 외부 API 호출을 넣지 않는다.

### 데이터 변경

- DB 변경은 migration 으로만 수행한다. schema 파일 직접 편집 금지.
- migration 은 되돌릴 수 있게 작성한다. destructive change 는 deploy 순서를 고려한다.
- validation 과 database constraint 를 함께 고려한다. uniqueness 는 DB unique index 없이 검증만 두지 않는다.

### Rails 런타임

- 프로젝트 제공 binstub 우선: `bin/rails`, `bin/rake`, `bin/bundle`.
- credentials/secrets 는 `config/credentials*` 와 환경 변수를 확인한다. 로그에 secret 출력 금지.
- background work 는 Active Job adapter 와 queue 설정을 확인한 뒤 변경한다.

### 검증

- 변경 후 가능한 경우 `bin/rails test`, `bin/rails db:migrate:status`, `bin/rails routes` 로 확인한다.
- JavaScript/CSS 파이프라인이 있으면 프로젝트의 `package.json` scripts 도 함께 확인한다.

### 흔한 실수

- controller action 에 여러 model update 와 외부 호출을 직접 넣기.
- callback 에 네트워크 호출이나 복잡한 side effect 넣기.
- migration 에서 현재 application model 을 직접 사용해 미래 schema 와 충돌 만들기.
- N+1 query 를 view 렌더링 뒤늦게 발견하기.

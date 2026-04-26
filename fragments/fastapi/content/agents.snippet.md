## FastAPI

이 프로젝트는 FastAPI 사용. 다음 규칙을 따른다.

### 입력·출력 스키마

- 모든 request/response 본문은 Pydantic `BaseModel` 로 정의. dict/raw json 직접 다루지 않음.
- response_model 명시: `@app.get("/x", response_model=UserOut)` — output 형태를 강제하고 문서·테스트 일관성 확보.
- Pydantic v2 가정. `model_config = ConfigDict(...)` 로 설정. `Config` class 구식.

### 의존성 주입

- 공유 자원 (DB session, 인증된 사용자, 설정) 은 `Depends` 로 주입.
- 핸들러 함수에 직접 import 해서 사용 금지 — 테스트 시 override 어려워짐.
- override: `app.dependency_overrides[get_db] = lambda: test_db`.

### async 우선

- I/O 가 있는 path operation 은 `async def`. CPU-bound 또는 동기 라이브러리만 쓰는 경우만 `def`.
- DB: SQLAlchemy 2.x async 또는 asyncpg 등 async 드라이버.
- requests 가 아니라 httpx (async 지원).

### 에러 처리

- 비즈니스 로직 실패는 `HTTPException` 으로 변환 (status_code + detail).
- 글로벌 예외 핸들러: `@app.exception_handler(SpecificError)` 로 도메인 예외 → HTTP 매핑.
- validation 실패는 FastAPI 가 자동 422 — 수동 처리 금지.

### 라우팅

- `APIRouter` 로 도메인별 분리. `app.include_router(users_router, prefix="/users", tags=["users"])`.
- 큰 앱: `routers/` 디렉토리에 도메인별 모듈.

### 흔한 실수

- `BaseModel` 대신 dict 받기 → 검증 우회, OpenAPI 문서 부정확.
- 동기 DB 드라이버 + `async def` 핸들러 → 이벤트 루프 블로킹.
- `Depends` 안 쓰고 모듈 전역에 DB 객체 만들기 → 테스트 격리 안 됨.
- `BackgroundTasks` 로 무거운 작업 위임 → 같은 프로세스라 차단됨; Celery/Arq 같은 외부 큐 권장.

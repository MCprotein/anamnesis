## Go

이 프로젝트는 Go module/service 로 취급한다.

### 구조

- executable entrypoint 는 보통 `cmd/<name>/main.go` 에 둔다.
- 외부에서 import 하지 않을 구현은 `internal/` 아래에 둔다.
- package 이름은 짧고 구체적으로 유지한다. `utils`, `common` 같은 포괄 이름은 피한다.

### 런타임 경계

- request-scoped work 는 `context.Context` 를 첫 번째 인자로 전달한다.
- interface 는 소비하는 package 쪽에 작게 정의한다. 구현 package 에 큰 interface 를 먼저 만들지 않는다.
- config 는 startup 에서 파싱하고 명시적으로 주입한다. 전역 mutable config 를 피한다.

### 에러 처리

- 에러를 무시하지 않는다. 필요한 경우 `%w` 로 wrapping 해서 호출자가 판별 가능하게 한다.
- panic 은 programmer error 나 process-fatal startup failure 에만 사용한다.
- goroutine 은 cancellation 경로와 error reporting 경로를 함께 가진다.

### 검증

- 변경 후 `gofmt`/`go fmt ./...`, `go test ./...` 를 우선 확인한다.
- race 가능성이 있는 concurrency 변경은 `go test -race ./...` 를 고려한다.

### 흔한 실수

- goroutine leak: context cancel 을 보지 않거나 channel close ownership 이 불명확함.
- package 간 import cycle 을 service layer 로 감추려다 더 키움.
- nil interface 와 nil pointer 를 혼동.
- HTTP handler 에 parsing, validation, persistence 를 모두 직접 넣기.

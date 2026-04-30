## Rust

이 프로젝트는 Rust/Cargo 프로젝트로 취급한다.

### 구조

- binary entrypoint 는 `src/main.rs` 또는 `src/bin/*.rs`, library API 는 `src/lib.rs` 에 둔다.
- module 공개 범위는 좁게 유지한다. `pub` 은 외부 contract 일 때만 사용한다.
- workspace 프로젝트는 각 crate 의 책임과 feature graph 를 먼저 확인한다.

### 오류와 타입

- 실패 가능한 함수는 `Result<T, E>` 를 반환한다. library code 에서 임의 `unwrap()`/`expect()` 금지.
- application boundary 에서는 context 를 붙여 에러를 보고하고, library boundary 에서는 호출자가 다룰 수 있는 error type 을 제공한다.
- ownership/borrowing 으로 해결 가능한 상태 공유를 `Arc<Mutex<_>>` 로 먼저 감싸지 않는다.

### async

- async runtime 은 하나로 유지한다. Tokio/async-std 혼용 금지.
- blocking I/O 또는 CPU-heavy work 를 async executor thread 에 직접 올리지 않는다.
- spawned task 는 cancellation/drop/error reporting 경로를 가진다.

### 검증

- 변경 후 `cargo fmt`, `cargo test`, 가능하면 `cargo clippy --all-targets --all-features` 를 확인한다.
- public API 또는 feature flag 변경은 downstream impact 를 별도로 적는다.

### 흔한 실수

- lifetime 문제를 피하려고 불필요한 clone/Arc 를 남발.
- library 내부에서 panic 으로 recoverable error 처리.
- feature flag 추가 후 default/features 조합 테스트 누락.
- async 함수 안에서 blocking filesystem/network 호출.

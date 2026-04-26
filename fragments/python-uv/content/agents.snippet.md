## Python (uv)

이 프로젝트는 [`uv`](https://docs.astral.sh/uv/) 로 의존성·환경 관리. 다음 규칙을 따른다.

### Source of truth

- `pyproject.toml` 이 의존성의 단일 진실. `requirements.txt` 가 별도로 있으면 generated artifact 로 취급.
- `uv.lock` 은 lock 파일 — **반드시 commit**. 직접 편집 금지.
- 의존성 추가/제거: `uv add <pkg>` / `uv remove <pkg>` (pyproject + lock 같이 갱신).

### 실행

- 항상 `uv run <command>` 사용. venv 직접 activate 하지 말 것.
  - `uv run python script.py`
  - `uv run pytest`
  - `uv run ruff check`
- 환경 동기화: `uv sync` (lock 기준 venv 정확히 맞춤). `--frozen` 으로 lock 갱신 없이.
- Python 버전: `pyproject.toml` 의 `requires-python` 또는 `.python-version` 으로 고정. uv 가 자동 다운로드.

### 금지

- `pip install <pkg>` — pyproject 와 lock 이 어긋남.
- `pip freeze > requirements.txt` 후 거기서 의존성 추적 — uv 가 source of truth.
- 시스템 Python 으로 직접 실행 (`python script.py`) — venv 우회.
- `uv pip install` 도 우회로 자주 쓰지만 **로컬 임시 실험 외에 운영 코드에선 금지** (lock 안 됨).

### 새 환경 부트스트랩

```bash
uv sync          # lock 기준 venv 생성/동기화 + 의존성 설치
uv run pytest    # 즉시 실행 가능
```

### 자주 하는 실수

- `uv add` 후 `uv lock` 또는 `uv sync` 누락 → 다른 머신에서 깨짐.
- CI 에서 `uv sync --frozen` 안 쓰고 일반 `uv sync` → lock 변경이 무시되거나 갱신됨.
- `pre-commit` 같은 도구를 시스템 설치 → `uv tool install pre-commit` 으로 격리.

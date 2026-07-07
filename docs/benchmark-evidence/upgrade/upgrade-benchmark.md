# Upgrade Benchmark Evidence

Generated: 2026-07-07T14:46:10.762Z

Deterministic, public-safe benchmark for existing-project upgrade behavior. It runs sanitized fixtures through init/update/status/doctor paths and records numeric pass/fail dimensions separately from convenience summaries.

Summary:
- fixtures: 6
- runs: 18
- pass rate: 100%
- failures: 0
- post-upgrade pending writes: 0
- doctor errors: 0
- manifest drift count: 0
- choice executions: 6
- choice previews required: 3
- unsupported choices: 0

| Fixture | Runs | Pass rate | Avg ms | Max ms | Pending | Doctor errors | Drift | Choice exec | Choice preview | Unsupported |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Clean old project without settings | 3 | 100% | 16.65 | 29.86 | 0 | 0 | 0 | 0 | 0 | 0 |
| Choice execution command | 3 | 100% | 15.95 | 18.09 | 0 | 0 | 0 | 6 | 3 | 0 |
| Pinned historical fragment archive | 3 | 100% | 7.71 | 8.1 | 0 | 0 | 0 | 0 | 0 | 0 |
| Partial adapter choice | 3 | 100% | 10.12 | 11.89 | 0 | 0 | 0 | 0 | 0 | 0 |
| Stale Codex hook refresh | 3 | 100% | 10.85 | 12.52 | 0 | 0 | 0 | 0 | 0 | 0 |
| Suggested-but-declined fragment | 3 | 100% | 6.25 | 6.44 | 0 | 0 | 0 | 0 | 0 | 0 |

Claim boundary:
- This benchmark proves deterministic CLI upgrade behavior for sanitized fixtures only.
- It does not prove real private-project compatibility or package registry publishing health.
- Stronger compatibility claims require keeping this matrix green and adding fixtures when published project shapes change.

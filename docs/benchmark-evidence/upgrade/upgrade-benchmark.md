# Upgrade Benchmark Evidence

Generated: 2026-07-07T14:11:13.827Z

Deterministic, public-safe benchmark for existing-project upgrade behavior. It runs sanitized fixtures through init/update/status/doctor paths and records numeric pass/fail dimensions separately from convenience summaries.

Summary:
- fixtures: 5
- runs: 15
- pass rate: 100%
- failures: 0
- post-upgrade pending writes: 0
- doctor errors: 0
- manifest drift count: 0

| Fixture | Runs | Pass rate | Avg ms | Max ms | Pending | Doctor errors | Drift |
|---|---:|---:|---:|---:|---:|---:|---:|
| Clean old project without settings | 3 | 100% | 13.06 | 23.39 | 0 | 0 | 0 |
| Pinned historical fragment archive | 3 | 100% | 7.71 | 7.94 | 0 | 0 | 0 |
| Partial adapter choice | 3 | 100% | 8.52 | 10.2 | 0 | 0 | 0 |
| Stale Codex hook refresh | 3 | 100% | 11.07 | 13.05 | 0 | 0 | 0 |
| Suggested-but-declined fragment | 3 | 100% | 4.95 | 5.25 | 0 | 0 | 0 |

Claim boundary:
- This benchmark proves deterministic CLI upgrade behavior for sanitized fixtures only.
- It does not prove real private-project compatibility or package registry publishing health.
- Stronger compatibility claims require keeping this matrix green and adding fixtures when published project shapes change.

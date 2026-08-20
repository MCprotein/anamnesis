# Work Continuity Before/After Benchmark

Generated: 2026-08-20T05:59:22.963Z

Same sanitized scenario: 20 requirements, 10 verified transitions, then a compaction/resume boundary retaining 8 recent facts when Work continuity is disabled.
Comparison mode: retention-stress. The default keeps all current facts in both conditions; a smaller explicit compact window is a retention-stress experiment, not an attributable before/after quality claim.

| Metric | Disabled | Enabled | Delta (enabled-disabled) |
|---|---:|---:|---:|
| Requirement recall | 40% | 100% | +60 pp |
| Status accuracy | 100% | 100% | 0 pp |
| Progress error | 50 pp | 0 pp | -50 pp |
| Resume latency | 0.06 ms | 27.92 ms | +27.86 ms |
| Resume latency p50/p95 | 0.04/0.09 ms | 27.28/29.65 ms | — |
| Resume payload | 657 B | 7190 B | +6533 B |
| Durable storage | 657 B | 18743 B | +18086 B |

Claim boundary:
- Quality values are deterministic structural recovery from the same logical end state and scenario, not measured model intelligence.
- Disabled reopens a persisted JSON handoff; enabled reopens and refolds the authoritative Work ledger, builds the briefing, and constructs the same consumer-state metrics.
- Condition order alternates between runs. Reports include averages plus p50/p95/min/max latency distributions.
- Latency and byte values are local-machine measurements. Repeat on the target host before making performance claims.
- Real agent task success and token use require paired repeated model runs using the existing task-compare/task-series harness.

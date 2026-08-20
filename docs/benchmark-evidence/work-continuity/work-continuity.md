# Work Continuity Before/After Benchmark

Generated: 2026-08-20T06:59:04.089Z

Same sanitized scenario: 20 requirements, 10 verified transitions, then a compaction/resume boundary retaining 20 recent facts when Work continuity is disabled.
Comparison mode: equal-facts. The default keeps all current facts in both conditions; a smaller explicit compact window is a retention-stress experiment, not an attributable before/after quality claim.

| Metric | Disabled | Enabled | Delta (enabled-disabled) |
|---|---:|---:|---:|
| Requirement recall | 100% | 100% | 0 pp |
| Status accuracy | 100% | 100% | 0 pp |
| Progress error | 0 pp | 0 pp | 0 pp |
| Resume latency | 0.14 ms | 15.92 ms | +15.78 ms |
| Resume latency p50/p95 | 0.12/0.21 ms | 15.74/18.65 ms | — |
| Resume payload | 1651 B | 7190 B | +5539 B |
| Durable storage | 1651 B | 18743 B | +17092 B |

Claim boundary:
- Quality values are deterministic structural recovery from the same logical end state and scenario, not measured model intelligence.
- Disabled reopens a persisted JSON handoff; enabled reopens and refolds the authoritative Work ledger, builds the briefing, and constructs the same consumer-state metrics.
- Condition order alternates between runs. Reports include averages plus p50/p95/min/max latency distributions.
- Latency and byte values are local-machine measurements. Repeat on the target host before making performance claims.
- Real agent task success and token use require paired repeated model runs using the existing task-compare/task-series harness.

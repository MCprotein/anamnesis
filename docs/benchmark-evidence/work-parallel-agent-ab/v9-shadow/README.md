# Harness-orchestrated parallel-agent Work A/B

- Generated: 2026-08-27T13:50:10.130Z
- Protocol: `shadow` (diagnostic only)
- Model: `gpt-5.6-luna` (reasoning effort: high)
- Implementation: `52cce256cbd0cc5beb49739c8f34435e2291cfdd`
- Prior paid attempts: 0
- Scenarios: clean-partition, stale-cross-session-conflict, review-gate-recovery
- Pairs: 3
- Planned/actual invocations: 24/24
- Harness validity: **FAIL**
- Diagnostic contract: **FAIL**
- Product verdict: **INVALID**
- Enabled audit/reviewer/final quality gate: **FAIL** (0/3)

![Parallel-agent gpt-5.6-luna benchmark](work-parallel-agent-ab-summary.svg)

| Condition | Exact reviewed pipelines | Child accuracy | Reviewer accuracy | Final accuracy | Critical path/run | Tokens/run |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Work disabled | 0/3 | 100% | 0% | 0% | 58670.1 ms | 132143.67 |
| Work enabled | 0/3 | 100% | 0% | 0% | 64624.34 ms | 147948 |

| Scenario family | Pairs | Disabled accuracy | Enabled accuracy | Delta | Audit exact | Reviewer exact | Final exact |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| clean-partition | 1 | 0% | 0% | 0pp | 0/1 | 0/1 | 0/1 |
| stale-cross-session-conflict | 1 | 0% | 0% | 0pp | 0/1 | 0/1 | 0/1 |
| review-gate-recovery | 1 | 0% | 0% | 0pp | 0/1 | 0/1 | 0/1 |

Enabled won **0/3**, tied **3/3**, and lost **0/3**. Mean final-accuracy delta: **0pp**; exact one-sided sign-test p-value: **1**.

| Preregistered gate | Result |
| --- | --- |
| Harness validity | FAIL |
| Accuracy and per-family floor | PASS |
| Absolute quality | FAIL |
| Tokens (aggregate ≤+5%, p50 ≤+5%, bootstrap upper ≤+10%) | FAIL — p50 -0.33%, upper +11.72% |
| Combined child tokens (p50 ≤0%, bootstrap upper ≤+5%) | p50 -2.88%, upper -2.45% |
| Reviewer tokens (p50 ≤0%, bootstrap upper ≤+5%) | p50 -0.1%, upper +36.81% |
| Stage token gate | FAIL |
| Critical path (p50 ≤+10%, bootstrap upper ≤+20%) | PASS — p50 +2.74%, upper +8.52% |

Audit digests are opaque code-generated fingerprints; the public aggregate artifact does not contain enough raw data to recompute them independently.

## Claim boundary

Validate and shadow protocols are never claim eligible. Their verdict remains INCONCLUSIVE even when the separate diagnostic contract passes. The harness launches separate Codex processes and proves child interval overlap; it does not measure same-session native subagent spawning. Audit digests and aggregate summaries are code-verified, but raw model answers are intentionally not published and therefore are not externally reconstructable from this artifact alone. All stage costs and failures are retained. No prompts, answers, stderr, PIDs, fixture bodies, or host paths are published.

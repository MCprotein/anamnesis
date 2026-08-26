# Harness-orchestrated parallel-agent Work A/B

- Generated: 2026-08-26T15:16:28.079Z
- Protocol: `shadow` (diagnostic only)
- Model: `gpt-5.6-luna` (reasoning effort: high)
- Implementation: `0cebfdacb7568eeef6eaebafa842b245bec36a9e`
- Prior final attempts: 0
- Scenarios: clean-partition, stale-cross-session-conflict, review-gate-recovery
- Pairs: 3
- Planned/actual invocations: 24/24
- Harness validity: **PASS**
- Product verdict: **INCONCLUSIVE**
- Enabled absolute-quality gate: **FAIL** (2/3)

![Parallel-agent gpt-5.6-luna benchmark](work-parallel-agent-ab-summary.svg)

| Condition | Exact reviewed pipelines | Child accuracy | Reviewer accuracy | Final accuracy | Critical path/run | Tokens/run |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Work disabled | 3/3 | 99.31% | 100% | 100% | 75740.26 ms | 159299.67 |
| Work enabled | 2/3 | 100% | 100% | 100% | 73108.95 ms | 148762.33 |

| Scenario family | Pairs | Disabled accuracy | Enabled accuracy | Delta | Reviewer exact | Final exact |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| clean-partition | 1 | 100% | 100% | 0pp | 1/1 | 1/1 |
| stale-cross-session-conflict | 1 | 100% | 100% | 0pp | 1/1 | 1/1 |
| review-gate-recovery | 1 | 100% | 100% | 0pp | 0/1 | 1/1 |

Enabled won **0/3**, tied **3/3**, and lost **0/3**. Mean final-accuracy delta: **0pp**; exact one-sided sign-test p-value: **1**.

| Preregistered gate | Result |
| --- | --- |
| Harness validity | PASS |
| Accuracy and per-family floor | FAIL |
| Absolute quality | FAIL |
| Tokens (aggregate ≤+5%, p50 ≤+5%, bootstrap upper ≤+10%) | PASS — p50 -1.14%, upper -5.12% |
| Combined child tokens (p50 ≤0%, bootstrap upper ≤+5%) | p50 -2.4%, upper -2.13% |
| Reviewer tokens (p50 ≤0%, bootstrap upper ≤+5%) | p50 -0.67%, upper -7.74% |
| Stage token gate | PASS |
| Critical path (p50 ≤+10%, bootstrap upper ≤+20%) | PASS — p50 -3.21%, upper -4.08% |

## Claim boundary

Validate and shadow protocols are never claim eligible. Their verdict remains INCONCLUSIVE even when harness and quality checks pass. The harness launches separate Codex processes and proves child interval overlap; it does not measure same-session native subagent spawning. All stage costs and failures are retained. No prompts, answers, stderr, PIDs, fixture bodies, or host paths are published.

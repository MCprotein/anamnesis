# Work agent A/B benchmark

- Generated: 2026-08-20T07:21:58.500Z
- Model: gpt-5.6-luna
- Repetitions per scenario: 3
- Planned initial Codex invocations: 36
- Actual invocations including oracle corrections: 52
- Equal-information scenarios: perfect-handoff, delegation-review, requirement-scale-100
- Resilience scenarios: bounded-loss, stale-conflict, multi-session-handoff
- Contract: PASS

| Metric | Disabled | Enabled | Delta |
| --- | ---: | ---: | ---: |
| Total tokens (average/run) | 106587.5 | 80854.78 | -24.14% |
| Elapsed ms (average/run) | 43792.87 | 30265.02 | -30.89% |
| Completion correctness | 100% | 100% | 0pp |
| Gate correctness | 100% | 100% | — |
| Requirement recall | 100% | 100% | 0pp |
| Status recall | 73.33% | 100% | 26.67pp |
| Missed requirements (average/run) | 0 | 0 | 0 |
| Actual correction rounds (average/run) | 0.78 | 0.11 | -0.67 |
| Re-explained requirements (average/run) | 5.33 | 0 | — |

## Scenario breakdown

| Scenario | Class | Token delta | Elapsed delta | Disabled → enabled status accuracy | Disabled → enabled correction rounds/run |
| --- | --- | ---: | ---: | ---: | ---: |
| Perfect handoff | Equal information | -29.73% | -37.30% | 100% → 100% | 1.00 → 0.00 |
| Bounded loss | Resilience | -42.91% | -47.64% | 40% → 100% | 1.00 → 0.00 |
| Stale conflict | Resilience | -41.22% | -44.92% | 0% → 100% | 1.00 → 0.00 |
| Multi-session handoff | Resilience | +15.88% | +25.58% | 100% → 100% | 0.67 → 0.67 |
| Delegation/review | Equal information | +5.83% | +20.31% | 100% → 100% | 0.00 → 0.00 |
| 100 requirements | Equal information | -30.08% | -45.11% | 100% → 100% | 1.00 → 0.00 |

The multi-session case is the remaining cost regression in this sample. The
overall contract passes because the full suite improves correctness and total
cost, but this scenario should be re-measured with more pairs before claiming a
universal per-scenario reduction.

The evaluator stores aggregate metrics only. Prompts, fixture bodies, model answers, and stderr are intentionally excluded from artifacts.

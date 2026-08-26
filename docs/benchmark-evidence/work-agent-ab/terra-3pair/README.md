# Work agent A/B benchmark

> Cross-model diagnostic only (`n=3` per scenario). The checked-in Luna
> nine-pair strict artifact remains the release-quality baseline.

- Generated: 2026-08-26T08:35:41.259Z
- Model: gpt-5.6-terra
- Repetitions per scenario: 3
- Strict contract: disabled
- Planned initial Codex invocations: 36
- Actual invocations including oracle corrections: 46
- Equal-information scenarios: perfect-handoff, delegation-review, requirement-scale-100
- Resilience scenarios: bounded-loss, stale-conflict, multi-session-handoff
- Excluded model failures: 0
- Contract: PASS

| Metric | Disabled | Enabled | Delta |
| --- | ---: | ---: | ---: |
| Total tokens (average/run) | 105764.06 | 52035.61 | -50.8% |
| Elapsed ms (average/run) | 46186.95 | 25606.49 | -44.56% |
| Paired token delta | — | — | p50 -51.64%, p95 -0.16%, MAD 11.1% |
| Paired elapsed delta | — | — | p50 -45.64%, p95 -9.48%, MAD 14.19% |
| Completion correctness | 100% | 100% | 0pp |
| Gate correctness | 100% | 100% | — |
| Requirement recall | 97.78% | 100% | 2.22pp |
| Status recall | 71.11% | 100% | 28.89pp |
| Summary recall | 88.89% | 100% | — |
| Hallucinated requirements (average/run) | 0 | 0 | — |
| Duplicate requirement IDs (average/run) | 0 | 0 | — |
| Missed requirements (average/run) | 0.44 | 0 | -0.44 |
| Actual correction rounds (average/run) | 0.56 | 0 | -0.56 |
| Re-explained requirements (average/run) | 13.56 | 0 | — |

## Comparison classes

| Class | Token p50 (90% bootstrap CI) | Elapsed p50 (90% bootstrap CI) | Token wins |
| --- | ---: | ---: | ---: |
| equal_information | -33.49% (-53.2% to -0.44%) | -18.64% (-24.51% to -18.12%) | 9/9 |
| resilience | -60.24% (-60.88% to -50.08%) | -49.29% (-59.16% to -47.43%) | 9/9 |

## Scenario breakdown

| Scenario | Class | Token p50 (p95) | Elapsed p50 (p95) | Token wins | Disabled → enabled status accuracy | Disabled → enabled corrections/run |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| perfect-handoff | equal_information | -33.49% (-4.03%) | -18.64% (-18.17%) | 3/3 | 100% → 100% | 0 → 0 |
| bounded-loss | resilience | -49.77% (-40.71%) | -43.86% (-40.7%) | 3/3 | 26.67% → 100% | 1 → 0 |
| stale-conflict | resilience | -60.04% (-51.08%) | -56.93% (-49.1%) | 3/3 | 0% → 100% | 1 → 0 |
| multi-session-handoff | resilience | -60.88% (-60.68%) | -59.16% (-48.6%) | 3/3 | 100% → 100% | 0.67 → 0 |
| delegation-review | equal_information | -0.19% (-0.04%) | -10.5% (-4.37%) | 3/3 | 100% → 100% | 0 → 0 |
| requirement-scale-100 | equal_information | -61.49% (-54.03%) | -51.44% (-21.69%) | 3/3 | 100% → 100% | 0.67 → 0 |

Every accepted answer contains each expected requirement exactly once with an exact ID, status, and summary; hallucinated or duplicate rows trigger deterministic correction. Each paired distribution also records min, max, MAD, and a deterministic 90% bootstrap interval in the JSON artifact. Model failures are scored, never excluded. Prompts, fixture bodies, model answers, and stderr are intentionally excluded from artifacts.

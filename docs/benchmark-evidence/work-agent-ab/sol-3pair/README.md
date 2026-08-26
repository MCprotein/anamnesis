# Work agent A/B benchmark

> Cross-model diagnostic only (`n=3` per scenario). The checked-in Luna
> nine-pair strict artifact remains the release-quality baseline.

- Generated: 2026-08-26T09:42:13.800Z
- Model: gpt-5.6-sol
- Repetitions per scenario: 3
- Strict contract: disabled
- Planned initial Codex invocations: 36
- Actual invocations including oracle corrections: 54
- Equal-information scenarios: perfect-handoff, delegation-review, requirement-scale-100
- Resilience scenarios: bounded-loss, stale-conflict, multi-session-handoff
- Excluded model failures: 0
- Contract: PASS

| Metric | Disabled | Enabled | Delta |
| --- | ---: | ---: | ---: |
| Total tokens (average/run) | 106632.39 | 49309.56 | -53.76% |
| Elapsed ms (average/run) | 55370.95 | 27151.08 | -50.97% |
| Paired token delta | — | — | p50 -50.06%, p95 -49.63%, MAD 0.34% |
| Paired elapsed delta | — | — | p50 -50.45%, p95 -39.58%, MAD 5.15% |
| Completion correctness | 100% | 100% | 0pp |
| Gate correctness | 100% | 100% | — |
| Requirement recall | 100% | 100% | 0pp |
| Status recall | 73.33% | 100% | 26.67pp |
| Summary recall | 16.67% | 100% | — |
| Hallucinated requirements (average/run) | 0.11 | 0 | — |
| Duplicate requirement IDs (average/run) | 0 | 0 | — |
| Missed requirements (average/run) | 0 | 0 | 0 |
| Actual correction rounds (average/run) | 1 | 0 | -1 |
| Re-explained requirements (average/run) | 33.33 | 0 | — |

## Comparison classes

| Class | Token p50 (90% bootstrap CI) | Elapsed p50 (90% bootstrap CI) | Token wins |
| --- | ---: | ---: | ---: |
| equal_information | -50.07% (-60.08% to -49.99%) | -50.82% (-51.9% to -49.65%) | 9/9 |
| resilience | -50.05% (-50.37% to -49.69%) | -49.55% (-55.67% to -43.45%) | 9/9 |

## Scenario breakdown

| Scenario | Class | Token p50 (p95) | Elapsed p50 (p95) | Token wins | Disabled → enabled status accuracy | Disabled → enabled corrections/run |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| perfect-handoff | equal_information | -49.98% (-49.85%) | -50.08% (-45.84%) | 3/3 | 100% → 100% | 1 → 0 |
| bounded-loss | resilience | -49.66% (-49.51%) | -43.45% (-40.32%) | 3/3 | 40% → 100% | 1 → 0 |
| stale-conflict | resilience | -50.05% (-49.99%) | -55.67% (-39.23%) | 3/3 | 0% → 100% | 1 → 0 |
| multi-session-handoff | resilience | -60.36% (-51.37%) | -53.27% (-49.92%) | 3/3 | 100% → 100% | 1 → 0 |
| delegation-review | equal_information | -50.02% (-49.99%) | -51.9% (-49.87%) | 3/3 | 100% → 100% | 1 → 0 |
| requirement-scale-100 | equal_information | -61.94% (-53.02%) | -50.82% (-49.61%) | 3/3 | 100% → 100% | 1 → 0 |

Every accepted answer contains each expected requirement exactly once with an exact ID, status, and summary; hallucinated or duplicate rows trigger deterministic correction. Each paired distribution also records min, max, MAD, and a deterministic 90% bootstrap interval in the JSON artifact. Model failures are scored, never excluded. Prompts, fixture bodies, model answers, and stderr are intentionally excluded from artifacts.

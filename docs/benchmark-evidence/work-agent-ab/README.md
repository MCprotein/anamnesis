# Work agent A/B benchmark

- Generated: 2026-08-25T12:04:59.398Z
- Model: gpt-5.6-luna
- Repetitions per scenario: 9
- Strict contract: enabled
- Planned initial Codex invocations: 108
- Actual invocations: 153 (108 initial calls + 45 oracle corrections)
- Equal-information scenarios: perfect-handoff, delegation-review, requirement-scale-100
- Resilience scenarios: bounded-loss, stale-conflict, multi-session-handoff
- Excluded model failures: 0
- Contract: PASS

![Work continuity strict real Codex A/B summary](work-agent-ab-summary.svg)

| Metric | Disabled | Enabled | Delta |
| --- | ---: | ---: | ---: |
| Total tokens (average/run) | 90901.72 | 45177.06 | -50.3% |
| Elapsed ms (average/run) | 46054.24 | 25703.4 | -44.19% |
| Paired token delta | — | — | p50 -50.08%, p95 -0.09%, MAD 1.69% |
| Paired elapsed delta | — | — | p50 -49.56%, p95 5.81%, MAD 6.52% |
| Completion correctness | 100% | 100% | 0pp |
| Gate correctness | 100% | 100% | — |
| Requirement recall | 99.26% | 100% | 0.74pp |
| Status recall | 72.59% | 100% | 27.41pp |
| Summary recall | 55.56% | 100% | — |
| Hallucinated requirements (average/run) | 0 | 0 | — |
| Duplicate requirement IDs (average/run) | 0 | 0 | — |
| Missed requirements (average/run) | 0.15 | 0 | -0.15 |
| Actual correction rounds (average/run) | 0.8 | 0.04 | -0.76 |
| Re-explained requirements (average/run) | 17.11 | 0.33 | — |

## Comparison classes

| Class | Token p50 (90% bootstrap CI) | Elapsed p50 (90% bootstrap CI) | Token wins |
| --- | ---: | ---: | ---: |
| equal_information | -50.11% (-52.49% to -49.96%) | -50.02% (-52.61% to -47.57%) | 27/27 |
| resilience | -50% (-50.29% to -49.77%) | -47.05% (-51.37% to -44.38%) | 26/27 |

## Scenario breakdown

| Scenario | Class | Token p50 (p95) | Elapsed p50 (p95) | Token wins | Disabled → enabled status recall | Disabled → enabled corrections/run |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| perfect-handoff | equal_information | -49.99% (-49.76%) | -50.02% (-44.58%) | 9/9 | 100% → 100% | 1 → 0 |
| bounded-loss | resilience | -49.68% (-49.43%) | -45.71% (-31.19%) | 9/9 | 35.56% → 100% | 1 → 0 |
| stale-conflict | resilience | -50% (0.33%) | -52.21% (11.24%) | 8/9 | 0% → 100% | 1 → 0.22 |
| multi-session-handoff | resilience | -51.04% (-34.27%) | -45.59% (-16.34%) | 9/9 | 100% → 100% | 0.67 → 0 |
| delegation-review | equal_information | -50.05% (-0.07%) | -51.1% (7.85%) | 9/9 | 100% → 100% | 0.67 → 0 |
| requirement-scale-100 | equal_information | -60.66% (-3.41%) | -41.87% (-0.23%) | 9/9 | 100% → 100% | 0.44 → 0 |

Every accepted answer contains each expected requirement exactly once with an exact ID, status, and summary; hallucinated or duplicate rows trigger deterministic correction. Each paired distribution also records min, max, MAD, and a deterministic 90% bootstrap interval in the JSON artifact. Model failures are scored, never excluded. Prompts, fixture bodies, model answers, and stderr are intentionally excluded from artifacts.

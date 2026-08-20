# Work agent A/B benchmark

- Generated: 2026-08-20T07:21:58.500Z
- Model: gpt-5.6-luna
- Repetitions per scenario: 3
- Planned initial Codex invocations: 36
- Actual invocations including oracle corrections: 52
- Equal-information scenarios: perfect-handoff, delegation-review, requirement-scale-100
- Resilience scenarios: bounded-loss, stale-conflict, multi-session-handoff
- Contract: PASS

![Work continuity real Codex A/B summary](work-agent-ab-summary.svg)

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

## Why two scenarios cost more

These are not accuracy regressions: both conditions reached `100%` requirement
and status accuracy in both scenarios. They are different kinds of cost signal.

### Multi-session handoff: correction-turn variance dominated three pairs

The disabled and enabled conditions each needed two correction turns across the
three pairs, but the corrections landed in different pairs. In enabled pairs 2
and 3, the extra turn raised total usage to roughly `125.8k` and `126.2k`
tokens. In pair 1, where enabled needed no correction, it used `62.8k` tokens
versus disabled's `104.3k`.

That distribution means the reported `+15.88%` is not evidence that Work has a
stable multi-session tax. It shows that one correction can dominate a
three-pair mean and that this scenario needs more repetitions, paired medians,
and confidence intervals before a directional claim. The product still has an
optimization target here: make the authoritative multi-session state obvious
enough that the model never asks for the extra verification turn.

### Delegation/review: fixed safety metadata with no sampled quality gain

The legacy condition described the missing delegation and review gates in one
short prose sentence. The Work condition supplied the same conclusion through
structured completion-contract, gate, policy, and authoritative retrieval
metadata. All six runs were correct on the first response, so there was no
correction cost for Work to eliminate.

The remaining `+5.83%` token and `+20.31%` elapsed deltas are therefore best
read as the fixed cost of stronger machine-checkable safety context in a small
case where concise prose happened to be sufficient. This is an equal-information
overhead measurement, not a quality win. Future optimization should compact the
gate payload and avoid unnecessary retrieval while preserving fail-closed gate
decisions.

The benchmark deliberately keeps both regressions visible. Aggregate savings
must not be used to imply universal per-scenario savings.

The evaluator stores aggregate metrics only. Prompts, fixture bodies, model answers, and stderr are intentionally excluded from artifacts.

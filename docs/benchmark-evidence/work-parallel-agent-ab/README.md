# Harness-orchestrated parallel-agent Work A/B

- Generated: 2026-08-26T11:52:00.815Z
- Model: `gpt-5.6-luna` (reasoning effort: high)
- Pairs per condition: 3
- Topology: leader plan → two concurrent children → authoritative reviewer repair → leader integration
- Planned/actual invocations: 30/30
- Harness validity: **PASS**
- Directional comparison: **PASS_DIRECTIONAL**
- Enabled absolute-quality gate: **FAIL** (2/3 exact reviewed pipelines)

![Parallel-agent gpt-5.6-luna diagnostic](work-parallel-agent-ab-summary.svg)

| Condition | Exact reviewed pipelines | Child accuracy | Reviewer accuracy | Final accuracy | Critical path/run | Tokens/run |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Work disabled | 1/3 | 33.33% | 33.33% | 33.33% | 66479.37 ms | 229987.33 |
| Work enabled | 2/3 | 100% | 100% | 100% | 84846.55 ms | 239106 |

Primary paired comparison: enabled won **2/3**, tied **1/3**, and lost **0/3** on final exact-requirement accuracy; median delta was **+24 requirements**. Paired cost deltas were **+2.63% tokens** (MAD 3.02pp) and **+17.88% critical-path time** (MAD 16.29pp). Cost dimensions are reported separately and do not determine the accuracy verdict.

## Claim boundary

This is a 3-pair directional diagnostic over one sanitized equal-information state-reconstruction scenario. `PASS_DIRECTIONAL` requires at least 2 paired accuracy wins, a median gain of at least one exact requirement, and no aggregate duplicate/unexpected-row regression. The harness launches separate Codex processes and proves that the two child intervals overlap; the current Codex CLI does not expose a stable automation contract for same-session native child spawning plus per-child token accounting. This result therefore does not measure native subagent spawning, statistical significance, or general coding productivity. All stage costs and failures are retained. No prompts, answers, stderr, PIDs, fixture bodies, or host paths are published.

# Harness-orchestrated parallel-agent Work A/B

- Generated: 2026-08-26T10:27:05.606Z
- Model: `gpt-5.6-luna` (reasoning effort: high)
- Pairs per condition: 3
- Topology: leader plan → two concurrent children → reviewer → leader integration
- Planned/actual invocations: 30/30
- Harness validity: **PASS**
- Product contract: **FAIL**

![Parallel-agent gpt-5.6-luna diagnostic](work-parallel-agent-ab-summary.svg)

| Condition | Product passes | Critical path/run | Agent elapsed/run | Child overlap/run | Tokens/run |
| --- | ---: | ---: | ---: | ---: | ---: |
| Work disabled | 0/3 | 44795.83 ms | 57797.9 ms | 13002.48 ms | 169260 |
| Work enabled | 2/3 | 46310.68 ms | 60815.44 ms | 14505.03 ms | 168927 |

Descriptive paired-pilot delta with Work: **-0.2% tokens**, **3.38% critical-path time**. Work improved complete-pipeline success from **0/3** to **2/3**, but this pilot does not establish a token or latency win.

## Claim boundary

This is a 3-pair directional diagnostic over one sanitized equal-information state-reconstruction scenario. The harness launches separate Codex processes and proves that the two child intervals overlap; it does not measure same-session native subagent spawning or general coding productivity. All stage costs are charged, and failed or malformed stages are retained. No prompts, answers, stderr, PIDs, fixture bodies, or host paths are published.

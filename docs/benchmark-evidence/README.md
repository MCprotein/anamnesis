# Benchmark Evidence

This directory contains generated public-safe benchmark data, reports, and
visualizations. The top-level README links here instead of embedding every
generated chart.

| Suite | Purpose | Report | Visualizations |
|---|---|---|---|
| Session context | Compare full SessionStart injection with compact source-pointer mode. | [`session-context/session-context.md`](session-context/session-context.md) | [`token-by-mode.svg`](session-context/token-by-mode.svg), [`payload-composition.svg`](session-context/payload-composition.svg), [`fixture-growth.svg`](session-context/fixture-growth.svg), [`cap-success-summary.svg`](session-context/cap-success-summary.svg) |
| Retrieval source pointers | Measure `context query` source-pointer ranking for public-safe `doc-page`, `doc-heading`, and `doc-ontology-ref` fixtures. | [`retrieval-source-pointers/retrieval-source-pointers.md`](retrieval-source-pointers/retrieval-source-pointers.md) | [`retrieval-hit-rates.svg`](retrieval-source-pointers/retrieval-hit-rates.svg), [`retrieval-ranks.svg`](retrieval-source-pointers/retrieval-ranks.svg) |
| Subagent injection | Measure separate-process context injection and same-session prompt-contract acceptance. | [`subagent-injection/subagent-injection.md`](subagent-injection/subagent-injection.md) | [`subagent-injection-counts.svg`](subagent-injection/subagent-injection-counts.svg), [`subagent-injection-rates.svg`](subagent-injection/subagent-injection-rates.svg) |
| Upgrade | Exercise sanitized existing-project upgrade fixtures and guided choice execution. | [`upgrade/upgrade-benchmark.md`](upgrade/upgrade-benchmark.md) | [`upgrade-pass-rate.svg`](upgrade/upgrade-pass-rate.svg), [`upgrade-duration.svg`](upgrade/upgrade-duration.svg) |
| Agent task | Store model-dependent retrieval and behavior diagnostics separately from deterministic README claims. | [`agent-task/series.md`](agent-task/series.md) | [`series-token-delta.svg`](agent-task/series-token-delta.svg), [`series-quality-summary.svg`](agent-task/series-quality-summary.svg), [`series-source-citation-delta.svg`](agent-task/series-source-citation-delta.svg) |

Machine-readable files:

- [`public-shapes.jsonl`](public-shapes.jsonl)
- [`session-context/session-context.json`](session-context/session-context.json)
- [`retrieval-source-pointers/retrieval-source-pointers.json`](retrieval-source-pointers/retrieval-source-pointers.json)
- [`subagent-injection/subagent-injection.json`](subagent-injection/subagent-injection.json)
- [`upgrade/upgrade-benchmark.json`](upgrade/upgrade-benchmark.json)
- [`agent-task/series.json`](agent-task/series.json)

Maintenance rule: generated benchmark artifacts stay in this directory or a
suite-specific child directory. Public README sections should summarize the
current headline numbers and link back here for raw reports and SVGs.

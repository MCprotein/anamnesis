# Retrieval Source-Pointer Benchmark — 2026-07-10T04:53:56.837Z

Deterministic benchmark for `context query` source-pointer ranking over public-safe docs and ontology references.

Cases: 6
Top-1 hit rate: 100% (6/6)
Top-3 hit rate: 100% (6/6)
MRR: 1.000
Compact SessionStart: 133/800 estimated tokens
Gate: pass

| Case | Kind | Query | Expected pointer | Rank | Top-1 | Top-3 |
|---|---|---|---|---:|---|---|
| README doc page | doc-page | Retrieval Fixture README canonical | README.md file | 1 | yes | yes |
| Architecture doc page | doc-page | checkout flow architecture payment worker | docs/architecture.md file | 1 | yes | yes |
| Checkout intent heading | doc-heading | checkout intent flow payment authorization | docs/architecture.md heading:checkout-intent-flow | 1 | yes | yes |
| Release automation heading | doc-heading | release automation checklist npm github generated drift | docs/architecture.md heading:release-automation-checklist | 1 | yes | yes |
| Payments ontology ref | doc-ontology-ref | reviewed semantic flow recorded payments ontology edits | docs/architecture.md Ontology ref .anamnesis/ontology/payments.yaml | 1 | yes | yes |
| System graph ontology ref | doc-ontology-ref | canonical top-level graph system graph | README.md Ontology ref system_graph.yaml | 1 | yes | yes |

## Charts

![Retrieval hit rates](retrieval-hit-rates.svg)
![Retrieval ranks](retrieval-ranks.svg)

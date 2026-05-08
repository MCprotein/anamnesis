# Benchmark Traces

`anamnesis benchmark trace --append` appends rollups here and writes a
`benchmark-trace-rollup` runtime evidence record to
`.anamnesis/evidence/events.jsonl`.

The source log is `.anamnesis/logs/benchmark-traces.jsonl` by default. Each
valid line uses `schema_version: anamnesis.benchmark_trace.v1` with at least
`generated_at`, `phase`, and `status`. Optional `duration_ms` and numeric
`metrics` fields are aggregated in the rollup.

<!-- append-only below -->

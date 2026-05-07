# Runtime Evidence

anamnesis records durable runtime evidence for checks that already append a
human-readable report.

## Store

- Path: `.anamnesis/evidence/events.jsonl`
- Schema: `anamnesis.evidence.v1`
- Format: append-only JSON Lines

## Current Writers

- `anamnesis dogfood check --append`
- `anamnesis benchmark report --append`
- `anamnesis benchmark compare --append`

Each record includes:

- `kind`: `dogfood-check`, `benchmark-report`, or `benchmark-compare`
- `generated_at`: ISO timestamp
- `command`: command that produced the evidence
- `project.name`: managed project name
- `summary`: compact machine-readable metrics
- `details`: optional structured check/layer details
- `artifacts`: related markdown report paths

Benchmark evidence records include `summary.scorecard` under schema
`anamnesis.benchmark.scorecard.v1`. The scorecard keeps raw dimensions visible
instead of reducing benchmark claims to an opaque aggregate: ready layers,
continuity checks, ontology gaps, doctor issues, Codex hook warnings, adapter
surfaces, and evidence freshness.

Benchmark compare evidence records include before/after scorecard deltas and
summary counts for improved, regressed, and unchanged dimensions.

## Reader

`anamnesis status` reads the evidence log and reports:

- total valid records
- invalid line count
- latest valid record kind and timestamp

## Boundary

This evidence layer is not a task runtime, HUD, queue, or orchestrator. It is
repo-local proof that dogfood and benchmark claims can consume without scraping
markdown prose.

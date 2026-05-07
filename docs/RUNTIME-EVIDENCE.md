# Runtime Evidence

anamnesis records durable runtime evidence for checks that already append a
human-readable report.

## Store

- Path: `.anamnesis/evidence/events.jsonl`
- Schema: `anamnesis.evidence.v1`
- Format: append-only JSON Lines

## Current Writers

- `anamnesis dogfood check --append`
- `anamnesis doctor --append`
- `anamnesis benchmark report --append`
- `anamnesis benchmark compare --append`
- `anamnesis benchmark task --append`
- `anamnesis benchmark prompt-gate --append`

Each record includes:

- `kind`: `dogfood-check`, `doctor-check`, `benchmark-report`,
  `benchmark-compare`, `agent-task-benchmark`, or `prompt-delta-gate`
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

Doctor evidence records use kind `doctor-check`. They capture the same
installation integrity, managed-drift, adapter wiring, Codex hook ownership,
continuity, and ontology-gap diagnostics that `anamnesis doctor` prints, with
summary error/warning counts and issue details.

Benchmark compare evidence records include before/after scorecard deltas and
summary counts for improved, regressed, and unchanged dimensions.

Agent task benchmark records use kind `agent-task-benchmark` and summary
schema `anamnesis.agent_task_benchmark.v1`. These records are explicitly
model-dependent and stay separate from deterministic benchmark scorecards.

Prompt delta gate records use kind `prompt-delta-gate` and summary schema
`anamnesis.prompt_delta_gate.v1`. They capture the decision to defer, collect
more evidence, or prototype Codex `UserPromptSubmit` context delta injection
based on continuity evidence, model-dependent task friction, estimated token
overhead, and duplicate-context risk.

## Reader

`anamnesis status` reads the evidence log and reports:

- total valid records
- invalid line count
- latest valid record kind and timestamp
- latest record age and stale state
- per-kind record counts, latest timestamps, age, and stale state

Evidence is marked stale after 7 days without a newer record for that latest
record or kind.

`anamnesis benchmark gallery --write` reads the same JSONL log plus any
sanitized `docs/benchmark-evidence/*.jsonl` artifacts and refreshes the
generated evidence region in `docs/BENCHMARK-GALLERY.md`. The generated region
lists current evidence entries, README claim candidates, and release warnings
such as missing before/after comparisons or insufficient public-safe repo
shapes. `anamnesis benchmark gallery --validate` exits non-zero when the
generated region is missing or stale. The gallery intentionally ignores
`doctor-check`, `agent-task-benchmark`, and `prompt-delta-gate` records.

## Boundary

This evidence layer is not a task runtime, HUD, queue, or orchestrator. It is
repo-local proof that dogfood and benchmark claims can consume without scraping
markdown prose.

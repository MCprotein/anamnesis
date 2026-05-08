# Runtime Evidence

anamnesis records durable runtime evidence for checks and write paths that
need machine-readable proof beyond terminal output.

## Store

- Path: `.anamnesis/evidence/events.jsonl`
- Schema: `anamnesis.evidence.v1`
- Format: append-only JSON Lines

## Current Writers

- `anamnesis dogfood check --append`
- `anamnesis doctor --append`
- `anamnesis hooks summary --append`
- `anamnesis init`
- `anamnesis update --apply`
- `anamnesis benchmark report --append`
- `anamnesis benchmark compare --append`
- `anamnesis benchmark trace --append`
- `anamnesis benchmark task --append`
- `anamnesis benchmark prompt-gate --append`

Each record includes:

- `kind`: `dogfood-check`, `doctor-check`, `hook-log-summary`,
  `init-install`, `update-apply`, `fragment-lifecycle`, `benchmark-report`,
  `benchmark-compare`, `benchmark-trace-rollup`, `agent-task-benchmark`, or
  `prompt-delta-gate`
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

Hook log summary records use kind `hook-log-summary`. They read
`.anamnesis/logs/hooks.jsonl` by default, summarize valid/invalid hook runtime
records by event and status, append markdown to `docs/HOOKS.md`, and write
machine-readable summary evidence. Valid hook log lines use
`schema_version: anamnesis.hook_log.v1` and must include `generated_at`,
`event`, and `status`.

Init evidence records use kind `init-install` and are written automatically
only when `anamnesis init` writes files. `anamnesis init --dry-run` stays
read-only and does not touch the evidence log. The record captures selected
fragments, installed tools, planned change counts, monorepo detection,
post-install bootstrap outcomes, hook registration outcomes, and install flags.

Update evidence records use kind `update-apply` and are written automatically
only for `anamnesis update --apply`. Dry-runs stay read-only and do not touch
the evidence log. The record captures change counts, suggested fragment count,
backup/prune counts, Claude/Codex hook registration outcomes, and apply flags.

Fragment lifecycle records use kind `fragment-lifecycle` and are written
alongside successful `init` and `update --apply` runs. Summary schema
`anamnesis.fragment_lifecycle.v1` counts local events such as `installed`,
`updated`, `pinned-blocked`, `yanked-invalid`, and `dependency-blocked`.
Current runs do not send webhook traffic; the JSONL record is the local update
notification surface.

Benchmark compare evidence records include before/after scorecard deltas and
summary counts for improved, regressed, and unchanged dimensions.

Benchmark trace rollup records use kind `benchmark-trace-rollup` and summary
schema `anamnesis.benchmark_trace_rollup.v1`. They read
`.anamnesis/logs/benchmark-traces.jsonl` by default, aggregate benchmark
trace records by phase/status, sum numeric metrics, append markdown to
`docs/BENCHMARK-TRACES.md`, and keep this runtime timing/trace evidence
separate from deterministic context-quality scorecards.

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
non-gallery records such as `doctor-check`, `hook-log-summary`,
`init-install`, `update-apply`, `benchmark-trace-rollup`,
`agent-task-benchmark`, and `prompt-delta-gate`.

## Boundary

This evidence layer is not a task runtime, HUD, queue, or orchestrator. It is
repo-local proof that lifecycle, dogfood, and benchmark claims can consume
without scraping markdown prose.

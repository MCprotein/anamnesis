# Agent Task Benchmarks

Status: v1.5 retrieval-aware model-dependent benchmark harness.

This file is separate from [`BENCHMARKS.md`](BENCHMARKS.md). Deterministic
benchmark reports measure context surfaces on disk. Agent task benchmarks
measure how one agent/model run behaved on a fixed task prompt, so they are
model-dependent and need repeated runs before any public claim.

## Commands

```bash
anamnesis benchmark task --template > task-run.json
anamnesis benchmark task --input task-run.json
anamnesis benchmark task --input task-run.json --append
```

Append runs write markdown here and an `agent-task-benchmark` record to
`.anamnesis/evidence/events.jsonl`. The generated benchmark gallery
intentionally ignores this evidence kind so deterministic README claims do not
mix product surface quality with model behavior.

`anamnesis benchmark prompt-gate` consumes these records as one signal when
deciding whether Codex prompt-time context delta injection is justified. In
v1.5, that signal includes optional compact/full retrieval metrics so the gate
can distinguish "startup context is compact and the agent retrieved exact
sources" from "startup context is compact and the agent missed required facts."

## Schema

Input files use `schema_version: anamnesis.agent_task_benchmark.v1` and include:

- `project`: public-safe project name and optional shape
- `task`: stable task id, fixed prompt, and optional expected first action
- `run`: run id, agent, model, optional `session_context_mode`
  (`full`, `compact`, or `unknown`), and context state
- `metrics`: questions before action, tool turns to locate context,
  first-correct-action success, handoff recovery success, and elapsed time
- `limitations`: why the result should not be overgeneralized
- `evidence`: transcript, run log, or deterministic benchmark evidence paths

Optional v1.5 retrieval metrics:

- `task_success`: whether the task finished correctly
- `required_source_reads` / `expected_source_reads`: how many required source
  pointers the agent actually opened before acting
- `missed_invariant_count`: required invariants omitted or violated
- `hallucinated_fact_count`: project facts asserted without source support
- `unnecessary_context_reads`: context files read despite not being needed for
  the task
- `input_tokens`, `output_tokens`, `total_tokens`: token usage from the model
  run when available

## Scoring

The harness reports a 5-point convenience score:

| Dimension | Full point |
|---|---|
| First correct action | first action matches the expected context-aware behavior |
| Handoff recovered | agent correctly resumes from handoff/context |
| Question efficiency | 0 questions before first action |
| Context lookup efficiency | 0-1 tool turns to locate project context |
| Elapsed efficiency | 60 seconds or less |

Half credit is used for 1 question, 2-3 context tool turns, or 60-180 seconds.
Scores are only comparable across repeated runs with the same task prompt,
repo snapshot, agent, model family, session context mode, and context state.
Retrieval metrics are reported beside the 5-point convenience score; they are
not folded into that score so old runs remain comparable.

## Compact vs Full Retrieval Runs

Use paired runs when evaluating v1.5 compact SessionStart behavior:

1. Same repo snapshot.
2. Same task prompt and expected source list.
3. Same agent, model, and tool permissions.
4. One run with `ANAMNESIS_SESSION_CONTEXT_MODE=full`.
5. One run with `ANAMNESIS_SESSION_CONTEXT_MODE=compact`.

The comparison should look for task success, required-source-read rate, missed
invariants, hallucinated facts, unnecessary context reads, elapsed time, and
token usage. A single pair is diagnostic only. Public claims need repeated
public-safe runs.

## Claim Boundary

Allowed:

- "In this controlled task run, agent/model X scored Y/5."
- "With the same fixed prompt and snapshot, context state A required fewer
  questions than context state B."

Not allowed:

- "anamnesis makes every agent smarter."
- "Model X is better than model Y" from one run.
- Mixing `agent-task-benchmark` scores into deterministic `benchmark-report`
  scorecards or README public-shape claims.

## Current Runs

No public model-dependent run is committed yet. Add runs only when the input
JSON avoids proprietary prompts, source snippets, credentials, and local
absolute paths.

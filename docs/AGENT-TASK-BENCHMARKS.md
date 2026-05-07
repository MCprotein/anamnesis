# Agent Task Benchmarks

Status: v1.2 model-dependent benchmark harness.

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

## Schema

Input files use `schema_version: anamnesis.agent_task_benchmark.v1` and include:

- `project`: public-safe project name and optional shape
- `task`: stable task id, fixed prompt, and optional expected first action
- `run`: run id, agent, model, and context state
- `metrics`: questions before action, tool turns to locate context,
  first-correct-action success, handoff recovery success, and elapsed time
- `limitations`: why the result should not be overgeneralized
- `evidence`: transcript, run log, or deterministic benchmark evidence paths

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
repo snapshot, agent, model family, and context state.

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

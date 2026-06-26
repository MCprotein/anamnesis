# Task Harness Design

Status: v1.7 initial capability design and base fixture.

`task_harness` is a repo-local contract for a class of agent task. It tells an
agent what success means before it edits: goal, stop condition, read/write
scope, forbidden actions, required evidence, test commands, role hints, rubric,
and lifecycle metadata.

It is not a memory dump and it is not prompt-time storage. Harness bodies are
rendered as files under `.anamnesis/task-harnesses/` and indexed for retrieval.
Startup context should include at most one matched harness body. Non-matched
harnesses stay as source pointers or context-index entries.

## Fragment Capability

Fragments declare a harness with:

```yaml
- type: task_harness
  name: context-continuity
  source: task-harnesses/context-continuity.yaml
  lifecycle: reusable
```

Renderer behavior:

- Claude Code, Codex, and Cursor all write the same canonical file:
  `.anamnesis/task-harnesses/<name>.yaml`.
- The file is non-executable and does not require `--allow-exec-adapters`.
- When multiple adapters are enabled, normal render-action dedupe collapses the
  shared file target.
- Adapter-specific prompt surfaces should point to the file only when a later
  matching policy says the harness is relevant. They should not paste every
  harness body into startup context.

## Harness File Schema

Initial schema version: `anamnesis.task_harness.v1`.

Recommended fields:

```yaml
schema_version: "anamnesis.task_harness.v1"
id: "context-continuity"
title: "Context continuity task harness"

lifecycle:
  kind: "reusable" # current | reusable
  last_used: "<ISO-8601 timestamp>"
  use_count: 3
  deprecated: false
  superseded_by: "new-harness-id"

goal: "..."
stop_condition: "..."

scope:
  read:
    - "AGENTS.md"
  write:
    - ".anamnesis/handoff/*.md"

forbidden:
  - "Do not claim a project invariant without reading the exact source file."

required_evidence:
  - id: "source-pointer-read"
    description: "The exact source file was opened before relying on it."

test_commands:
  - "anamnesis context index --write"

rubric:
  - id: "retrieval-before-claim"
    pass: "Claims cite exact repo-local files or generated evidence."
```

`id`, `title`, `goal`, and `stop_condition` should stay short enough for index
snippets. Long task examples belong in docs or fixtures, not in harness bodies.

## Lifecycle

`current` harnesses:

- describe one in-flight task;
- may be generated or hand-authored by an active agent;
- should leave active startup context when the task is completed;
- should be deleted or archived under bounded retention.

`reusable` harnesses:

- describe a task type that is expected to recur;
- are suitable for fragment/library installation;
- may remain on disk as retrieval targets;
- should receive `last_used`, `use_count`, `deprecated`, and `superseded_by`
  metadata when lifecycle tooling updates them.

Cleanup is preview-first. `anamnesis gc --dry-run` reports retention
candidates, stale `current` harnesses, deprecated reusable harnesses,
superseded templates, count-budget pressure, disk-budget breaches, and whether a
file is managed or user-authored. It does not delete files. Future apply-mode
cleanup must keep user-authored files review-only unless the user explicitly
opts in.

## Retrieval

`anamnesis context index` includes `.anamnesis/task-harnesses/*.yaml` as
`task-harness` entries. Agents can query them with:

```bash
anamnesis context query --kind task-harness "context continuity"
```

The index entry should contain the file source path, stable harness id, title,
short goal/stop-condition snippet, lifecycle tag, and freshness.

## First Fixture

The base fragment ships `context-continuity`, a reusable harness for compact
context, ontology, handoff, and evidence continuity. It proves the adapter
pipeline can render a harness without increasing default SessionStart payloads.

The fixture is deliberately generic and public-safe: no repository names,
absolute local paths, credentials, prompts, or proprietary benchmark details.

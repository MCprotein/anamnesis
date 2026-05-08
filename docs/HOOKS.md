# Hook Summaries

`anamnesis hooks summary --append` appends hook runtime summaries here and
writes a `hook-log-summary` runtime evidence record to
`.anamnesis/evidence/events.jsonl`.

The source log is `.anamnesis/logs/hooks.jsonl` by default. Each valid line
uses `schema_version: anamnesis.hook_log.v1` with at least `generated_at`,
`event`, and `status`.

<!-- append-only below -->


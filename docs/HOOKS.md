# Hook Summaries

`anamnesis hooks summary --append` appends hook runtime summaries here and
writes a `hook-log-summary` runtime evidence record to
`.anamnesis/evidence/events.jsonl`.

The source log is `.anamnesis/logs/hooks.jsonl` by default. Each valid line
uses `schema_version: anamnesis.hook_log.v1` with at least `generated_at`,
`event`, and `status`.

<!-- append-only below -->

## Work `UserPromptSubmit` briefing

The base fragment's Work continuity hook uses dedicated adapters rather than
the generic shell bridge:

- Claude Code installs `.claude/hooks/work-briefing.sh` and forwards the exact
  native JSON stdin to `anamnesis work hook-user-prompt --client claude-code`.
- Codex installs `.anamnesis/codex-native-hooks/work-user-prompt.mjs`, forwards
  the complete input buffer on stdin, and wraps only successful CLI stdout as
  `hookSpecificOutput.additionalContext`.

The handler requires `session_id` plus Codex `turn_id`, or Claude Code
`prompt_id` when that documented field is available. Missing stable identity,
invalid JSON, missing executables, and command failures are fail-open and do
not inject a briefing. Prompt text is validated only as the documented string
field; it is not persisted, logged, fingerprinted, or returned. A due briefing
is stored as `injected_unconfirmed`, because additional context proves model
injection rather than visible delivery to the user. Retry boundaries and the
same observed fingerprint are deduplicated without advancing the confirmed
baseline.

Compact hook context always includes the Work goal/completion contract,
contract delta, configured review gates, changed or at-risk requirement
summaries, next IDs/action, blockers, and an exact `work status --json`
retrieval command. Output uses structural per-section budgets and never cuts a
field or identifier mid-value. If a requested full enumeration cannot fit one
hook context, the adapter emits no partial full list and requires authoritative
status retrieval instead. The Codex registration intentionally omits a status
message, so an `off` policy produces no visible per-prompt UI. The registered
wrapper still performs a local fail-open policy check; cold-start cost must be
benchmarked before this pattern expands to more frequent hook events.

Contract evidence: [Codex Hooks](https://learn.chatgpt.com/docs/hooks) and
[Claude Code hooks reference](https://code.claude.com/docs/en/hooks). Exact raw
prompt retention is intentionally deferred to a bounded staging/allocation/GC
protocol rather than treating every submitted prompt as a durable Work
requirement.

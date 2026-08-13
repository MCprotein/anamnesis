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

## Work same-turn safe-boundary briefing

Long foreground turns also evaluate the frozen Work reconciliation policy
after meaningful tool boundaries. Codex uses `PostToolUse` for canonical
`Bash`, `apply_patch`, and `Agent` calls. Claude Code uses `PostToolBatch`
instead of concurrent per-tool hooks, filters the batch to `Bash`, `Edit`,
`Write`, `NotebookEdit`, and `Agent`, and ignores subagent-internal batches.

The dedicated wrappers discard tool input, tool output, transcript paths,
prompts, and arbitrary native fields. They send the CLI only documented stable
session/turn or prompt identity plus opaque tool-use IDs and canonical tool
names. Missing stable identity, unsupported/read-only batches, unavailable
executables, and command failures are fail-open and UI-silent. Hooks never
launch an agent, tmux Team, daemon, scheduler, or provider runtime.

Before resolving the foreground CLI, each wrapper derives the canonical
per-session cursor path (including the primary Git worktree root) and skips an
unlinked session. This keeps the default unlinked path to a small local
identity and file-existence preflight instead of paying a full CLI startup.

Claude Code same-turn batching requires the documented `prompt_id` field
available in Claude Code 2.1.196 and later. Older payloads are rejected by the
wrapper before any foreground CLI process is started.

The session cursor keeps a bounded FIFO of SHA-256 boundary IDs so a retried or
concurrently delivered event increments the meaningful-action counter exactly
once. Counter, FIFO, and optional `injected_unconfirmed` observation commit in
one durable lock-scoped cursor mutation. Hidden injection does not reset the
counter or claim visible delivery; visible confirmation resets the count but
preserves the FIFO against late retries, while a Work switch resets the whole
reconciliation state. Tool boundaries use cadence and maximum-silence rules with no synthetic
resume trigger. Terminal Works may be briefed but are never restarted or
continued automatically.

Same-turn context has an 8,000-character structural budget and the Codex hook
sets an explicit positive `additionalContextLimit`. Mandatory retrieval,
completion, delta, gate, next-action, blocker, and authoritative-pointer fields
are preserved. A requested full requirement list is all-or-none; when it does
not fit, the foreground agent must retrieve `work status --json` before the
visible briefing. The lock wait is bounded, so hook failure remains fail-open
without weakening the already committed cursor state; the wrapper also bounds
the foreground CLI child to 35 seconds.

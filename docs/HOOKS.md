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
not inject a briefing. Prompt text is decoded only from the documented string
field and is never logged, fingerprinted, or returned. With the default
`settings.work_prompt_capture` policy absent or `off`, it is not persisted.
With `bounded` capture in the reviewed Agentfile, the exact decoded string
re-encoded as UTF-8 is stored temporarily as `client_exact` in the local-private
`.anamnesis/work-prompt-stage/` tree. Lone UTF-16 surrogates fail open rather
than being replacement-encoded. Returned context contains only an opaque stage
ID and the explicit `allocate-same`, `allocate-new`, `retain`, or `discard`
grammar; it never contains the body or a prompt-derived hash. A due briefing
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
wrapper performs a local fail-open preflight and avoids starting the CLI when
both prompt capture is off and the session has no linked Work cursor.
When the local preflight sees a bounded candidate, it asks the installed CLI
to validate the complete Agentfile through the canonical schema before raw
prompt bytes cross the wrapper boundary. Invalid or ambiguous configuration
cannot authorize capture; linked-work reconciliation receives only a
whitelisted payload with an empty prompt when capture is not authorized.

Stage resolution is a foreground command, never an automatic current-cursor
allocation. Accepted same/new decisions publish one immutable source envelope
and append the typed Work ledger; ambiguous prompts may be retained with a
truthful immutable `provisional` envelope and bound later without rewriting
it; interruptions/non-requirements first commit a content-free discard receipt
and then delete the raw stage. Bounded GC uses the same stage locks, so it
cannot remove a prompt while allocation is committing. `anamnesis work prompt
gc` is the explicit daemon-free TTL boundary and also recovers expired
body-only, corrupt partial, and stale temporary publication files. Repository
policy controls, caps, or disables capture; users review it in the installation
Git diff and can set `preset: off`.

Contract evidence: [Codex Hooks](https://learn.chatgpt.com/docs/hooks) and
[Claude Code hooks reference](https://code.claude.com/docs/en/hooks). Raw
prompt retention is policy-controlled and bounded; every retained prompt is explicitly
allocated or provisional, while discarded/non-requirement prompts leave no
raw body.

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

# Codex continuity boundaries

Codex native `UserPromptSubmit.turn_id` identifies the active turn, not an
individual message. Several steering messages can arrive within one turn.
Anamnesis therefore creates a random local capture token for each Codex delivery,
while retaining the original session/turn identity for cursor reconciliation and
tool accounting. See the [official hook contract](https://learn.chatgpt.com/docs/hooks).

Capture tokens locate staged bytes; they do not establish user authority, select
a Work, classify a request, authorize a lifecycle change, or satisfy completion.
The agent must explicitly classify each delivery and use the existing source,
expected revision, contract hash and ledger-head checks when changing a Work.
A side question is not a new objective. Cancellation of an action is not an
automatic cancellation of a Work. Late tool results do not supersede newer user
instructions.

The documented Codex payload has no distinct message-delivery ID, so identical
transport retries cannot be distinguished from repeated identical user messages.
They receive separate captures; hooks do not automatically allocate them or
advance canonical Work progress. Retrying resolution with the same capture token
is idempotent. Claude's stable `prompt_id` and existing strict terminal receipt behavior are
unchanged; terminal hooks do not silently reinterpret a resolved prompt. A discarded receipt keeps
no prompt body or digest. Existing budgets and GC bound unresolved stage bodies,
not all retained outcomes.

With bounded capture enabled, normal init/apply plans two exclusions in
`.anamnesis/.gitignore`: `/work-prompt-stage/` and `/work-inputs/`. Preview is
read-only. Existing user content is preserved; tracked raw data, unsafe paths and
ownership conflicts fail closed. A linked worktree may use already-protected
primary storage, but cannot silently repair another checkout's files. Privacy
verification requires the effective Git rule to end in a literal directory
component, with or without a trailing slash. Ambiguous glob-only coverage fails
closed; normal init/apply supplies exact directory rules, and a literal exclusion
of the parent directory also works.

Compaction recovery restores the exact session-selected, already allocated Work
contract and its source pointers. It does not allocate unresolved captures,
infer ownership, or replace Codex's conversation compaction. No claim is made
that unallocated prompt classification survives every compaction boundary.

Tool replay accounting is bounded by a 64-entry recent-boundary window; it is not
an unbounded exactly-once event log. Tool events supply activity evidence, not
proof of completion. A real completion still needs explicit requirements and
validated evidence.

The local Work lock currently requires process-start identity inspection. A
sandbox that denies the necessary `ps` call can prevent Work mutations. The lock
fails closed rather than weakening ownership checks. Full-access integration
results must not be generalized to that sandbox configuration.

These changes do not tune Astra reasoning levels, enable async execution or
experimental context management, or control provider prompt caching. Existing
project adapters require normal explicit apply with `--allow-exec-adapters`;
upgrading the CLI alone does not update generated files.

The [v1.23.5 targeted integration report](benchmark-evidence/codex-continuity-v1.23.5/README.md)
contains the frozen eight-run results, reproducible account-based runner, failure
history, measured overhead and remaining validation limits.

Native compact recovery also requires the explicitly selected cursor to retain
the exact native session reference. Normal onboarding must advertise both the
derived cursor ID and native session reference; the reference is a routing
locator, not permission to allocate Work or perform writes. An existing unbound
cursor requires explicit selection to establish that reference. Conflicting
nonnull bindings must fail closed. The earlier eight-run benchmark did not meet
this binding condition and is not evidence of native Work context injection.

# Work Unit and Requirement Ledger Design

Status: v1.18 target design with storage, typed contract, policy resolution,
projection, session cursor, thin CLI commands, bounded prompt staging,
prompt/safe-tool reconciliation hooks, and runtime-neutral review/delegation
evidence plus contextual readiness implemented. Provider orchestration,
compaction-native triggers, and closure orchestration remain unshipped.

## Goal

Preserve a user's evolving task faithfully across long sessions, concurrent
sessions, context compaction, agent switches, and interruptions without
turning anamnesis into either a raw transcript archive or an execution harness.

The design separates three durable things that must not be conflated:

- A **source event** is one user-authored prompt payload captured without
  agent rewriting.
- A **requirement ledger** is the append-only history that allocates source
  events or exact source spans to a work unit and records later
  interpretations, corrections, status changes, and reclassifications.
- A **work unit** is one independently completable and reviewable delivery
  contract.

The source event and ledger preserve provenance. The work-unit projection
keeps the current operational view clean. An agent may improve the projection;
it may never rewrite the source event to make the user look more organized.
`Work` is the only durable task-domain object. Review attempts, implementation
steps, tests, and provider fallbacks are ledger events, not durable Job, Run,
Attempt, Session, or Transaction entities.

## Core invariants

1. Every user prompt allocated to a work unit, or retained provisionally while
   its allocation is ambiguous, has an immutable event ID, content hash,
   capture fidelity, and allocation decision. The only mutation exception is
   an explicit destructive purge, which tombstones the event and appends purge
   evidence to every referring ledger. Pure interruptions and non-requirements
   are not durably archived by default.
2. User-authored text is not replaced by an agent summary. Agent-authored
   interpretation is stored separately and always points back to source event
   IDs and, when possible, exact text spans.
3. Every active requirement has exactly one canonical work-unit owner. A raw
   source event may contribute different spans to multiple units, but the raw
   body is stored only once.
4. One work unit represents one completion contract that can be reviewed,
   completed, abandoned, or superseded without changing another unit's state.
5. Time, token count, session count, ledger size, and TTL never create or end a
   semantic work-unit boundary by themselves.
6. A session may point at a work unit, but it never owns the unit, its
   requirements, progress, lifecycle, or completion decision. Several sessions
   may point at the same unit or at different units concurrently.
7. Reclassification, correction, completion revocation, reopening, and
   supersession are append-only lineage events.
   They never erase the old allocation or provenance; only the separately
   authorized destructive purge contract may remove source content.
8. Raw prompt bodies are local-private by default and are not included in
   startup digests, context-index snippets, logs, telemetry, or MCP exports.

## Storage model

A single YAML file is too fragile for a months-long ledger containing verbatim
prompts. The target layout keeps identity bounded while retaining immutable
input and append-only history. Paths below are relative to the canonical local
Work state root:

```text
.anamnesis/
  work-prompt-stage/
    bodies/<capture-id>.bin
    records/<capture-id>.json
    outcomes/<capture-id>.json
    bindings/<capture-id>.json
  work-inputs/
    events/<event-id>.yaml
    objects/<event-id>.txt
  work-units/
    <unit-id>/
      unit.yaml
      ledger.jsonl
      projection.yaml
  work-cursors/
    <cursor-id>.yaml
```

All sessions that belong to one local repository instance must resolve the
same state root. A normal checkout or non-Git project uses its project
`.anamnesis/` directory. Git linked worktrees resolve the primary worktree from
`git worktree list --porcelain` and use that primary worktree's `.anamnesis/`,
while each cursor still records its own worktree fingerprint. An explicit
state-root override is allowed for recovery/testing and must be surfaced in
`status`; a session that detects a different or unavailable canonical root
fails Work writes closed rather than creating a divergent ledger silently.
Independent clones and different machines are separate local repository
instances. Live cross-host synchronization requires a future, evidence-backed
sync design and is outside the baseline.

- `work-inputs/objects/` stores the exact visible text payload delivered by a
  supported adapter. Objects are event-scoped rather than cross-event
  deduplicated so purging one event cannot destroy another event's provenance.
- `work-inputs/events/` stores the envelope: event ID, timestamp, client,
  content type, object hash/path, fidelity, attachment refs/hashes, and
  allocation status.
- `unit.yaml` stores bounded identity, semantic lifecycle, current contract
  revision, ledger head, resolved Work policy and its sources/hash,
  boundary/checkpoint hashes, and digest metadata.
  It never stores a global foreground owner.
- `ledger.jsonl` is append-only. Records include input allocation,
  interpretation, requirement state transitions, conflicts, review results,
  checkpoints, waivers, and reclassification lineage.
- `projection.yaml` is the current readable view produced by folding the
  ledger. It contains normalized requirement summaries and progress, but is
  never provenance authority.
- `work-cursors/*.yaml` stores best-effort local resume pointers such as
  `work_id`, `observed_revision`, and `last_event_id`. Cursors are disposable,
  ignored by version control, bounded by TTL, and never authoritative.

The baseline deliberately avoids a transaction journal or multi-file runtime.
A write uses a short per-work-unit file lock, a unique event ID, and an
expected ledger-head hash. The append-only ledger is the commit point: write
the source object/envelope first through temporary files, `fsync` each file (or
use the platform durability equivalent), rename it atomically, and `fsync` the
containing directories before re-checking the expected head under the lock. If
the platform cannot establish that durability ordering, the allocation fails
closed. Only then append exactly one canonical JSON record plus its terminating
newline and `fsync` the ledger file.
Every record carries the previous-record hash and its own record hash. Only a
newline-terminated record whose JSON, required fields, previous hash, and
record hash all validate is committed. On recovery, a single truncated or
invalid final tail may be cut back to the last valid byte offset under the same
lock; an invalid record before that final tail or any hash-chain mismatch is
corruption and fails closed. `unit.yaml` and `projection.yaml` are bounded
caches rebuilt from the committed ledger and replaced atomically. A crash
before the append may leave an unreferenced but durable source object for
diagnostics to remove; a crash after it may leave a recoverable ledger tail or
stale caches that the next read repairs. A committed allocation therefore
never points to an unpublished source body. Ledger rotation or packing is
deferred until profiling proves it necessary and, if added, remains a storage
detail rather than a new domain object.

## Prompt capture fidelity

While work-unit tracking is active, capture uses a staged buffer: receive the
exact user-visible payload, classify it, then durably retain the body only when
it is allocated to a work unit or remains provisionally ambiguous. A pure
interruption/non-requirement discards the body after classification and keeps
at most minimal retention-policy metadata. Full user-prompt archival is a
separate explicit opt-in.

The implemented staging policy follows Agentfile v2
`settings.work_prompt_capture`: `bounded` enables private staging and `off` or
absence disables it. The setting is reviewable in the installation Git diff.
`bounded` capture uses
a deterministic identity derived from the native client/session/turn boundary,
never from prompt bytes, and enforces TTL, per-entry, total-byte, and entry-count
budgets. Codex requires `session_id + turn_id`; Claude Code stages only when an
actual `prompt_id` is present. The stored fidelity is `client_exact`: exact
decoded prompt text re-encoded as UTF-8, not a claim about original transport
or JSON escape bytes. Lone surrogate input is rejected rather than normalized.

Resolution is an explicit four-way foreground decision. `allocate-same`
requires the exact Work ID plus observed head/revision/contract hash;
`allocate-new` requires a new accepted contract; `retain` commits a truthful
provisional source and an ambiguity/boundary receipt; `discard` commits a
content-free terminal receipt before deleting the body. The current session
cursor is never implicit allocation authority. Retained provisional sources
bind later through a separate append-only receipt without mutating the original
envelope. Retry identity and assertion hashes make the same decision
idempotent, while a different decision or stale Work precondition fails
closed.

Capture and GC acquire the global budget lock before stage locks. Resolution
acquires stage, then sorted source, then sorted Work locks and never nests the
budget lock. The source/ledger append is the allocation commit point; stage
cleanup happens last. A crash before commit keeps the stage retryable, while a
crash after commit lets an exact retry validate the immutable source and ledger
then finish cleanup.

`anamnesis work prompt gc` is the daemon-free expiry boundary. It scans the
bounded union of body and record files plus stale atomic-publication temps,
revalidates terminal outcome receipts, and removes expired partial/corrupt
stages under the same budget → stage lock order. TTL means eligible at the next
capture or explicit GC boundary; no background timer is implied. Outcome and
binding JSON are content-free, non-domain operational receipts retained for
idempotent recovery and later provisional binding; raw body expiry does not
depend on deleting those receipts.

For a retained source event, “verbatim” means the exact user-visible payload
supplied by the client or native prompt hook, not a rephrasing reconstructed
from model memory. Each event declares one of:

- `native_exact`: a supported client/hook supplied the exact visible text
  payload and anamnesis verified its stored hash;
- `client_exact`: an adapter API supplied an exact text payload but not the
  original transport bytes;
- `agent_observed`: the agent copied the model-visible prompt because no native
  capture surface existed.

`agent_observed` is useful continuity evidence but must never be labeled
byte-verifiable. Diagnostics report the downgrade. A supported adapter must
capture before compaction and before any agent normalization. User-visible
attachments are recorded as stable refs and hashes when available; hidden
system/developer instructions, tool output, and internal chain-of-thought are
not part of the user requirement ledger.

Prompt bodies must be written through a data-safe file/stdin API, never through
shell interpolation. Explicit purge is the sole destructive exception to
source-event immutability: it replaces the envelope/body with a hash-free
opaque tombstone and appends purge evidence to every referring unit ledger. It
may not pretend the original was never captured.

## Keeping a messy ledger useful

The raw chronology is allowed to be messy. Cleanliness belongs in the derived
view. A ledger record can classify a source span as:

- `requirement`
- `acceptance_criterion`
- `constraint`
- `clarification`
- `correction`
- `cancellation`
- `question_or_interruption`
- `non_requirement`
- `ambiguous`

Agent interpretations receive stable IDs and source refs. They can be revised
by appending `supersedes` records; the old interpretation and original prompt
remain readable. Duplicate statements add provenance to one canonical
requirement instead of inflating the denominator. Clearly explicit later
corrections supersede earlier operational meaning. If two prompts conflict and
neither clearly supersedes the other, both remain visible and the effective
requirement becomes `blocked` or `needs_user` rather than letting the agent
guess.

The default user view is therefore two-pane in concept even when rendered as
plain text:

1. **Original requests** — chronological, verbatim, immutable.
2. **Current contract** — structured requirements, status, conflicts,
   evidence, and exact source pointers.

Users should not have to approve routine high-confidence extraction. The
system asks only when ambiguity would change work-unit ownership, cancel or
replace existing intent, weaken a required gate, or cause a conflicting write
or external side effect.

## Work-unit boundary contract

The boundary is the completion contract, not the chat session, topic label,
repository, branch, or set of touched files.

The primary test is one user-recognizable acceptance decision: can the user
accept, ship, cancel, or roll back the new result independently without
changing the current unit's completion verdict? Only then create a sibling/new
work unit.

The following are supporting signals, not automatic split rules:

- it has a separate deliverable or stop condition;
- it owns a different write scope or external side-effect key;
- it has an independently meaningful deadline, approver, or review policy;
- it can be separately verified or implemented by another agent.

API, UI, documentation, migration, and tests for one feature normally stay in
one user work unit even when their files, reviewers, or execution order differ.
Those signals may justify agent-runtime execution decomposition, but they do
not create another anamnesis object unless the independent acceptance test also
holds.

Keep an input in the current unit when it is a clarification, correction,
constraint, acceptance criterion, or additional requirement for the same
deliverable and will be completed under the same stop condition. This appends
to the ledger and increments the contract revision; it does not create a new
unit merely because the prompt arrived later. Implementation, tests,
documentation, planning review, and completion review remain events and
evidence inside that Work.

Create another Work only when it passes the independent acceptance test. Link
related Works with bounded relations such as `related_to`, `successor_of`, or
`blocked_by`; do not create a WorkStream container or child execution unit in
the baseline. Treat a short read-only question with no durable deliverable as
an interruption. Cross-cutting rules that truly apply to many units belong in
a user/project policy or reusable task harness; units snapshot the resolved
rule instead of duplicating one “shared” requirement across multiple ledgers.

Boundary decisions are persisted rather than re-inferred after every
compaction:

```yaml
identity:
  id: wu_01...
  contract_revision: 3
  ledger_head: "sha256:..."
  boundary_hash: "sha256:..."

boundary:
  state: accepted # provisional | needs_user | accepted
  classification: same_unit # same_unit | new_unit | interruption
  reason_codes:
    - same_completion_contract
    - same_write_scope
  decided_from:
    - event_id: evt_01...
      object_hash: "sha256:..."
      utf8_byte_spans: [[418, 592]]
      span_hashes: ["sha256:..."]
```

Classification should use stable reason codes and a confidence level. High
confidence, reversible classifications proceed automatically. Ambiguous
events are captured immediately as `provisional` so the source cannot be lost,
but they do not silently enter the verified progress denominator.

Text spans are half-open UTF-8 byte offsets over the immutable object bytes.
Capture preserves original normalization and line endings; adapters do not
normalize CRLF, Korean text, emoji, or Unicode composition before hashing.
Every span carries the object and span hash. A hash mismatch makes the selector
unresolvable rather than letting an adapter reinterpret offsets. Non-text
payloads use typed attachment/object selectors instead of text offsets.

## Long-running sessions and related work

A session may stay open for months, but a work unit must remain finite. When
the user continuously adds related requests, apply these rules:

- **Same deliverable evolves:** retain the unit ID, append the raw event, and
  advance the contract revision. Earlier accepted revisions remain recoverable
  from the ledger.
- **Related but independently completable work appears:** create another Work
  and link it with a bounded relation. Each Work keeps its own completion
  verdict and progress.
- **The conversation becomes an endless theme:** the theme itself is not a
  Work. Preserve existing finite Works and create a new Work only for each
  concrete deliverable. Add a richer grouping object later only if retrieval
  evidence shows that relations and labels are insufficient.
- **Only storage grows:** keep the semantic Work unchanged. Revisit physical
  ledger packing only after measurement.
- **No activity for a long time:** mark freshness stale according to TTL.
  Resume by revalidating source, scope, evidence, and review hashes; do not
  abandon or split automatically.

Age, event count, revision count, requirement count, or a low boundary-confidence
trend may trigger a non-blocking boundary review/split suggestion. They are
diagnostic signals only. Ask the user when two or more completion contracts are
plausible, cancel/replace intent is unclear, ownership would move between
units, dirty write/external scopes conflict, or a split/merge would change an
accepted completion contract.

A genuinely new scope after valid completion creates a successor Work. If the
user shows that completion was premature or an original requirement was
omitted, append `completion_revoked` and `reopened` events to the same Work;
the old completion evidence remains visible. A mistaken allocation appends a
`reclassified_to` mapping rather than rewriting either ledger.

## User-configurable review policy

Independent review is a user/project capability, not a universal blocking
requirement. Fresh init uses `advisory`; existing projects that omit policy
retain the legacy `off` default.

Presets:

| Preset | Behavior |
|---|---|
| `off` | Create no review gates. |
| `advisory` | Attempt the same default planning and completion reviews as `strict`; record findings or unavailability but do not block. |
| `strict` | Require planning and completion/PR review; protected transitions remain blocked until an input-hash-matched review passes or the user explicitly waives it. |
| `custom` | Configure each gate's `off`, `advisory`, or `required` enforcement, role, minimum reviewers, invalidation inputs, provider preference, and unavailable behavior. |

Policy sources are merged with provenance. Required gates are monotonic:
project, task-harness, and user defaults can add requirements, while silently
weaker settings cannot remove a required gate. The effective order is:

1. current explicit user instruction, policy change, or evidenced waiver;
2. per-unit override;
3. matched task harness;
4. project policy;
5. user-level default;
6. product fallback `off` for legacy or hand-authored files that omit policy.

The resolved policy, all contributing source refs, and its hash are frozen into
each accepted contract revision. Lowering an already-required gate is a waiver and must be
explicit; making it stricter is safe and append-only.

Convenient configuration should not require hand-authoring full YAML:

```text
anamnesis init --review-preset off|advisory|strict
anamnesis context policy configure --scope user --review-preset strict
anamnesis context policy configure --scope project --review-preset advisory
anamnesis context policy show --resolved
```

Interactive initialization asks one short preset question and explains the
trade-off. User defaults live in the platform/XDG anamnesis config and apply
across projects. Project defaults belong in Agentfile settings and therefore
require an explicit versioned Agentfile migration because the current v1
parser rejects unknown fields. Task-specific custom detail may live in a
referenced project policy file and reusable task harnesses. `status` and
`doctor` show the resolved preset, source precedence, unavailable providers,
and any policy drift. Per-unit natural-language changes such as “이 작업은
리뷰 없이 진행” are captured as explicit overrides or waivers with source
event refs.

## Review capability and provider fallback

Durable policy specifies reviewer capability, not an orchestration product:

```yaml
review:
  mode: required
  gates: [planning, completion]
  reviewer:
    capability: independent_agent
    role_hint: critic
  unavailable: fail_closed

review_provider_preferences:
  provider_order: [omx, codex_native, separate_process]
  fallback_on: [authorization_error, unsupported_authority, unavailable]
```

OMX, Codex native subagents, Claude native subagents, or a separate process are
execution providers owned by the current agent runtime, not by anamnesis. The
runtime must attest that the reviewer instance did not author the reviewed
artifact; shared source context does not by itself violate independence.

An OMX authorization failure, including unsupported documented leader proof,
selects Codex native as the next provider only when that provider is allowed by
the frozen policy and current runtime capability. Provider fallback does not
weaken gate enforcement. Under `strict`, `pending`,
`requested`, `changes_requested`, and `blocked_unavailable` all block the
protected transition; only `passed` for the current input hash or an evidenced
`waived` permits it. Exhausting providers changes the state to
`blocked_unavailable`, while reviewer findings use `changes_requested` until a
fresh matching review passes. Advisory mode records the attempts/findings and
does not protect the transition. Anamnesis injects the resolved rule, records
evidence, and blocks a strict protected action when evidence is missing; it
does not schedule, supervise, or retry reviewer processes. Each attempt is a ledger
event with an `activity_id`, provider, agent instance, role, outcome, reviewed
input hash, artifact refs, and findings. No Job or Run object is created.
Material plan/contract changes invalidate planning review; material
diff/base/head or verification changes invalidate completion review regardless
of provider.

The implemented evidence contract uses five typed event families:

- `work_review_requested`, `work_review_attempt_recorded`,
  `work_parallelism_assessed`, and `work_delegation_outcome_recorded` are
  source-free runtime evidence;
- `work_delegation_waived` is source-bound user authority and must pass through
  the canonical source-first publication boundary.

The projection folds only bounded durable ledger facts: recorded gate state,
input hashes, provider fallback, assessment/delegation state, evidence refs,
and bounded stale evidence. It never accepts caller-current plan, diff,
verification, scope, or runtime-capability inputs and therefore never claims
authoritative current readiness. `work readiness` is the contextual boundary:
it combines the byte-identical durable projection with a canonical current
input snapshot and evaluates protected-action blockers, advisories, and
obligations through a pure function.

Current-input canonicalization is bounded and read-only. Repo-local artifact
reads reject unsafe paths and symlinks. Completion inputs resolve allowlisted
Git object/diff facts with argument-array subprocess calls, bounded output, no
shell interpolation, and no write-capable Git or provider command. Runtime
content, capability, and reviewer identity claims remain explicitly
`runtime_attested`. The review identity guarantee is only exact inequality
between the provider-namespaced opaque author and reviewer refs supplied by the
runtime; anamnesis does not authenticate those refs, infer cross-provider
identity, or claim that undisclosed self-review is impossible.

The nested CLI surface is `work review request|record`,
`work delegation assess|record|waive`, and the read-only `work readiness`.
Every mutation against an existing Work requires an explicit `expected_head`.
An exact event-ID/body retry with its original head remains idempotent; a new
or different event at a stale head appends nothing and is never semantically
auto-rebased. The caller must refold and explicitly resubmit against the new
head.

## Automatic reconciliation briefing

The repeated user prompt “brief my requirements, what is done, what remains,
the progress percentage, then continue” is a first-class continuity policy.
When enabled, the current agent must reconcile against the Work projection,
emit either a bounded compact summary or an ordered full briefing, and continue
the current task in the same turn. It must not stop for confirmation unless
reconciliation exposes one of the genuine boundary/conflict cases defined
above.

Presets keep configuration small:

| Preset | Behavior |
|---|---|
| `off` | No automatic briefing; structural resume/close checks still apply. |
| `adaptive` | Brief at Work resume, contract revision, compaction recovery, meaningful milestone, and before close; add an interval briefing only when work has changed. |
| `frequent` | Apply `adaptive`, plus mark briefing due after 5 minutes or 5 meaningful actions, whichever is observed first. |
| `custom` | Configure triggers, maximum silence/action count, detail, and compact/chunk targets. |

There is no timer daemon. `max_silence` becomes due at the next supported safe
hook boundary, agent response boundary, or explicit Work command; it never
wakes or interrupts an idle process. Meaningful actions are evidence-bearing
changes such as a requirement revision, file mutation, verification result,
review result, commit, or external-effect receipt—not every read-only tool call.

```yaml
reconciliation:
  preset: frequent
  due_after:
    max_silence: PT5M
    meaningful_actions: 5
  triggers:
    - work_resume
    - contract_revision
    - compaction_resume
    - before_work_close
  detail: compact # compact | full
  compact_target_tokens: 220
  full_chunk_target_tokens: 800
  after_briefing: continue
```

Every briefing first reconciles the complete deterministic snapshot. The
visible compact contract includes:

- Work title/ID, contract revision, and whether the contract changed;
- the goal, invariant count/hash, every changed or currently at-risk must/never
  constraint, and a stable pointer to the complete invariant set;
- added, corrected, conflicting, or cancelled requirements since the prior
  reconciliation;
- verified, implemented-unverified, pending, blocked, and waived counts;
- the reproducible verified/applicable percentage and denominator;
- pending review gates, blockers, next requirement IDs, and next action.

`compact` does not mean the agent may ignore older requirements. The agent
checks the complete projection before producing a grouped visible summary;
unchanged constraints and requirements remain active through their stable
IDs/hash/source pointer even when not repeated verbatim. The token budget is a
target: compact mode never cuts a required field or identifier mid-value and
uses deterministic counts/groups plus pointers when the target cannot hold the
whole set. `full` enumerates every current requirement and constraint without
silent truncation when the adapter can deliver the complete payload. A
single-context hook that cannot fit the complete enumeration emits no partial
list: it marks full enumeration unavailable for that boundary and requires the
foreground agent to retrieve the authoritative status before briefing.
Multi-message adapters may chunk complete output into ordered messages, then
continue after the final chunk. A close check always reconciles the full
projection internally regardless of display detail.

Briefing cadence is session-local, so `last_reconciled_at`, observed ledger
head, briefing fingerprint, and `injected_unconfirmed | emitted_confirmed`
delivery observation live only in the disposable cursor. An adapter must not
claim the user saw a briefing when it can prove only context injection.
Repeated safe-hook notifications within the same minimum
interval/fingerprint collapse to one briefing. Periodic briefings do not append
canonical ledger noise or change progress; shared Work checkpoints remain the
durable state summaries.

The first automatic adapter slice evaluates this contract at
`UserPromptSubmit`. It requires the documented stable boundary identity
(`session_id + turn_id` for Codex, or `session_id + prompt_id` for supported
Claude Code versions), refolds only the cursor-selected Work, and emits bounded
additional context instructing the foreground agent to brief visibly and
continue. Missing identity or runtime failure is fail-open. This slice does
not retain the submitted prompt when policy is absent or `off`. When repository
policy enables bounded capture, the adapter uses the bounded staging lifecycle
above and injects only an opaque allocated/provisional/discard control
obligation.

The next thin adapter slice evaluates elapsed-time and meaningful-action
cadence inside a long foreground turn without adding a timer or daemon. Codex
uses documented `PostToolUse` identities; Claude Code uses `PostToolBatch` so a
parallel tool batch produces one model-context injection point rather than
concurrent competing messages. Provider wrappers discard tool input/output,
transcript paths, and prompt content before invoking anamnesis. Only stable
session/turn or prompt identity, opaque tool-use IDs, and allowlisted canonical
tool names cross the boundary.

Each newly observed meaningful boundary increments the session-local counter
once. A bounded hash FIFO, counter update, and optional hidden injection are
committed through one durable lock-scoped cursor mutation, so duplicate delivery does not
inflate cadence and distinct concurrent events are accumulated. Tool
boundaries do not pretend to be `work_resume`; they pass no semantic trigger
and become due only through configured action or silence cadence. They never
append Work-ledger events. Visible confirmation resets the counter but retains
the FIFO against late retries; switching Work resets the disposable
reconciliation state. Terminal lifecycle still forces `auto_continue = false`.

## Automatic delegation and parallelism policy

Anamnesis may require the current agent to assess and use parallel execution,
but it does not become the executor. Codex native subagents, Claude native
agents/teams, OMX tmux Team, or another supported runtime continue to own
process launch, scheduling, worktrees, mailbox/state, retries, and shutdown.
Anamnesis stores the user's Work-level preference, injects it at the decision
point, records bounded evidence, and diagnoses non-compliance.

```yaml
delegation:
  parallelism: auto # off | auto | prefer | required
  max_agents: 4
  native_agents: prefer # never | auto | prefer | required
  tmux_team: auto # never | auto | prefer | required
  fallback_order: [native_agents, tmux_team]
  unavailable: fallback # fallback | ask | fail_closed
  reassess_on: [contract_revision, material_scope_change, provider_unavailable]
```

Parallelism semantics:

- `off`: remain solo except a separately required independent-review gate.
- `auto`: once per accepted contract revision, identify bounded lanes and use
  parallel execution when at least two lanes are dependency-independent and
  expected benefit exceeds startup/coordination cost.
- `prefer`: use parallel execution whenever at least two safe independent
  lanes exist; proceed solo only with a recorded indivisibility, dependency,
  conflict, or provider-unavailable reason.
- `required`: the assessment is a protected action. If at least two safe lanes
  exist, they must be delegated through an allowed runtime or explicitly
  waived. A genuinely indivisible Work records `not_parallelizable` and may
  proceed solo; `required` never invents fake lanes.

The assessment checks dependencies, read/write scopes, external side effects,
shared files, required ordering, verification ownership, and integration cost.
Planning, implementation, research, testing, and review are candidates only
when their inputs are ready; a downstream review is not launched before the
artifact it reviews exists. Conflicting writes are serialized or isolated by
the agent runtime rather than declared parallel merely to satisfy a preset.

Runtime selection remains declarative:

- prefer native subagents/agent teams for bounded same-session fan-out with a
  few read-only or disjoint-scope lanes;
- prefer tmux Team for durable or long-running coordination, several workers,
  runtime-owned worktree isolation, mailbox/state handoffs, or operator-visible
  panes;
- `auto` lets the runtime choose the surface from the assessed task shape;
  `prefer` biases selection without inventing unsafe lanes, while `never` and
  `required` exclude or require that surface respectively;
- follow `fallback_order` on authorization, capability, startup, or runtime
  incompatibility. In particular, OMX authorization/leader-proof failure may
  select Codex native agents when that fallback is configured and currently
  allowed. `fallback` means select the next allowed provider; after exhaustion,
  `auto`/`prefer` may record the failure and
  continue solo, while `required` becomes `blocked_unavailable` until an
  allowed provider succeeds or the user waives it. `ask` requests that decision
  and `fail_closed` blocks without a waiver.

`required` on one runtime surface overrides an earlier preferred surface in
the fallback list and cannot be satisfied by a different surface. Requiring
both native and tmux for the same ordinary parallel assessment is invalid
unless a custom composition explicitly defines separate lanes for both. A
provider failure is fingerprinted by Work/revision, candidate lanes, policy,
runtime capability, and worktree; the same failure is not retried repeatedly
until one of those inputs changes. Configuration validation rejects `solo` as
a provider and any path that could make provider exhaustion satisfy
`parallelism: required`; solo is legal there only for `not_parallelizable` or
an evidenced user waiver.

Delegated children are not assumed to receive SessionStart hooks or the
leader's entire conversation. The leader must pass a bounded contract containing
the Work ID/revision, assigned requirement IDs, invariants, scope and
side-effect exclusions, expected artifact/evidence, and source pointers. A
delegation result never advances progress by itself; the leader integrates it
and records independent verification evidence first. Existing parallel user
sessions are not discovered or commandeered as a worker pool.

Each assessment records one small `parallelism_assessed` evidence event keyed
by Work ID, contract revision/hash, and policy hash. It contains proposed lane
IDs/scopes/dependencies, `parallel | solo | not_parallelizable`, selected
runtime class, and rationale. Completion records only result/evidence pointers,
not worker lifecycle state. Material scope changes invalidate the assessment;
ordinary prompts and tool calls do not cause repeated re-planning.

Review, reconciliation, and delegation policies use the same precedence:
current explicit user instruction, per-Work override, matched task harness,
project policy, user default, then product default. Existing installations
that omit policy resolve reconciliation and delegation to `off`; fresh init
materializes adaptive reconciliation and automatic delegation. Guided
init/policy configuration offers presets, while natural-language Work
instructions such as “이 작업은 5분마다 브리핑하고 병렬은 auto, tmux는 prefer”
append an evidenced Work-policy revision instead of requiring hand-written YAML.

## Multi-session concurrency and checkpoints

Work truth is shared; session position is not. Each session may keep one local
foreground cursor, and different sessions may point at the same or different
Works. Switching the cursor does not globally pause the old Work or replace
another session's foreground choice.

```yaml
schema_version: anamnesis.work-cursor.v1
cursor_id: cur_01...
client_session_ref: null # optional and diagnostic only
work_id: wu_01...
observed_revision: 12
last_event_id: lev_01...
projection_hash: "sha256:..."
worktree_fingerprint: "sha256:..."
updated_at: "<ISO-8601 timestamp>"
```

Before a same-Work write, a session reads the current ledger head and submits
that expected head under a short file lock. If another session advanced the
head, a new or different event fails without append; the caller must refold and
explicitly resubmit against the new head. Only the exact same event ID and body
is an idempotent retry with its original expected head. Conflicting requirement
ownership, status, completion, or review decisions require reconciliation;
they never use last-writer-wins or semantic auto-rebase. The lock exists only
for the local append/manifest update.
It carries an owner nonce, PID, and process-start evidence. A leftover lock is
reclaimed only when the original process is proven gone; age alone does not
authorize takeover. A repeated `event_id` with the same payload/hash is an
idempotent no-op, while the same ID with different content is corruption.
There is no long-lived writer lease, heartbeat, worker ownership, or process
supervision. The baseline guarantee is local processes sharing one filesystem
and canonical state root; it does not claim distributed locking over network
filesystems or multiple machines.

A checkpoint belongs to the Work ledger, not to a Session entity. Any session
may append a `checkpoint_recorded` event when its expected head still matches.
It records the ledger head, contract revision, projection hash, progress and
review hashes, worktree fingerprint, unresolved requirement IDs, and next
action. The session cursor merely points at the latest event it observed. On
resume, a behind cursor reloads the newer ledger tail before acting; it cannot
overwrite a newer projection. Concurrent sessions using the same repository
write scope receive an advisory overlap diagnostic, while git/worktrees and the
agent runtime remain responsible for code-write coordination.

Before compaction, flush the current source/ledger append and refresh the
bounded projection. After compaction, inject only the cursor's Work ID,
revision/boundary hash, lifecycle, progress counts, conflicts, pending review
gates, next requirement IDs, and source path. Raw prompt bodies remain
retrieval-only.

TTL controls attention and startup injection, never meaning. It may diagnose a
Work or cursor as stale, remove a digest from default startup context, and
garbage-collect disposable cursors. It cannot complete, abandon, supersede,
reclassify, waive, delete, or satisfy review.

## Work start and end boundaries

A Work starts automatically only for a durable deliverable with a plausible
independent acceptance/cancel decision. An explicit “start a new task/work” is
authoritative. With no current Work, the first durable deliverable creates one.
With a current Work, clarification, correction, implementation, tests,
documentation, and review stay in that Work when they share its stop contract.
An independently acceptable result creates another related Work. A read-only
question or interruption creates none.

If the prompt could reasonably amend the current Work or start/replace another
one, anamnesis retains a provisional source/allocation record but does not let
that ambiguity authorize repository writes or external effects. It asks one
concise boundary question unless later user text resolves the ambiguity first.

The minimal semantic lifecycle is `open`, `completed`, `abandoned`, and
`superseded`. Blocked, stale, review readiness, progress, and foreground are
derived views rather than lifecycle states. A Work becomes ready to close only
when every applicable requirement is verified or explicitly waived, conflicts
are resolved, the stop contract holds, and required review gates match the
current input hashes. Closure is authorized by either explicit user acceptance
or an earlier source event that clearly delegated objective completion to the
agent. Subjective or changed acceptance still requires the user.

Session stop, cursor switch, handoff, compaction, commit, PR creation, passing
tests, inactivity, and TTL never close a Work by themselves. `abandoned`
requires explicit cancel intent; `superseded` requires an evidenced replacement
relation. Premature completion is revoked and reopened append-only. New scope
after valid completion becomes a successor Work instead.

The shipped completion boundary is `anamnesis work close`. It currently accepts
only `lifecycle: completed`; `abandoned`, `superseded`, and reopen remain
fail-closed until their separate authority and cross-Work lineage contracts are
implemented. Completion requires exact expected ledger head, contract revision,
and contract hash values; an accepted requirements-ready projection with no open
conflicts; current completion-review readiness; non-empty evidence; and either
explicit user acceptance or an earlier objective-completion delegation source
already bound to the current contract. The close event binds that immutable
source envelope and freezes subsequent contract, requirement, review, and
delegation mutations. Exact same-event retries are idempotent.

## Privacy and portability

Raw prompt objects are local-private and ignored by version control by
default. Implementation must create private directories/files with restrictive
permissions (`0700`/`0600` where supported), use atomic no-follow writes,
reject symlink traversal, verify managed ignore rules before first capture,
exclude raw objects from anamnesis backups by default, and enforce configurable
byte/age review budgets. Secret-aware diagnostics warn without echoing the
matched value.

Immediate explicit purge is a baseline operation, not deferred work. The safe
default purge removes the body, content hash, and span hashes and leaves only
an opaque event ID plus timestamp/reason tombstone. Because raw objects are
event-scoped, purging one does not affect an identical prompt captured as a
different event. If one event is referenced by several units, purge is
event-wide and appends a `source_purged` record to every referring ledger
before replacing the envelope and deleting the body.

Allocation and purge of the same source event share a short source-event lock.
Any operation that also needs Work locks takes the source lock first and then
Work locks in sorted Work-ID order. Purge durably changes the envelope to
`purge_pending`, which blocks new allocations, scans authoritative ledgers for
all referrers, and appends the idempotent tombstone event to each under that
ordering. Only after every referrer is confirmed tombstoned does it atomically
remove the body while the envelope remains `purge_pending`, `fsync` the body
directory, atomically replace the envelope with the opaque `purged` tombstone,
and `fsync` the envelope directory. A crash before final publication therefore
leaves `purge_pending`, with the body either present or already absent; recovery
repeats the scan/appends by event ID, ensures the body is absent, and then
publishes `purged`. A final `purged` envelope can never legitimately coexist
with the source body, and diagnostics fail closed if that invariant is
violated. The protocol never exposes partial purge as success. This is a rare
storage protocol, not a Transaction task entity or general multi-Work
scheduler.

Retaining a confirmation-leaking hash requires a separate explicit choice.
The project may commit bounded unit
metadata and sanitized/current contract projections independently. Opting raw
bodies into repository, backup, or remote sync requires a separate explicit
privacy choice. Missing or purged raw bodies must be reported as unavailable
provenance, never replaced by an invented quote.

Context indexing stores IDs, hashes, classifications, and source pointers, not
raw prompt snippets. Any future MCP surface follows the same rule and requires
an explicit privileged read to return a raw body.

## Acceptance criteria

- Supported native capture round-trips every user-visible prompt payload with
  the same content hash and diagnoses tampering or downgraded fidelity.
- With capture absent/off an unlinked prompt performs no CLI/storage work.
  With bounded capture, identical native boundary plus identical bytes is
  idempotent, the same boundary plus different bytes fails closed, and two
  identical bodies in different turns retain distinct identities.
- Crash-ordering fixtures prove that a committed allocation never references
  an unpublished source body and that only a torn final ledger tail is
  recoverable.
- Every durably retained prompt event has an allocation state: accepted unit
  or provisional ambiguity. Pure interruptions/non-requirements leave no raw
  body unless full-prompt archival was explicitly enabled.
- Every active requirement has one canonical unit owner and at least one
  source event; supported exact-capture adapters also preserve a validated
  UTF-8 byte span or whole-event reference.
- Agent summaries can change without modifying source objects or prior ledger
  records.
- Duplicate, contradictory, corrected, cancelled, split, merged, and
  reclassified requirements retain complete lineage.
- Three compaction/resume cycles reproduce the same cursor-selected unit, revision,
  boundary hash, policy hash, requirement ownership, and progress.
- A 100-requirement fixture can receive later requirements in the same unit
  without renumbering or losing earlier source events.
- A months-long synthetic session demonstrates contract revisions, linked
  independently completable Works, no theme/container object, and no
  time-based semantic split.
- Two sessions may select different foreground Works without changing either
  unit. Two sessions appending to one Work preserve both unique event IDs;
  expected-head conflicts cannot overwrite a newer projection.
- Session cursors can be deleted without losing Work requirements, progress,
  lifecycle, reviews, or the latest shared checkpoint.
- Work-start fixtures distinguish durable deliverables from same-Work
  amendments and interruptions. Work-end fixtures prove that only the accepted
  stop contract plus current evidence/reviews can close a Work.
- Concurrent sessions with overlapping dirty paths or external side-effect
  keys are diagnosed before writes without adding a scheduler or lease system.
- Existing projects resolve to review preset `off`; `advisory`, `strict`, and
  `custom` resolve deterministically with visible provenance.
- Existing projects resolve reconciliation and delegation to `off`. A
  `frequent` Work produces a deterministic requirements/done/remaining/
  progress briefing at supported due boundaries, deduplicates an unchanged
  snapshot, and continues the same turn unless a genuine decision is blocked.
- Parallel-policy fixtures reject unsafe dependency or write/effect conflicts,
  record at least two safe ready lanes under `prefer`/`required`, respect the
  maximum agent count, and never treat recorded delegation results as
  verification. The external runtime, not anamnesis, launches those lanes.
- Native/tmux runtime preference and unavailable behavior resolve
  deterministically. A repeated failure fingerprint is not relaunched until an
  input changes, and every delegated child receives a bounded Work contract
  even when it has no SessionStart injection.
- Under `strict`, configured OMX authorization fallback followed by a
  successful runtime-attested Codex native review for the current input hash
  passes the gate. The protected transition remains blocked
  until a current-input-hash review passes or is explicitly waived; exhausting
  all providers records `blocked_unavailable`.
- Raw prompt bodies never appear in compact digests, context-index snippets,
  routine logs, telemetry, or default MCP resources.
- Raw storage passes permissions, no-follow/symlink, managed-ignore, budget,
  backup-exclusion, secret-diagnostic, and purge tests without echoing content.
- Purging a multi-unit-referenced event tombstones every referrer, while
  purging one of two identical event-scoped objects leaves the other intact.
- Concurrent allocation against `purge_pending` fails closed, and recovery
  completes an interrupted multi-Work purge idempotently before deleting the
  source body.

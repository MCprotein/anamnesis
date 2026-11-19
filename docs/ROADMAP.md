# Roadmap

Version-by-version plan. Brief summary lives in [README.md](../README.md);
this file is the canonical source.

v1.0 and later follow semver. Before v1.0, minor version bumps could include
breaking changes. Feature timing is best-effort; items can move between
releases as user feedback and verified product evidence arrive.

Release-state note: roadmap sections can describe main-branch design and WIP
before the corresponding package is published. Verify public availability with
the registries, not roadmap headings. During the 2026-07-02 v1.7.0 release
cut, both npmjs.org and GitHub Packages still reported
`@mcprotein/anamnesis@0.7.0` as latest; release prep must publish npmjs.org and
GitHub Packages in parity before marking the public package complete.

Branch-state note: version-specific work should happen on `release/vX.Y` branches with focused `feat/vX.Y/<topic>`
branches, then merge to `main` only when that release line is verified and
ready to tag. After publish and post-publish smoke pass, delete the merged
release branch locally and remotely unless a documented blocker or immediate
patch recovery need remains. This keeps roadmap WIP, package version, registry
state, and branch inventory from drifting apart.

## Product north star

anamnesis exists to make AI coding agents remember a project without the
user repeating setup instructions every session.

Three promises drive the roadmap:

1. **Always inject the right context and ontology** — project memory,
   ontology slices, handoff state, operating rules, hooks, skills, and
   command intent should be installed, refreshed, and discoverable by the
   active agent.
2. **Let users switch agents without re-briefing** — moving between Claude
   Code, Codex, Cursor, or another adapter should preserve enough context
   for the next agent to continue from the same project state with no
   bespoke "read these files first" prompt from the user.
3. **Keep work units faithful through compaction** — a large requirement set,
   its execution and review rules, its evidence-backed completion state, and
   the remaining work should survive context compression without the user
   repeatedly asking the agent to recount everything.

This means user-facing parity matters more than identical native UI.
Adapters may render to different surfaces because the tools expose
different primitives, but the resulting agent experience should preserve
project recall, ontology access, handoff continuity, and operational
guardrails.

The same boundary applies to ontology automation. Layer A introspectors
should establish a reliable factual baseline from files the CLI can parse:
routes, resources, models, package signals, and other high-confidence facts.
They are not meant to become exhaustive framework-specific knowledge engines.
Layer B should use the active agent to read those facts plus project docs and
code, then generate the semantic context that makes future agent sessions
effective: relationships, flows, intent, invariants, and open questions.

---

## Shipped release history

Shipped sections from v0.1 through v1.17 live in `docs/roadmap/`:

- [v0.1 – v0.9](roadmap/v0.1-v0.9.md)
- [v1.0 – v1.9.6](roadmap/v1.0-v1.9.md)
- [v1.10 – v1.17](roadmap/v1.10-v1.17.md)

---

## v1.18 — released 2026-08-20; continuity follow-ups

> **Theme: evidence-backed work-unit continuity across long agent runs**

### Codex native hook trust boundary

Later releases also closed a runtime safety gap in Codex hook installation
(see the v1.22 entries in [CHANGELOG.md](../CHANGELOG.md)). `status` and `doctor` distinguish local registration from
Codex's `trusted`, `untrusted`, `modified`, and `managed` runtime states, and
`hooks codex trust --dry-run|--apply` provides a separate explicit approval
step. Approval consumes only app-server-returned keys and hashes for exact
Anamnesis-owned project hooks, revalidates them immediately before an atomic
configuration upsert, preserves unrelated state, and fails closed for changed
definitions, unsupported RPCs, and linked-worktree source substitution.

Long-running agent work has a different continuity failure from switching
tools or sessions: the original task may contain dozens or hundreds of
requirements, and repeated context compaction can gradually erase individual
constraints even while the agent still remembers the general goal. Users can
counteract this by periodically asking the agent to restate the requirements,
completed work, remaining work, and progress. v1.18 should automate that
reconciliation while using less prompt context than repeated full-task
restatement. A requirement list alone is not enough: the same durable unit
must also remember how the user expects the work to be planned, reviewed, and
allowed to finish. It should also be able to say “brief and continue every few
minutes/actions” and “use safe parallel agents, preferring or requiring tmux
for this Work” once, instead of making the user repeat those instructions.

The storage/core slice is implemented: canonical local state-root resolution,
immutable exact-byte source objects, coupled source-to-ledger transactions, a
hash-linked expected-head-CAS ledger with torn-tail recovery, deterministic
projections and progress, and disposable independent multi-session cursors.
Managed storage rejects symlink traversal, applies private modes, and uses
bounded durable locks. Its acceptance evidence passed 48/48 targeted tests and
789/789 tests across 81 files, plus typecheck, lint, and diff checks; an
independent review returned `APPROVE`.

The Agentfile v2 and pure Work-policy resolution slice is also implemented.
Agentfile v2 strictly accepts optional `settings.work_policy`; new `init`
output materializes adaptive reconciliation, advisory review, automatic
delegation assessment, and bounded repository-side prompt capture. Existing
Agentfiles that omit these settings preserve legacy all-off behavior.
Existing v1 files migrate explicitly and idempotently by changing only the
version while preserving a backup. A side-effect-free resolver applies the
fixed current-instruction, per-Work, matched-harness, project, user, and product
precedence; preserves stronger required review gates unless a current,
evidenced gate/revision waiver lowers one; freezes deterministic
provenance-aware `policy_hash` snapshots by contract revision; and reports
policy/provenance drift. It normalizes declarative OMX-to-Codex-native review
fallback and keeps required parallelism fail-closed after provider exhaustion,
but does not launch or supervise either runtime. Fresh verification passed
48/48 targeted tests and 808/808 tests across 82 files, plus typecheck, lint,
build, and diff checks; independent QA returned `SIGNOFF` and independent code
review returned `APPROVE`. This does not complete v1.18: provider
orchestration, handoff/index integration, benchmarks, optional MCP export, and
cross-host coordination remain deferred.

The typed Work-contract and reconciliation foundation is now implemented as
well. Canonical contract revisions preserve prior requirements unless an
explicit, acyclic replacement lineage is supplied; same-ID semantic mutation,
source removal, unevidenced waiver, and direct lifecycle closure fail closed.
The projection derives deterministic weighted or unweighted progress and
reports requirement readiness without claiming review or closure authority.
Reconciliation builds bounded, hash-stable briefings over the complete
projection, computes deltas and due decisions from validated policy, and binds
delivery confirmation to the exact ledger head, contract revision/hash, policy
hash, and briefing fingerprint in each disposable session cursor. Exact source
envelope bytes are hash-bound into the ledger, while stable-order multi-source
locks keep every referenced prompt object protected through append and fsync.
Pre-binding ledgers require an explicit dedicated migration event; ordinary
publication cannot mint or override envelope-binding authority. Fresh
verification passed 120/120 targeted tests and 868/868 tests across 84 files,
plus typecheck, lint, build, import, and diff checks; independent adversarial
verification and final code review returned `APPROVE`. Runtime-neutral
review/delegation evidence is implemented in the later slice below; provider
orchestration and final lifecycle transitions remain deferred.

The first thin Work command slice is implemented. The `work` namespace offers
`create|amend|transition|status|brief|confirm|switch` with strict draft and
raw-source boundaries, source-first typed contract mutation, evidence-only
progress, authoritative ledger refolding, and human/JSON reconciliation.
Per-session cursors use bounded locks and revision CAS; briefing delivery is
persisted pending before output and confirmed only after a complete direct-TTY
human write or an explicit confirmation token. Non-TTY/JSON output, EPIPE, and
crash seams remain unconfirmed and safely repeatable. A Work keeps its frozen
policy across ordinary amendments and reports later Agentfile changes as
drift. Required planning review blocks implementation entry until current,
input-hash-matched review evidence is recorded, and same-requirement concurrent
progress fails closed instead of using last-writer-wins. Fresh verification passed 146 targeted Work tests
and 894/894 tests across 88 files, plus typecheck, lint, build, and diff checks;
independent code review returned `APPROVE` and adversarial verification
returned `PASS`.

The first automatic Work reconciliation boundary is implemented behind the
existing executable-adapter opt-in. Dedicated Claude Code and Codex
`UserPromptSubmit` wrappers forward native JSON only through stdin, require
documented stable session/turn identity, fail open, and never log, fingerprint,
or return submitted prompt text. With capture absent/off they do not persist
it; with explicit bounded capture they may stage private `client_exact` UTF-8
bytes until the foreground agent records one explicit outcome. The handler refolds only the
session-selected Work, uses its frozen policy, and records additional-context
delivery as `injected_unconfirmed` rather than visible confirmation. Compact
context structurally preserves the completion contract, delta, configured
review gates, changed/at-risk requirements, next action, blockers, and an
authoritative status command; oversized full output falls back atomically
without a partial list. Codex omits a per-prompt status message so an explicitly
disabled or legacy-unconfigured policy is visually silent. Fresh verification passed 79 focused review tests and
914/914 tests across 89 files, plus typecheck, lint, build, adapter parity,
status, and diff checks; independent review returned `APPROVE` and adversarial
verification returned `PASS`. The remaining non-blocking cost is foreground
CLI cold-start on prompt boundaries; measure it before adding more frequent
hook events.

Bounded raw prompt staging and allocation are now implemented as the next thin
slice. Agentfile v2 accepts optional `settings.work_prompt_capture` without a
new schema version; fresh init materializes `bounded`, legacy absence remains
off, and users can review or disable the policy in the installation Git diff.
Native boundary identity derives an
opaque stage/source ID without prompt bytes, identical retries are idempotent,
and same-ID/different-body input fails closed. The foreground control path must
choose same-Work, new-Work, provisional retention, or discard and supplies
exact Work head/revision/hash authority where applicable; it never infers the
current cursor as ownership. Provisional sources bind later without envelope
mutation, discarded entries commit content-free receipts before cleanup, and
bounded GC shares the stage locks. Explicit `work prompt gc` enforces TTL and
repairs expired partial/temp residue without a daemon. Stage/source/Work lock order and deterministic
events make crash retries recoverable while keeping the design daemon-free.

Runtime-neutral review/delegation evidence and contextual readiness are now
implemented. Four source-free typed event families record review requests,
review attempts, parallelism assessments, and delegation outcomes; an explicit
user delegation waiver is the fifth, source-bound family. Projection stores
only bounded durable evidence, while a pure evaluator derives current
protected-action readiness from policy-conditional inputs canonicalized by a
bounded repo-file and allowlisted read-only Git adapter. Nested
`work review request|record`, `work delegation assess|record|waive`, and
`work readiness` commands expose the contract. Existing-Work mutations require
an explicit `expected_head`; exact retries remain idempotent, but stale new
events append nothing and are never auto-rebased. Required review and
parallelism stay fail-closed. OMX authorization or unsupported-authority
outcomes may select Codex native only when allowed by the frozen policy and
current capability. Identity remains visibly `runtime_attested`, and anamnesis
does not launch, supervise, retry, or shut down any provider, native-agent, or
tmux lifecycle. Fresh verification passed the targeted and full test suites,
typecheck, lint, build, dogfood, and diff checks without relying on a brittle
test-count claim.

The storage and responsibility boundaries are:

- **Work unit**: the only durable task-domain object: one unit of user intent,
  lifecycle, review rules, requirements, progress, checkpoints, and source
  pointers, bounded by one independently completable delivery contract.
- **Source event**: one immutable user-authored prompt payload plus capture
  fidelity, content hash, and allocation metadata. It is not agent-cleaned
  prose and it is not a full conversation transcript.
- **Task harness**: the stable success contract for a task or task class.
- **Requirement ledger**: append-only source allocation, interpretation,
  correction, status, and lineage events for one work unit.
- **Projection**: the clean current requirement/progress view derived from the
  ledger. It is operational state, not source provenance.
- **Evidence**: the proof that supports a status transition.
- **Handoff**: the session or agent-switch resume pointer.
- **Session cursor**: a disposable, non-authoritative local pointer to one Work
  revision/event; it is not a task, checkpoint owner, or execution record.
- **Context index**: a regenerable lookup surface for those authoritative
  files, never the source of truth.

Work units are the sole authority for an in-flight task instance. Reusable
task harnesses remain templates/policy sources whose resolved refs and hashes
are snapshotted into an accepted Work contract revision. v1.18 must migrate or deprecate legacy
`current` harnesses so two mutable goals, stop conditions, or scopes cannot
compete for the same task.

The work-unit identity should remain bounded under
`.anamnesis/work-units/<id>/unit.yaml`, while exact prompt objects, immutable
event envelopes, one append-only ledger, the current projection, and disposable
session cursors use the layout defined in
[Work Unit and Requirement Ledger Design](WORK-UNIT-DESIGN.md). A single YAML
file is insufficient once a user keeps adding verbatim requirements for weeks
or months. Ledger packing/rotation remains deferred until profiling proves it
necessary and can never change semantic identity.

Work-unit lifecycle stays minimal: `open`, `completed`, `abandoned`, and
`superseded`. Blocked, stale, review readiness, progress, and foreground are
derived views, not semantic lifecycle states. A session can switch its local
foreground cursor without pausing a Work for every other session.

Requirement entries use stable IDs and explicit states: `pending`,
`in_progress`, `implemented_unverified`, `verified`, `blocked`, and `waived`.
Each entry preserves the requirement text or an exact source pointer, its
status, evidence references, and `updated_at`. Optional weights are allowed
only when the task author explicitly supplies them.

Progress must be reproducible. The default percentage is verified applicable
requirements divided by all applicable requirements. `waived` entries are
excluded from the denominator, while `blocked` entries remain applicable;
`implemented_unverified` is reported separately and does not inflate
completion. A weighted percentage is valid only when explicit weights exist.
The agent must not invent a subjective percentage from prose or diff size.

Product and efficiency boundaries:

- Do not inject the full requirement list on every prompt or every tool call.
- Do not add a timer daemon for periodic briefings. Evaluate time/action
  thresholds at the next supported safe hook, response, resume, or Work-command
  boundary, deduplicate by cursor fingerprint, then continue the same turn.
- Do not store full transcripts or hidden agent/runtime messages. Stage exact
  user input only long enough to classify it; durably retain raw bodies only
  when allocated to a work unit or provisionally ambiguous. Pure interruptions
  and non-requirements discard their bodies by default. Keep retained bodies
  local-private and out of default injection/index/export surfaces.
- Do not infer semantic completion from a changed file, commit, or passing
  command alone. Deterministic tooling can validate evidence references and
  freshness; an agent must reconcile meaning against the original requirement.
- Do not let hooks silently mark work verified or finalize the ledger.
- Keep checkpoint reminders deduplicated by work-unit/evidence/worktree
  fingerprint.
- Keep each session's one cursor-selected work-unit digest small and
  pointer-first; retrieve
  individual requirements, rules, reviews, or evidence only when needed.
- Do not silently replace a required independent review with self-review.
  Resolve configured providers in order; OMX authorization/authority failure
  selects Codex native as the next provider only when configured and allowed.
  A strict protected
  transition remains blocked from `pending` onward until a current-input review
  passes or the user explicitly waives it; exhausting providers specifically
  records `blocked_unavailable`.
- Do not rely only on a live project preference at resume time. Materialize the
  resolved rules and their source/hash into the work unit so compaction and
  later policy edits cannot erase or silently rewrite the accepted contract.
- Do not use wall-clock TTL to expire a planning or PR/code review. Review
  validity follows the reviewed input hash; material plan or diff changes make
  the old review stale immediately.
- Do not let TTL complete, abandon, supersede, waive, or delete a work unit.
- Do not add a daemon, scheduler, worker queue, Job/Run/Attempt hierarchy,
  heartbeat, long-lived lease, or provider retry manager. Agent runtimes execute
  work and reviewers; anamnesis injects policy, records events/evidence, and
  validates close conditions.
- Do not make anamnesis launch, schedule, supervise, or shut down native agents
  or tmux panes. It may require a bounded parallelism assessment, select an
  allowed runtime class through resolved policy, and record the result; the
  current Codex/Claude/OMX runtime owns execution.
- Keep one compact `work` namespace for Work lifecycle commands, and reuse
  `context`, `handoff`, `benchmark`, and diagnostics for their existing
  responsibilities instead of creating parallel command families.
- Keep repo-local files authoritative. No daemon, remote database, or hosted
  task service is required for the baseline.
- Resolve one canonical local Work state root per repository instance. Normal
  checkouts use project `.anamnesis`; linked Git worktrees share the primary
  worktree's `.anamnesis`. A mismatched/unavailable root blocks Work writes
  instead of silently forking the ledger. Independent clones and hosts do not
  claim live synchronization.

Work plan:

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Thin Work boundary, schema, and lifecycle** | completed closure implemented; abandon/supersede/reopen deferred | Keep Work as the only durable task-domain object. `work create` requires `new_unit`, `work amend` requires `same_unit`, and interruption is rejected rather than allocated. Typed creation and monotonic contract revision preserve requirement identity, source provenance, frozen policy snapshots, accepted-boundary state, and explicit replacement lineage. `work close` now records source-authorized, evidence-backed `open → completed` transitions only after requirements and current completion gates are ready, with exact CAS and terminal-history mutation guards. Explicit cancel, cross-Work supersession, and revocation/reopen remain fail-closed pending their separate authority and lineage rules. Foreground is a disposable per-session cursor, never global Work state. |
| 2 | **Verbatim source-event ledger and projection** | bounded native prompt staging/allocation implemented; exact-span UI deferred | Immutable exact-byte prompt objects, canonical envelopes, hash-linked allocation records, monotonic typed contracts, deterministic projection rebuilds, stable-order multi-source locking, exact envelope-hash binding, torn-tail recovery, and corruption/symlink fail-closed behavior are implemented. Reviewed Agentfile v2 bounds enable or disable private UserPrompt staging; Codex/Claude adapters preserve `client_exact` UTF-8 bytes and expose an opaque four-way same/new/provisional/discard allocation contract. Explicit GC enforces TTL and repairs partial/temp crash residue without a daemon. Raw paths remain outside Git, backups, context index, logs, hook context, and default MCP. Exact sub-prompt span allocation remains planned. |
| 3 | **Evidence-based progress reporter** | deterministic core and CLI rendering implemented; evidence freshness diagnostics deferred | Projection, status, and briefing output report verified/applicable, pending, in-progress, implemented-unverified, blocked, and waived counts with explicit denominator/weights. Invalid, overflowing, inconsistent, or provenance-free states fail closed. Human and JSON presentation refold the ledger instead of trusting projection cache; deeper evidence freshness diagnostics remain planned. |
| 4 | **Automatic reconciliation briefing** | prompt and same-turn safe-hook emission plus prompt classification control implemented; compaction/close triggers deferred | Agentfile v2 and the pure resolver normalize `off`, `adaptive`, `frequent`, and `custom`. Reconciliation builds complete bounded snapshots, deterministic deltas/fingerprints, validated due decisions, and exact prepare/confirm delivery tuples. `work brief` renders the ordered requirements/done/remaining/blockers/progress/next contract. Dedicated Claude Code and Codex `UserPromptSubmit` adapters handle foreground prompt boundaries and, when bounded capture is enabled, combine the due briefing with an opaque explicit allocation obligation. Codex `PostToolUse` and Claude Code batch-level `PostToolBatch` evaluate meaningful-action and silence cadence during a long turn without a daemon. Wrappers discard tool payloads, one durable lock-scoped cursor mutation deduplicates stable boundary IDs, and hidden context remains `injected_unconfirmed`. Compaction-specific and close-specific native triggers remain research-first. |
| 5 | **Per-Work automatic delegation and runtime policy** | evidence, contextual readiness, and CLI implemented; provider execution deferred | The resolver normalizes `off`, `auto`, `prefer`, and `required` parallelism, maximum agents, native/tmux preferences, fallback order, reassessment triggers, and unavailable behavior. Typed assessments and delegation outcomes preserve structured lanes, child contracts, failures, results, and source-bound user waivers; changed scope/capability invalidates contextual readiness by hash. Required parallelism fails closed after provider exhaustion. `work delegation assess|record|waive` records runtime-neutral evidence, but actual native/tmux launch, supervision, retry, mailbox, worktree, and shutdown remain runtime-owned and deferred. |
| 6 | **User-configurable independent-review gates** | evidence, contextual readiness, and CLI implemented; provider execution deferred | Agentfile v2 and the resolver normalize `off`, `advisory`, `strict`, and `custom` planning/completion gates across six policy layers. Required gates merge monotonically; only a current evidenced gate/revision waiver can lower one. Typed request/attempt evidence, current-input hashing, minimum distinct reviewer counts, invalidation, provider fallback, and `work review request|record` plus `work readiness` are implemented. Required gates fail closed. OMX failure may select Codex native only when configured; anamnesis records `runtime_attested` opaque identity inequality but does not launch reviewers or claim host-authenticated independence. |
| 7 | **Multi-session checkpoints and Work boundaries** | cursor CAS, explicit boundary commands, and switch implemented; automatic semantic classifier deferred | Each session has a disposable revision-CAS cursor with exact reconciliation delivery state, while shared truth remains the Work ledger/projection. Canonical roots, linked-worktree sharing, bounded locking, atomic writes, symlink rejection, cursor lag recovery, independent cursor switching, and explicit new/same/interruption command classification are implemented. Automatic natural-language same-Work versus new-Work classification remains planned. |
| 8 | **Compaction-aware adapter lifecycle** | prompt-boundary path implemented; compact lifecycle research first | Claude Code and Codex `UserPromptSubmit` payloads are handled through dedicated fail-open wrappers using stable session/turn identity where documented. Continue to audit each supported client/version before naming native `PreCompact`, `PostCompact`, or compact-resume events. The current renderer does not claim a proven compact lifecycle path. Add version-gated native handling only after evidence exists, behind `--allow-exec-adapters`; otherwise keep tested prompt, manual, SessionStart, and resume fallbacks. |
| 9 | **Compact checkpoint digest** | planned | After a shared Work checkpoint or compaction, inject only the cursor-selected Work ID, goal hash/source pointer, revision, lifecycle, verified/applicable count, pending review gates, blockers, next requirement IDs, and the unit path. Keep unconditional per-prompt injection disabled; use the existing prompt gate and fingerprint dedupe before adding any prompt-time reminder. |
| 10 | **Handoff, resume, index, TTL, and diagnostics integration** | planned | Include the local cursor and latest shared Work checkpoint in handoff/resume output; index authoritative ledger events plus individual requirement and rule pointers; diagnose missing source refs, stale evidence/reviews, verified entries without evidence, cursor revision lag, ledger-head conflicts, and digest/unit divergence. TTL may mark dormant Works stale, exclude digests, and garbage-collect disposable cursors; it never mutates Work meaning. |
| 11 | **Work-unit continuity and policy benchmark** | planned | Add public-safe long-task fixtures, including a 100-requirement task, briefing and parallelism presets, review presets/provider fallback, task switches, concurrent sessions, and repeated manual/automatic compaction simulations. Measure requirement/rule retention, gate bypasses, false-complete rate, verified-evidence coverage, digest/briefing tokens, retrieval turns, duplicate reminders, safe delegation decisions, and progress reproducibility before making performance claims. |
| 12 | **Optional MCP export gate** | 2026-07-28 spec audit complete; prototype deferred | Keep CLI/files as the baseline. The stable `2026-07-28` specification requires no migration because anamnesis currently implements no MCP surface. If dogfood proves cross-client file/CLI access is a real bottleneck, prototype a read-mostly resource/tool surface and compare latency, prompt tokens, cache hit behavior, trust surface, and maintenance cost before accepting it. |

### Work-unit review policy

The work unit should carry user-configurable action gates, not universal prose
reminders. Existing projects that omit policy resolve to preset `off`; fresh
init materializes `advisory`, and users may choose
`advisory`, `strict`, or `custom` globally, per project, by matched task
harness, or per unit. Required gates merge monotonically so a weaker lower
precedence default cannot silently remove a stronger requirement. Current
explicit user instructions/waivers take precedence, followed by per-unit,
task-harness, project, user-level, and product defaults. The resolved snapshot
and all sources are stored in the current accepted contract revision; later policy changes produce
a diagnostic rather than silently mutating in-flight work.

```yaml
policy:
  source_refs:
    - "AGENTS.md#review-policy"
  resolved_at: "<ISO-8601 timestamp>"
  policy_hash: "sha256:..."

review_gates:
  - id: planning-review
    enforcement: required
    protects: implementation_start
    reviewer:
      capability: independent_agent
      role: critic
      min_count: 1
      independent: true
    unavailable: fail_closed
    state: pending
    input_hash: null
    artifact_refs: []

  - id: pr-code-review
    enforcement: required
    protects: work_close
    reviewer:
      capability: independent_agent
      role: code-reviewer
      min_count: 1
      independent: true
    unavailable: fail_closed
    state: pending
    input_hash: null
    artifact_refs: []

review_provider_preferences:
  provider_order: [omx, codex_native, separate_process]
  fallback_on: [authorization_error, unsupported_authority, unavailable]
```

Gate states are `pending`, `requested`, `passed`, `changes_requested`,
`blocked_unavailable`, and `waived`. These are ledger/projection fields, not
provider-process states. A waiver requires a user decision pointer plus a reason. Planning
review hashes the accepted task contract and plan. PR/code review hashes the
reviewed base/head or worktree diff plus required verification evidence. If
those inputs change materially, the gate returns to `pending`; time alone does
not invalidate or satisfy it. `changes_requested` keeps the protected action
unready until the findings are resolved and a fresh independent
review passes. Under `strict`, every state except an input-hash-matched `passed`
or evidenced `waived` blocks the protected transition. A provider failure is
not permission to proceed: OMX authorization or documented-leader-proof errors
must fall through to Codex native subagents when available, and exhausting all
providers sets `blocked_unavailable`. `advisory` uses the same default planning
and completion checkpoints but records unavailability or findings without
blocking. `custom` normalizes each gate to `off`, `advisory`, or `required`
enforcement. The current agent runtime, not anamnesis, performs OMX/Codex-native
fallback; anamnesis injects the preference and records each result as an
`activity_id`-grouped ledger event. Self-review cannot satisfy an independent
gate.

Project policy now has a strict optional home at Agentfile v2
`settings.work_policy`. New `init` output uses v2 and materializes the active
default profile; explicit `off` disables individual behaviors. Existing files
that omit the field retain the legacy all-off resolver. Existing v1 files migrate explicitly and
idempotently by changing only `version`, with a backup on apply; v1 continues
to reject v2-only policy fields. Preset-first `anamnesis init --review-preset`,
a guided `anamnesis context policy configure --scope user|project`, user-level
platform/XDG policy, and visible resolution in `status`/`doctor` remain
planned. Detailed custom rules may later live in a referenced policy file or
task harness instead of making users hand-author every gate.

### Automatic briefing and parallel execution policy

Reconciliation is an action on the current Work snapshot, not a conversational
habit the user must keep prompting. `adaptive` briefs on resume, contract
revision, compaction recovery, meaningful milestones, and close. `frequent`
adds a default due threshold of five minutes or five evidence-bearing actions.
`custom` controls triggers, maximum silence/action count, compact/full detail,
and compact/chunk targets. A due threshold is checked only at the next
supported safe hook, response, resume, or Work-command boundary, so it adds no
daemon and does not interrupt an idle process. The briefing reports the
goal/invariants, requirements changed since the previous snapshot,
verified/applicable counts, reproducible percentage, blockers, gates, next
IDs, and next action, then the agent continues in the same turn. Compact mode
uses deterministic grouping and pointers when the target is tight; full mode
enumerates all requirements/invariants in ordered chunks and never silently
truncates. Its time/fingerprint counters are disposable cursor state, not
canonical ledger traffic.

Delegation is likewise a resolved Work policy rather than an executor inside
anamnesis. `parallelism: auto` delegates only when two or more dependency-
independent lanes have ready inputs and coordination benefit exceeds overhead;
`prefer` makes safe delegation the default; `required` protects the assessment
and requires an allowed runtime or waiver when safe lanes exist; `off` remains
solo apart from separately required review gates. Native-agent and tmux-Team
preferences each support `never`, `auto`, `prefer`, and `required`, with a
bounded maximum-agent count, fallback order, and unavailable behavior. Native
agents fit small same-session fan-out; tmux Team fits durable, long-running, or
operator-visible coordination. The agent runtime owns launch, worktrees,
mailboxes, retries, and shutdown. Anamnesis injects the resolved choice and
records one `parallelism_assessed` event per material contract/policy revision,
including lane scopes/dependencies, the selected runtime class, and why the
Work ran parallel, solo, or `not_parallelizable`.

Provider fallback never weakens `parallelism: required`: provider exhaustion
may fall back to solo only for `auto`/`prefer`. Required parallel work remains
`blocked_unavailable` until an allowed provider succeeds or the user records a
waiver; a required tmux surface cannot be satisfied by native agents. `solo` is
not a provider-order value.

Review, reconciliation, and delegation share the precedence already defined
above. Existing projects that omit policy resolve the behaviors to `off`;
fresh init materializes the active profile, while guided policy
configuration and a natural-language per-Work instruction both append the
resolved policy and source/hash to a new contract revision.

### Requirement ledger and work-unit boundaries

Every prompt allocated to a work unit, or provisionally ambiguous, is retained
as an immutable source event before the agent normalizes it. Exact source text
and its hash remain canonical; the clean requirement list is a separate
projection with stable source event/span refs. Pure interruptions and
non-requirements discard their raw bodies after staged classification unless
the user separately opts into full-prompt archival.
Rambling, duplicate, corrective, or contradictory prompts therefore remain
faithful in the original chronology while agents and users operate on a clean
current contract. Corrections and improved interpretations append lineage
records instead of editing history. Raw prompt bodies stay local-private and
are excluded from normal SessionStart, context-index snippets, logs,
telemetry, and MCP resources.

A work unit is bounded by one user-recognizable acceptance/release/cancel
decision, not by chat session, topic, file set, reviewer, elapsed time, or token
count. A later requirement stays in the same unit when it contributes to that
same verdict; the ledger grows and the contract revision advances. Separate
write scopes, deadlines, reviewers, or verification paths are agent-runtime
execution signals only. Create another Work only when the result can be
accepted, shipped, cancelled, or rolled back independently without changing
the current Work's completion verdict. Persist
unit/revision/boundary hashes and reason codes so compaction cannot cause
reclassification drift.

Very long vaguely related sessions keep finite Works connected by bounded
relations such as `related_to` or `successor_of`; the baseline adds no
WorkStream container. Boundary ambiguity is captured provisionally first so
the raw request is not lost, but it cannot authorize repository writes or
external effects. Ask the user only when multiple completion contracts are
plausible or ownership/cancel/replace/conflicting effects would materially
change action. Reclassification preserves old IDs and appends successor
mappings. See [Work Unit and Requirement Ledger
Design](WORK-UNIT-DESIGN.md) for the complete contract.

### Multi-session switching, Work closure, and TTL

Default switching policy:

1. A same-completion-contract follow-up appends its exact source event to the
   current ledger and updates the contract revision without replacing old text.
2. Implementation, tests, documentation, and review remain events/evidence in
   the Work unless their result has an independent acceptance decision.
3. A short read-only question is an interruption and does not replace the
   foreground unit.
4. A safe unrelated task appends a shared checkpoint when useful, then changes
   only the current session's cursor. It does not globally pause the old Work.
5. An explicitly parallel independently acceptable task gets its own Work.
   Multiple sessions may point at the same or different Works.
6. Ask the user when the new request might mean cancel/replace, when dirty
   write scopes overlap, when external side effects are still in flight, when
   stale source/git state makes resumption intent uncertain, or when a required
   gate needs a waiver.

TTL is a retention and attention budget, not task intent. `last_activity_at`
plus a configurable `stale_after` may mark a unit stale, exclude its digest
from default SessionStart context, and surface a diagnostic. The canonical
unit and source pointer remain queryable. Resuming a stale unit revalidates its
source refs, revision, git/worktree fingerprint, evidence, and review hashes
before work continues. Cursor TTL may garbage-collect a disposable local
cursor. No TTL path may auto-complete, abandon, waive, supersede, or delete the
Work.

Checkpoint flow:

1. At prompt receipt, stage the exact source payload and capture fidelity;
   create/select a work unit, then retain the immutable event only when it is
   allocated/provisional, allocate exact event spans, assign stable
   requirement/review IDs, and snapshot boundary and policy hashes.
2. After meaningful implementation or verification evidence, reconcile only
   affected entries and recompute deterministic progress.
3. Before a protected action such as implementation start or Work close,
   enforce required planning or completion-review gates against their current
   input hashes.
4. Before compaction, append or refresh a shared Work checkpoint if the
   expected ledger head still matches and emit an
   advisory if semantic reconciliation is needed; do not guess missing states.
5. After compaction, or on a compact-resume event, inject the bounded digest
   and source pointer before the next model request.
6. On a foreground task switch, checkpoint the old Work when useful and update
   only the session cursor unless the switch is ambiguous or unsafe.
7. At Stop or handoff, refresh the pointer, unresolved requirements, pending
   review gates, and next action without auto-closing the Work.

A Work closes as `completed` only when every applicable requirement is
verified or explicitly waived, conflicts are resolved, the stop contract is
satisfied, and required reviews match the current input. Explicit user
acceptance authorizes closure; a prior prompt may also delegate objective
closure to the agent. Session stop, handoff, cursor switch, compaction, commit,
PR creation, tests, inactivity, and TTL never close a Work. Explicit cancel
intent produces `abandoned`; evidenced replacement produces `superseded`.
Premature completion appends `completion_revoked` and `reopened`; genuinely new
scope after valid completion creates a successor Work.

### MCP 2026-07-28 review

The stable MCP `2026-07-28` revision materially changes the shape of a future
anamnesis export, but it does not require an immediate code migration. The
current package has no MCP SDK dependency and exposes no MCP client or server;
the local CLI and files remain the supported continuity interface.

If the optional export gate is later satisfied, the target contract is:

- implement the stateless protocol core, required `server/discover`, and
  per-request protocol/client capability metadata; do not introduce hidden
  transport-session state or depend on `Mcp-Session-Id`;
- expose ontology, handoff, harness, work-unit, and evidence pointers primarily
  as deterministic resources, with stable ordering, `ttlMs`, project-safe
  `cacheScope` (`private` by default), source hashes, and `lastModified`
  metadata;
- carry any cross-call work-unit selection as an explicit handle so the model
  can see and replay it;
- treat the `io.modelcontextprotocol/tasks` extension as an optional transport
  for genuinely long-running CLI operations, not as the authoritative
  work-unit state;
- return the required `resultType`, use `-32602` for a missing resource, and
  use `subscriptions/listen` only if live invalidation proves worth its runtime
  cost;
- avoid new reliance on deprecated Roots, Sampling, Logging, or legacy
  HTTP+SSE behavior.

Official references: [MCP 2026-07-28 release overview](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
and [specification changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog).

Exit criteria:

- A 100-requirement fixture retains every stable ID and source pointer across
  at least three compaction/resume cycles.
- The same fixture can receive additional prompts in the same unit; exact
  source events retain their content hashes while the clean projection evolves.
- Required planning and PR/code-review gates survive the same cycles, block
  protected actions until an input-hash-matched review passes or is
  explicitly waived, fall back from OMX authorization failure to Codex native
  review, record `blocked_unavailable` when all providers fail, and require a
  new review after their input hash changes.
- Every `verified` entry has readable evidence; missing or stale evidence
  downgrades diagnostics and never counts as verified progress silently.
- Recomputing progress from an unchanged ledger produces identical totals and
  percentages, with the denominator and weighting policy visible.
- `adaptive`, `frequent`, and `custom` briefing fixtures reconcile the complete
  projection, show requirements/done/remaining/reproducible progress at their
  supported safe boundaries, deduplicate an unchanged snapshot, distinguish
  injected from confirmed delivery, and continue without a permission handoff.
- Parallelism fixtures delegate at least two ready dependency-independent
  lanes under `prefer`/`required`, serialize shared write/effect scopes, obey
  maximum-agent and native/tmux requirements, and pass every child a bounded
  Work contract. Delegation results do not count as verified until the leader
  integrates evidence.
- An unchanged provider-failure fingerprint is not relaunched. OMX/tmux
  unavailability follows the configured next-provider/ask/fail-closed path.
  Provider exhaustion permits solo only for `auto`/`prefer`; required safe
  lanes remain blocked without a waiver.
- The default compact digest stays at or below 300 estimated tokens and at
  least 90% smaller than injecting the full 100-requirement ledger.
- No checkpoint reminder repeats for the same work-unit/evidence/worktree
  fingerprint.
- A safe task switch changes only the current session cursor and preserves a
  shared checkpoint without changing another session's selection or the old
  Work's lifecycle.
- Two sessions appending to one Work preserve both events and cannot overwrite
  a newer ledger head or projection. Deleting every cursor loses no Work truth.
- Recovery truncates only one torn final ledger tail to its last validated
  newline under lock; an invalid interior record or hash-chain mismatch fails
  closed. Context-index entries derived from caches resolve to an exact
  authoritative ledger event and record hash.
- Crash ordering guarantees the source object/envelope is durably published
  before its allocation record commits. A source-event lock prevents new
  allocations during `purge_pending`; interrupted multi-Work purge resumes
  idempotently and deletes the body only after every referrer is tombstoned.
- A normal checkout and two linked Git worktrees resolve the same Work ledger
  while retaining distinct worktree fingerprints. A separate clone is reported
  as a separate local repository instance rather than pretending live sync.
- A months-long synthetic session keeps one evolving deliverable through
  contract revisions, separates independently completable results into linked
  Works, and creates no time-based unit split or WorkStream object.
- Work start/end fixtures prove that durable independent acceptance creates a
  Work, amendments/interruption do not, and session/TTL/commit/PR/test signals
  never close it.
- TTL changes only freshness/injection behavior. It never changes semantic
  lifecycle, review state, or user waiver state and never deletes a unit.
- Benchmark runs report requirement omissions, false completion, duplicate or
  missed briefings, unnecessary delegation, provider fallback, and tmux startup
  overhead separately from token and latency savings.
- For each client/version, official schema evidence or a real-CLI probe records
  whether native compact events exist. Proven events restore the ledger digest
  before continuation; unproven/unsupported adapters retain tested
  manual/SessionStart/resume fallbacks without portable-hook claims.
- MCP remains dependency-free and disabled unless the export benchmark proves
  a material advantage over CLI/files. If accepted later, conformance and
  backward-version negotiation tests are required before release.

---

## v1.24 — Instruction efficiency and explicit audit

Status: implementation and bounded Astra validation complete. Verify registry
availability with `npm run release:verify -- --version 1.24.3`; implementation
status alone is not evidence of publication.

- Add explicit, read-only `context audit-instructions` with bounded local
  inventory, ownership/drift evidence and literal duplicate references. It does
  not scan global settings, call models or automatically rewrite instructions.
- Keep short Codex commands inline and full long procedures in managed Markdown
  sources. Preserve per-procedure fallback, actual trigger boundaries, executable
  adapter authorization and user/other-tool instructions.
- Avoid repeated discovery when sufficient original sources are already known;
  preserve exact-source evidence and query when evidence is insufficient for either
  reads or edits (base v28). Identify native
  built-in startup discovery without suppressing unrelated hooks.
- Guide completion transitions for newly verified Work requirements using
  existing evidence, preserving cancellation, read-only and terminal boundaries.
- Remove redundant tests/assertions only with retained coverage witnesses;
  concurrency, recovery, ownership and release safeguards remain.

The frozen instruction-delivery study passed 66 runs, with reserved median
paired tokens−18.2% and time+1.8%. Separate Work-enabled V8/V7 validation passed
four runs with tokens−17.4% and time−11.2%; this two-pair tuned follow-up is not a
new holdout or general cost guarantee. Do not combine these source/settings
scopes or extrapolate prior Luna/Terra/Sol measurements to Astra.
See [measurement details](benchmark-evidence/instruction-efficiency/astra-loop-2026-09-07/README.md)
and [audit usage](INSTRUCTION-AUDIT.md). Experimental context management and
whole-default-stack/on-off performance remain separate unproven claims.

---

## Parked ideas (outside the accepted roadmap)

These have been discussed, but they are not active roadmap work. Bring them
back only if repeated dogfood evidence shows they directly improve the core
goal: automatic context/ontology continuity across agent tools.

- **Project type templates** — `init --template react-app` style scaffolding for first-time users
- **WebUI for Agentfile editing** — visual editor for non-CLI users

---

## Changing the plan

Versions move based on verified signal. If a planned item turns out to
be hard or low-value, it gets bumped. If a v0.4 item becomes urgent (e.g.,
heavy daily use of agent-handoff), it can move into v0.3.

When the plan changes, update this file in the same commit.

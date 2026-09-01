# Changelog

All notable changes to anamnesis are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
the project follows semver from v1.0 forward. Before v1.0, minor version bumps
could include breaking changes.

## [Unreleased]

### Changed

- Redesigned primary human-readable CLI output around a shared, width-aware visual
  system: verdicts come first, exceptions remain visible, and routine
  provenance moves behind `--verbose`. `status` and `doctor` now provide
  compact defaults while preserving existing `--json`, exit-code, and trust
  behavior.
- Added dependency-free Unicode/ASCII markers, CJK-aware wrapping, long-token
  truncation, and explicit `NO_COLOR`/non-TTY fallbacks for consistent local
  terminals and CI logs.

## [1.22.1] — 2026-08-31

### Fixed

- Increased the explicit timeout for the multi-process Work session-switch CLI
  regression test so loaded GitHub release runners do not fail just above the
  default ten-second boundary while preserving all assertions.

## [1.22.0] — 2026-08-31

### Added

- Added Codex native hook runtime trust diagnostics to `status` and `doctor`,
  plus explicit `anamnesis hooks codex trust --dry-run|--apply` review and
  approval. Approval is limited to exact Anamnesis-owned hooks returned by the
  current Codex app-server and never extends to user, OMX, or plugin hooks.

### Security

- Kept executable-adapter installation consent separate from Codex runtime
  trust. Hook changes require renewed explicit approval, writes use the
  app-server configuration API with pre-write hook/hash revalidation, and
  linked worktrees never receive synthesized trust keys.

## [1.21.0] — 2026-08-28

### Added

- Added a private user-level project registry. Successful CLI initialization
  records the project's canonical path, filesystem identity, selected tools,
  and executable-adapter preference with atomic, locked, symlink-resistant
  storage.
- Added `anamnesis projects list|register|plan|apply|unregister|prune` for
  cross-project discovery and safe bulk updates. Missing, moved, replaced,
  blocked, and user-modified projects are skipped independently.
- Extended `anamnesis upgrade --apply` to reload the newly installed CLI and
  synchronize the safe registered-project subset automatically.

## [1.20.4] — 2026-08-27

### Added

- Added `anamnesis work close` for source-authorized, evidence-backed
  `open → completed` lifecycle transitions. Closure requires an accepted,
  requirements-ready contract, exact ledger/contract CAS inputs, current
  completion-review readiness, and a published authority source already bound
  to the Work. Exact retries are idempotent, while all semantic, progress, and
  review/delegation mutations after terminal history fail closed.

### Security

- Kept `abandoned`, `superseded`, and reopen transitions unavailable until
  their cancel authority, cross-Work replacement, and revocation contracts are
  implemented; unsupported lifecycle values remain rejected by strict drafts
  and ledger validation.

## [1.20.3] — 2026-08-27

### Fixed

- Raised the repository-wide Vitest timeout budget from the 5-second default
  to 30 seconds for integration-heavy suites, while retaining 60-second
  overrides for the known multi-step matrix and retry cases. The `v1.20.2` tag
  stopped at another default-timeout-only CI failure before any registry write,
  so it was not published and is superseded by this patch.

## [1.20.2] — 2026-08-27

### Fixed

- Added explicit CI time budgets to the switching-agent matrix and Work cursor
  retry regression tests without changing their assertions. The `v1.20.1` tag
  passed the normal workflow test job but stopped when `npm publish` reran the
  full suite under heavier contention, so it was not published to either
  registry and is superseded by this patch.
- Removed that redundant publish-time suite rerun from GitHub Actions while
  retaining the explicit lint, typecheck, test, and build gates. CI now verifies
  the built CLI artifact before publishing it with lifecycle scripts disabled;
  local and incident-recovery publishes keep the `prepublishOnly` safety gate.

## [1.20.1] — 2026-08-27

### Fixed

- Stabilized the retrieval benchmark regression tests under shared GitHub CI
  load by giving both unchanged assertion paths an explicit timeout budget.
  The `v1.20.0` tag stopped at this pre-publish test timeout, so that version
  was not published to either package registry and is superseded by this patch.

## [1.20.0] — 2026-08-27

### Added

- Added `benchmark work-parallel-agent-ab`, a fail-closed real-Codex Luna
  diagnostic that runs leader planning, two concurrent child processes,
  authoritative review, and final integration with exact requirement scoring
  and complete per-stage token and critical-path accounting. Its v2 contract
  separates harness validity, paired directional accuracy, and enabled absolute
  quality. The fresh three-pair run passed the directional accuracy comparison
  (33.33% to 100%, 2/3 paired wins and one tie) but not the 3/3 quality gate;
  tokens and critical-path time regressed 3.96% and 27.63%, respectively, and
  are reported as costs rather than folded into the accuracy claim.
- Upgraded that benchmark to a frozen v3 protocol with three materially
  different scenario families, a free 90-stage validation mode, held-out
  nine-pair final runs, exact one-sided paired accuracy gates, per-family
  quality floors, deterministic bootstrap cost/latency limits, and one recorded
  claim-eligible attempt per implementation commit. Work-enabled stages now use
  a bounded authoritative execution packet instead of the user-facing briefing,
  and final integration no longer repeats both child payloads.
- Recorded the single held-out v3 Luna attempt without result selection. All
  harness checks passed and final exact-requirement accuracy improved from
  55.56% to 100% (4 wins, 5 ties, 0 losses), but the preregistered result was
  `FAIL_ACCURACY` because six wins were required and the exact one-sided
  p-value was 0.06. The run also failed its efficiency gates: average tokens
  increased 9.14%, paired token p50 increased 8.70%, and paired critical-path
  p50 increased 10.86%. The published artifact preserves this negative result
  and identifies reviewer/child context cost as the next optimization target.
- Prepared a frozen v4 follow-up without altering or rerunning the v3 result.
  Every pair now has a distinct fixture hash, the stale-history family requires
  reconstruction from chronological deltas instead of providing a ceiling-prone
  final projection, and each enabled child consumes the real bounded Work
  execution-packet subset for its assigned IDs. Reviewer reports use the same
  compact JSON-tuple transport in both conditions, final integration consumes
  reviewer requirements without rereading context, packet facts and metadata
  fail closed on drift, and deterministic input-byte accounting fails closed on
  missing files. New preregistered stage gates require both combined-child and
  reviewer token p50 at or below 0% with bootstrap upper 90% at or below +5%;
  paid shadow and final protocols also require the real runner and a clean,
  committed implementation so results cannot be attributed to an older HEAD.
- Preserved the v4 file-mediated three-pair shadow as negative evidence: harness
  and enabled quality passed, but total tokens rose 13.95%, combined-child token
  p50 rose 47.56%, and critical-path p50 rose 22.77%. The next frozen v5
  transport inlines the same authoritative payload in both child conditions,
  validates the byte-length framing and exact packet facts locally, and keeps
  the v4 artifact separate rather than overwriting or selecting it away. V5
  defaults to its own artifact directory and verifies the complete full packet
  as well as each child subset before accepting the harness.
- Preserved the v5 inline-transport shadow separately. It passed every harness,
  stage-cost, aggregate-cost, and latency gate (total tokens -12.94%; critical
  path -12.01%; child p50 -2.97%; reviewer p50 -32.00%), but enabled absolute
  quality finished 2/3 because a redundant final model copy omitted one of 48
  already-correct reviewer rows. V6 keeps that failure visible and replaces
  only the copy-only final model call with a symmetric deterministic pass-through
  that cannot fill, reorder, or repair reviewer output.
- Preserved the v6 deterministic-integration shadow separately. It used 24 real
  Luna calls and passed harness, aggregate-cost, stage-cost, and latency gates
  (average tokens -6.61%; average critical path -3.47%) while producing exact
  final requirements in all six conditions. It remains diagnostic-only because
  enabled absolute quality was 2/3: one review-recovery reviewer returned all 48
  requirements exactly but failed the structured audit-metadata contract.
- Prepared a frozen v7 diagnostic that removes synthetic audit metadata from
  the reviewer model contract. A deterministic, zero-token review-audit stage
  now checks the raw reviewer requirements, raw child reports, and actual
  leader assignments; fixture truth is unavailable to that stage and is used
  only after all stages finish to score audit exactness. V7 separately requires
  exact audit output for harness validity, preserves reviewer/final defects
  without repair, counts four model invocations plus two deterministic stages,
  and uses non-inferior final accuracy plus an observed token-or-latency signal
  before any product-level pass. Its bounded Luna shadow remains diagnostic and
  is limited to 24 real calls; no nine-pair run is authorized by this change.
- Preserved the one v7 Luna shadow without rerunning it. Work reached exact
  enabled quality at 3/3, improved average tokens by 17.08%, improved paired
  critical-path p50 by 6.10%, and passed every accuracy, quality, cost, stage,
  and latency gate. The overall artifact is still `INVALID`: the disabled
  review-recovery reviewer returned only 1/48 exact requirements, so its
  oracle-scored audit differed from the expected child-fault audit and failed
  the all-condition audit-exact harness gate. This is retained as evidence that
  v7 fixed the enabled reviewer path but conflated baseline reviewer failure
  with harness validity; no release claim or nine-pair run follows from it.
- Froze the v8 shadow evaluator before its single paid attempt. V8 separates
  deterministic review-audit stage integrity from post-execution oracle
  exactness, so a baseline model-quality failure remains a measured outcome
  instead of invalidating an otherwise sound harness. Enabled audit, reviewer,
  and final output must still be exact in every pair and family; missing expected
  rows now count as final defects. Machine-readable harness, enabled-quality,
  diagnostic-contract, and claim-eligibility fields prevent a diagnostic
  shadow from being mistaken for a release claim. Paid shadow attempts require
  retained output, use one output-path-independent canonical ledger, and are
  refused for a repeated implementation SHA.
- Preserved the single v8 Luna shadow without rerunning it. The run stopped at
  21/24 planned calls and is `INVALID`: every reached reviewer stage and one
  enabled leader-plan stage failed the runner-JSONL protocol check despite
  zero process exit status. Harness validity and enabled quality therefore
  failed, so the apparent token and latency reductions are not performance
  evidence and no nine-pair run or release claim follows.
- Prepared frozen v9 after the v8 invalid result exposed an incomplete Codex
  exec JSONL event allowlist as the strongest available failure explanation.
  Raw v8 JSONL remains intentionally private and was not retained, so the exact
  rejected event cannot be reconstructed. V9 accepts and validates documented
  `item.updated` progress for the benchmark's agent-message, reasoning, and
  command-execution items while failing closed for every other item type. It
  records `turn.failed` and top-level `error` events as explicit execution
  failures and retains only privacy-safe event counters for diagnosis. It uses
  a new schema, harness hash, output root, and
  one-shot paid-attempt ledger while preserving all quality and efficiency
  gates.
- Preserved the single v9 Luna shadow without rerunning it. All 24 calls ran
  and every event envelope passed, but each reviewer produced two completed
  agent-message items in one completed turn, so v9's single-message assumption
  made the artifact `INVALID`. The counters exposed that protocol mismatch
  without raw answers. A review-recovery enabled reviewer token outlier also
  failed aggregate and stage-cost gates, so no performance claim follows.
- Prepared frozen v10 from the retained v9 evidence. Successful turns may now
  contain multiple completed agent messages, with the last message treated as
  the authoritative schema-constrained output and all messages still counted.
  Reviewers receive authoritative truth and child reports as two validated,
  byte-length-framed inline payloads under a no-file/no-command contract,
  removing measured file-discovery round trips without weakening any quality,
  cost, latency, one-shot, or no-nine-pair gate. Child/reviewer command events
  and post-terminal events now fail the runner protocol, and byte frames are
  parsed by the declared UTF-8 length rather than delimiter search.
- Preserved the single committed v10 Luna shadow without rerunning it. All
  24/24 calls, harness checks, and enabled audit/reviewer/final quality checks
  passed with zero enabled final defects and no paired accuracy losses. Paired
  total-token p50 improved 1.19% (bootstrap upper-90 -0.98%), combined-child
  tokens improved 2.78%, reviewer tokens improved 0.27%, and critical-path p50
  was +0.64%; every preregistered diagnostic gate passed. The shadow remains
  `INCONCLUSIVE` and not claim-eligible by design, so this is retained as a
  bounded efficiency signal rather than a release or native-subagent claim.

## [1.19.0] — 2026-08-26

### Changed

- New `anamnesis init` projects now materialize an active Work profile by
  default: adaptive reconciliation, advisory review, automatic delegation
  assessment, and bounded repository-side prompt-capture policy. Users can
  explicitly set these policies to `off`; existing projects with omitted Work
  settings retain their legacy all-off behavior. Prompt capture now follows the
  reviewed Agentfile policy directly instead of requiring an extra environment
  variable. Before forwarding raw prompt bytes, native wrappers now confirm the
  candidate policy through the CLI's strict Agentfile parser and fail closed on
  malformed, duplicate, ambiguous, or schema-invalid configuration. Executable
  adapter writes remain gated by `--allow-exec-adapters`, and init output
  reports whether native automation is enabled.

## [1.18.2] — 2026-08-25

### Fixed

- Removed a redundant full nine-pair benchmark execution from the canonical
  artifact symlink regression test and allowed realistic CI time for dogfood
  fixture verification, preventing resource-contention timeouts without
  weakening either assertion.

## [1.18.1] — 2026-08-25

### Changed

- Tightened the real-Codex Work A/B evaluator with nine-pair strict gates,
  paired median/p95/MAD/bootstrap reporting, scenario filtering, exact summary
  scoring, and hallucinated/duplicate requirement rejection. Full Work
  briefings now preserve requirement summaries losslessly or require
  authoritative retrieval, and required review/delegation contexts avoid the
  shared-prefix compression that caused correction turns in diagnostic runs.
  The fresh nine-pair `gpt-5.6-luna` validation passed across all six scenarios:
  108 initial calls plus 45 bounded oracle corrections (153 total), with
  average total tokens down 50.30%, elapsed time down 44.19%, 100% enabled
  completion and gate correctness, and 100% requirement, status, and summary
  recall. Failed strict runs now recognize canonical output through symlinks,
  and successful artifact publication stages complete JSON and Markdown files
  before atomically replacing either destination.

## [1.18.0] — 2026-08-20

### Added

- Added a repeated real-Codex `benchmark work-agent-ab` evaluator for six
  paired Work-disabled/Work-enabled continuity scenarios. It alternates
  condition order, applies deterministic oracle corrections, accounts for all
  correction tokens and elapsed time, and stores aggregate-only public-safe
  evidence. The first 3-run-per-scenario `gpt-5.6-luna` result passed: Work
  reduced average total tokens by 24.14% and elapsed time by 30.89%, raised
  status accuracy from 73.33% to 100%, and reduced correction rounds from 0.78
  to 0.11 per run while preserving 100% final completion and gate correctness.
- Optimized Work briefing by folding the ledger once, skipping cursor/state
  resolution when no cursor is requested, and avoiding duplicate authoritative
  status retrieval when a complete full briefing already fits. The equal-facts
  deterministic 20-requirement resume p95 fell from 33.06ms to 18.65ms while
  preserving 100% requirement/status accuracy.
- Added a deterministic same-scenario Work continuity before/after benchmark
  that reports requirement/status recovery, progress error, resume latency,
  payload size, and durable storage overhead without conflating them with
  model-dependent task performance.
- Added the v1.18 roadmap and detailed design for a thin completion-contract
  Work overlay: immutable verbatim user-prompt events, append-only requirement
  ledgers with separate clean projections, conflict-safe shared checkpoints and
  disposable per-session cursors, explicit Work start/end boundaries,
  evidence-backed progress, automatic “requirements/done/remaining/progress,
  then continue” briefings, Work-level native-agent/tmux parallelism policy,
  and user-configurable independent-review rules with OMX-to-Codex-native
  fallback. The design explicitly excludes execution-harness machinery such as
  Job/Run state, schedulers, daemons, heartbeats, and leases.
- Implemented the first v1.18 storage/core slice: one canonical local Work
  state root, immutable exact-byte source objects, coupled source-to-ledger
  transactions, a hash-linked expected-head-CAS ledger with torn-tail recovery,
  deterministic projections and progress, and disposable independent session
  cursors. Managed paths reject symlinks, use private file modes, and use
  bounded durable locks. Fresh verification passed all 48 targeted tests and
  all 789 tests across 81 files, plus typecheck, lint, and diff checks; an
  independent review returned `APPROVE`.
- Implemented the v1.18 Agentfile v2 and pure Work-policy resolution slice.
  Agentfile v2 strictly accepts optional `settings.work_policy`; new projects
  emit v2 without materializing policy, so briefing, review, and delegation
  remain off by default. Existing v1 files use an explicit, version-only,
  backup-preserving, idempotent v1-to-v2 migration. The side-effect-free
  resolver applies fixed current-instruction, per-Work, matched-harness,
  project, user, and product precedence; keeps required review gates monotonic
  unless a current gate- and revision-scoped evidenced waiver lowers one; and
  produces deterministic provenance-aware `policy_hash` values plus immutable
  revision snapshots and drift comparisons. It also normalizes declarative
  OMX-to-Codex-native review fallback and fail-closed required-parallelism
  exhaustion without launching either runtime. Fresh verification passed all
  48 targeted tests and all 808 tests across 82 files, plus typecheck, lint,
  build, and diff checks; independent QA returned `SIGNOFF` and independent
  code review returned `APPROVE`.
- Implemented the v1.18 typed Work-contract and reconciliation foundation.
  Canonical contract revisions preserve requirement lineage and verbatim
  source provenance, reject silent requirement deletion or semantic ID reuse,
  and keep lifecycle closure fail-closed until closure orchestration exists.
  Projections derive reproducible weighted or unweighted progress and expose
  requirement readiness separately from review/closure authority. Deterministic
  briefing snapshots now report requirements, completed and remaining work,
  progress, conflicts, policy/contract identity, and deltas; per-session
  cursors deduplicate only exactly confirmed delivery tuples. Multi-source
  publication locks every referenced source in stable order through the Work
  commit and binds exact canonical source-envelope bytes, so retries cannot
  hide provenance tampering. A dedicated, fail-closed migration event can bind
  pre-existing envelopes without granting ordinary callers binding authority.
  Fresh verification passed all 120 targeted tests and all 868 tests across 84
  files, plus typecheck, lint, build, import, and diff checks; independent
  adversarial verification and final code review returned `APPROVE`.
- Added the first thin, command-boundary Work workflow with
  `work create|amend|transition|status|brief|confirm|switch`. Contract drafts
  classify new versus same-Work intent, exact raw source bytes are published
  before typed contract mutations, and evidence-only progress does not invent
  user-authored source prompts. Human and JSON briefings refold the validated
  ledger and report the original requirements, done/remaining work, blockers,
  progress mode and denominator, next items, and configured review gates.
  Delivery is prepared in a per-session CAS cursor before rendering; only a
  complete direct-TTY human write confirms automatically, while JSON,
  redirected output, and failed writes remain explicitly pending. Concurrent
  cursor writers cannot silently overwrite each other, different sessions can
  select different Works, same-requirement progress conflicts fail closed, and
  live Agentfile changes are reported as drift without rewriting a Work's
  frozen policy. Fresh verification passed 146 targeted Work tests and all 894
  tests across 88 files, plus typecheck, lint, build, and diff checks;
  independent code review returned `APPROVE` and adversarial verification
  returned `PASS`.
- Added the first automatic Work reconciliation boundary. The base fragment
  now installs dedicated Claude Code and Codex `UserPromptSubmit` adapters
  behind `--allow-exec-adapters`; they forward the native JSON payload only on
  stdin, keep prompt text out of logs, files, hashes, diagnostics, and returned
  context, and fail open when the CLI or stable turn identity is unavailable.
  The hook refolds only the session-selected Work, evaluates its frozen
  reconciliation policy, records hidden delivery as `injected_unconfirmed`,
  deduplicates retries by stable client boundary and briefing fingerprint, and
  asks the foreground agent to visibly report requirements, done/remaining
  work, blockers, progress, and then continue. Hidden context injection never
  advances the user-visible confirmed baseline. Raw prompt staging and Work
  allocation remain a separate follow-up so interruptions and unrelated
  prompts are not durably retained by default. Compact output preserves the
  completion contract, delta, configured gates, changed/at-risk requirements,
  next action, blockers, and an authoritative status command under structural
  budgets; oversized full output falls back atomically instead of silently
  truncating. Codex keeps the default-off path visually silent. Fresh
  verification passed 79 focused review tests and all 914 tests across 89
  files, plus typecheck, lint, build, adapter parity, status, and diff checks;
  independent code review returned `APPROVE` and adversarial verification
  returned `PASS`.
- Added same-turn Work reconciliation at safe tool boundaries without a daemon
  or background scheduler. Codex uses a dedicated canonical-tool
  `PostToolUse` wrapper; Claude Code uses one `PostToolBatch` hook per parallel
  batch. Both discard prompts, transcripts, tool input, and tool output before
  invoking the CLI and forward only documented stable IDs and canonical tool
  names. A per-session durable cursor lock stores a bounded hashed boundary
  FIFO together with the meaningful-action counter and optional
  `injected_unconfirmed` observation in one atomic mutation, so retries count
  once while distinct concurrent actions accumulate. Same-turn output uses a
  structural 8,000-character budget,
  terminal Work never auto-continues, and hooks do not launch agents, tmux,
  daemons, schedulers, or provider runtimes.
- Added opt-in bounded raw UserPrompt staging and explicit Work allocation.
  Agentfile v2 now accepts strict `settings.work_prompt_capture` limits while
  absence remains `off`; raw capture additionally requires user-local
  `ANAMNESIS_WORK_PROMPT_CAPTURE=1`, so repository policy alone cannot retain
  collaborators' prompts. Supported hooks preserve the exact decoded prompt
  text as private `client_exact` UTF-8 bytes, return only an opaque stage ID,
  and require an explicit same-Work, new-Work, provisional-retain, or discard
  decision; they never infer allocation from the current cursor. Stage/source/
  Work lock ordering, durable discard and provisional receipts, immutable
  later binding, bounded GC, symlink/private-mode checks, deterministic retry
  IDs, and expected-head/revision/hash checks protect crash and concurrency
  boundaries without introducing a daemon, queue, scheduler, or Job/Run model.
  Raw stage/source paths are ignored by Git and excluded from context indexing.
  `anamnesis work prompt gc` enforces TTL without a daemon and recovers expired
  terminal-cleanup, partial-publication, corrupt-stage, and stale-temp residue.
  Public JSON resolution output excludes prompt-derived and assertion hashes.
- Implemented the runtime-neutral Work review/delegation evidence and readiness
  slice. Four source-free typed event families record review requests, review
  attempts, parallelism assessments, and delegation outcomes; a fifth,
  source-bound event records an explicit user delegation waiver. Projection
  stores only bounded durable ledger facts, while `work readiness` combines
  those facts with policy-conditional current inputs through a pure evaluator.
  A bounded adapter hashes safe repo-local artifacts and allowlisted read-only
  Git facts without invoking a shell or provider. Nested
  `work review request|record`, `work delegation assess|record|waive`, and
  `work readiness` commands expose the contract. Every existing-Work mutation
  requires an explicit `expected_head`; only an exact event retry is
  idempotent, and stale new events are never auto-rebased. Required review and
  parallelism remain fail-closed; configured OMX authorization or unsupported
  authority fallback may select Codex native evidence, but anamnesis does not
  launch or supervise providers, native agents, or tmux panes. Reviewer
  identity is explicitly `runtime_attested`, not host-authenticated. Fresh
  verification passed the targeted and full test suites, typecheck, lint,
  build, dogfood, and diff checks.
- Reviewed the stable MCP `2026-07-28` revision against the current codebase.
  No migration is required because anamnesis has no MCP implementation; the
  roadmap now records a stateless, deterministic, cacheable resource profile
  and an evidence gate for any future optional export.

### Fixed

- Fixed release-branch cleanup to delete the remote branch before the local
  branch, avoiding Git's upstream-merge refusal after the release branch has
  already been fast-forwarded into `main`.

## [1.17.0] — 2026-07-10

### Added

- Added `anamnesis context docs`, a read-only Markdown document graph summary
  that reports scanned pages, headings, internal/external/broken links,
  backlinks, canonical docs, and ontology source references with JSON output
  for tests and CI.
- Extended `context diagnose`, `status`, and `doctor` to surface document graph
  problems, including broken Markdown links, missing heading anchors, and stale
  ontology source references.
- Extended `anamnesis context index/query` with `doc-page`, `doc-heading`, and
  `doc-ontology-ref` records so agents can retrieve exact document and
  ontology source pointers without increasing SessionStart context.
- Added default-index freshness handling to `anamnesis context query`: missing
  or stale `.anamnesis/context/index.jsonl` files are rebuilt in memory without
  writing, and query summaries report freshness counts plus ranking status.
- Added the base v20 cross-agent retrieval reminder contract across
  AGENTS/CLAUDE/Codex/Cursor skill and hook surfaces so agents use
  `anamnesis context query` to find source pointers and then read the returned
  `source_path` / `stable_ref` before making context-sensitive claims.
- Added `anamnesis benchmark retrieval`, a deterministic public-safe
  unfiltered source-pointer benchmark across mixed document, ontology, handoff,
  task-harness, agent-rule, and diagnostic records, with per-stratum metrics,
  lifecycle safety checks, provenance hashes, JSON/Markdown/SVG artifacts, and
  prompt-gate evidence integration.
- Added model-run retrieval-loop metrics to `benchmark task` for whether an
  agent invoked `context query`, queried before claiming, and followed the
  returned source pointer.
- Added a shared ontology lifecycle recommendation to `status`, `doctor`, and
  `apply` so existing commands point to the next managed `apply`,
  deterministic `ontology bootstrap`, or reviewed `/ontology-enrich` step
  without adding another refresh command.

### Changed

- Documented the v1.17 ontology source-management direction: keep ontology as
  the durable memory layer while adding document graph diagnostics and source
  pointers as review-only support for ontology enrichment.
- Moved benchmark visualization discovery into `docs/benchmark-evidence/` so
  README keeps concise evidence summaries and links instead of embedded chart
  galleries.
- Hardened `context query` ranking with phrase matches, kind/source priorities,
  lifecycle filtering, diagnostic intent, explicit document-page intent, and
  content-hash freshness checks. Ordinary queries exclude stale handoff history,
  while explicit historical queries can recover closed/cold archives.
- Hardened document catalogs and diagnostics with project-contained paths,
  typed warnings, configurable ontology-reference prefixes, GitHub-compatible
  duplicate heading anchors, and explicit-reference-only missing ontology
  warnings.
- Updated `load-context`, `ontology-enrich`, `doc-freshness-review`, and
  `context subagent-preamble` guidance to treat query snippets as pointers,
  not authority, preserving the ontology as the durable memory layer.
- Narrowed compact `anamnesis --help` to the ordinary short path plus guided
  upgrade planning; advanced namespaces remain available through diagnostics,
  namespace help, and `--help --all`.
- Hardened the release runner so `release:prepare` regenerates retrieval
  benchmark evidence after the package version bump and `release:publish`
  rejects evidence whose recorded package version does not match the release.

## [1.16.0] — 2026-07-09

### Added

- Added `anamnesis apply` as the preferred project-managed change command.
  It writes by default and supports `--dry-run` for previews.
- Added a dependency-free terminal UI helper with plain/color parity,
  semantic headers, key/value rows, command rows, and wrapping tests.
- Added grouped core help for `anamnesis --help`; the full command and flag
  catalog remains available through `anamnesis --help --all`.
- Added bare namespace help for `anamnesis context`, `anamnesis handoff`, and
  `anamnesis benchmark`.
- Added workspace profile summaries to dry-run project flows so `init` and
  `apply --dry-run` can surface supported stacks, unsupported tool signals,
  artifact-heavy workspaces, agent surfaces, and verification commands without
  adding a new top-level command.

### Changed

- Migrated the common `init`, `apply`, `update`, `status`, `doctor`, and
  `upgrade` human reporters toward the shared terminal layout while leaving
  JSON output unchanged.

### Deprecated

- Deprecated `anamnesis update` as a compatibility command. It still works,
  but now prints guidance to use `anamnesis apply --dry-run` for previews and
  `anamnesis apply` for reviewed project writes.

## [1.15.0] — 2026-07-09

### Added

- Added `anamnesis context subagent-preamble`, a compact launcher-wrapper
  payload for externally started subagents and worker processes. It includes
  agent control pointers, startup source pointers, a resume bundle, and the
  required `anamnesis_context_sources` response contract.
- Added `anamnesis benchmark subagent-injection`, which records repeated-run
  evidence for separate-process startup injection and same-session prompt
  contract acceptance, then writes JSON, Markdown, runtime evidence, and SVG
  graphs.
- Added `doctor` surfacing for subagent injection evidence: missing evidence is
  reported as info for Codex or multi-tool projects, and stale or failed
  evidence is reported as a warning.

## [1.14.0] — 2026-07-09

### Added

- Added native Codex project skill rendering. Codex `skill` capabilities now
  install `.codex/skills/<name>/...` files while keeping the existing
  `AGENTS.md` `codex-skill-*` fallback regions for compatibility.
- Added `.codex/skills/**` to the executable-adapter safety gate and continuity
  checks so `init`, `update`, `status`, and `doctor` treat Codex skills like
  other agent-behavior surfaces.

## [1.13.0] — 2026-07-08

### Added

- Added deterministic prose document path-reference drift diagnostics to
  `anamnesis context diagnose`. It now warns when `README.md`, `CLAUDE.md`, or
  `docs/**/*.md` reference missing project-local paths, while
  avoiding URLs, placeholders, sibling-repo paths, and common generated
  directories.
- Added the `doc-freshness-review` base skill so Claude Code, Codex, and Cursor
  agents have a read-only semantic review path for stale README/CLAUDE/docs
  claims that deterministic diagnostics cannot prove.

### Changed

- Changed bare `anamnesis` output from the full command reference to a concise
  first-run guide with preview, install, verify, update, upgrade, and
  agent-follow-up commands. `anamnesis --help` still prints the full reference.
- Changed `anamnesis init` reports to end with explicit next steps for applying
  dry-runs, verifying installs, selecting all agent surfaces, and running
  agent-required semantic/handoff follow-ups.

## [1.12.0] — 2026-07-07

### Added

- Added compact SessionStart budget diagnostics to `anamnesis status` and
  `anamnesis doctor`. The report estimates startup chars, lines, tokens, source
  pointers, source bytes, invariant digest lines, active task lines, required
  retrieval rules, and over-budget warnings for the current project.

## [1.11.0] — 2026-07-07

### Added

- Added `anamnesis upgrade apply-choice <id>`, a safe executor for structured
  `upgrade plan` choices. Read-only choices run directly, while local-write and
  package-install choices preview by default and require `--apply` before
  writing.
- Added an explicit `apply-content-only-update` upgrade-plan choice so
  non-executable managed content updates can be selected separately from
  executable adapter updates.
- Added `anamnesis upgrade choose`, an interactive terminal chooser over the
  same deterministic `upgrade plan` choices. Non-interactive scripts can pass
  `--choice <id|number>` and still use the safe `apply-choice` executor.
- Extended `anamnesis benchmark upgrade` with a choice-execution fixture and
  numeric choice metrics. The current public-safe run is 18/18 pass, including
  preview-required guardrails and zero unsupported choices.

## [1.10.0] — 2026-07-07

### Changed

- Planned v1.10 as the next minor release line for guided upgrade decisions,
  release-gate alignment, stale agent-facing status cleanup, dev dependency
  audit refresh, and clearer prompt-gate UX.
- Added `npm run lint` to the scripted release readiness path, publish
  preflight, and tag publish workflow so the Biome gate is enforced by
  automation rather than contributor memory.
- Refreshed the development-only `vitest` / `vite` / `tsx` / `esbuild`
  toolchain so the release-readiness audit path is clean again.
- Replaced stale repo-local status copy in `AGENTS.md` with pointers to the
  package, changelog, roadmap, and release verification commands.
- Clarified `benchmark prompt-gate` human-facing output so non-blocking
  prototype risks read as risk/watch signals instead of release failures.
- Added structured `upgrade plan` choices for package upgrades, schema
  migration, executable-adapter previews/applies, user-modified managed
  surfaces, pinned fragments, rulebook suggestions, and doctor follow-up.
- Added an Agentfile migration gate so `update` stops before rendering or
  writing managed surfaces when a schema migration is required; `upgrade plan`
  now stops at that schema gate and shows the migration choice first.
- Added an optional-settings materialization policy to `upgrade plan`: existing
  Agentfiles keep defaults implicit by default, and the plan reports which
  settings are implicit vs explicitly materialized.
- Expanded the upgrade compatibility matrix with historical v1.4/v1.5/v1.7
  Agentfile shapes, pinned fragment archives, partial adapter choices, stale
  Codex hook registration refresh, hook config preservation, and
  suggested-but-declined fragment suppression.
- Added `anamnesis benchmark upgrade`, a deterministic sanitized upgrade
  benchmark that writes JSON/Markdown/SVG evidence for repeated existing-project
  upgrade fixtures; the current public-safe run is 15/15 pass with zero pending
  writes, doctor errors, or manifest drift.
- Reconciled v1.10 scope by treating structured `upgrade plan` choices as the
  completed minor-release surface and moving interactive/TUI or choice-execution
  UX to v1.11 candidates.

## [1.9.6] — 2026-07-07

### Documentation

- Surfaced the `npm run lint` step alongside typecheck/test in `AGENTS.md`
  and `CONTRIBUTING.md`, and dropped stale hardcoded test counts, following
  up on the v1.9.5 Biome lint gate.

## [1.9.5] — 2026-07-07

### Added

- Added `core/handoff_active_text.test.ts` and
  `core/executable_security.test.ts`, covering handoff text parsing and the
  executable-adapter security signal detection that previously had no
  direct test coverage.

### Changed

- Replaced the no-op `lint` script with a real Biome-based lint gate
  (narrow, correctness-focused rule set) and fixed the initial violations.
- Deduplicated four copies of handoff `active.md` text-parsing helpers
  (`isCompletedHandoffTaskLine`, `activeHandoffOpenTaskLines`,
  `extractArchiveRefs`, `newestHandoffArchive`) into
  `core/handoff_active_text.ts`.
- Reconciled `docs/ROADMAP.md` state: fixed the stale v1.9.3 heading and
  backfilled the missing v1.9.4 section; added short cross-references
  between the four benchmark docs.

## [1.9.4] — 2026-07-05

### Fixed

- Added a `postbuild` executable-bit guard so local builds keep
  `cli/dist/index.js` runnable.
- Stabilized dogfood release verification by giving the slower cross-agent
  dogfood tests an explicit timeout budget.

## [1.9.3] — 2026-07-03

### Changed

- Added automatic GitHub Release creation to the tag publish workflow after
  npmjs.org and GitHub Packages registry parity is verified.
- Added a tag/package version guard so `vX.Y.Z` tag runs fail before publish
  when `package.json` does not contain `X.Y.Z`.
- Added repo release runner scripts for `release:prepare`, `release:publish`,
  `release:verify`, and `release:status` so version files, release notes,
  evidence refresh, release commit, tag push, and post-publish checks follow
  one repeatable path.
- Allowed the release runner to include the runtime evidence record produced
  by `release:prepare` in the release commit.

### Documentation

- Updated release procedure docs so a matching GitHub Release is part of the
  release completion criteria and post-publish smoke gate.
- Replaced the manual release checklist with the script-driven release flow.
- Added agent-facing release rules to `AGENTS.md` and `docs/RELEASING.md` so
  future sessions use the scripted release runner instead of relying on memory.

## [1.9.2] — 2026-07-03

### Changed

- Clarified `upgrade plan` doctor-issue guidance so warning-only states no
  longer read as if errors must be fixed.

## [1.9.1] — 2026-07-03

### Changed

- Clarified `anamnesis upgrade plan` output so the update dry-run summary is
  labeled as safe mode and executable-adapter gates explain when to use
  `--allow-exec-adapters`.
- Tightened upgrade-plan next-step copy for partial adoption, user-modified
  managed surfaces, pinned fragments, suggested fragments, and doctor issues.

### Documentation

- Added a v1.9 post-release roadmap audit that separates the published
  v1.9.0 scope from v1.9.1 patch candidates and v1.10 feature work.
- Marked the v1.9.1 patch scope as upgrade copy polish and kept new guided
  upgrade behavior in the v1.10 plan.

## [1.9.0] — 2026-07-03

### Changed

- Added an upgrade compatibility matrix test fixture covering clean old
  projects, old Agentfiles without optional settings, user-modified managed
  regions, and executable-adapter permission gates.
- Improved `anamnesis upgrade` text output so it explicitly separates CLI
  package upgrade from project-managed file updates and shows the next
  `update` / `doctor` commands for managed projects.
- Hardened `anamnesis upgrade` registry calls so scoped package lookups
  explicitly use the requested registry, disable fetch retries, and time out
  instead of waiting indefinitely on a slow registry/auth path.
- Kept `anamnesis update --apply` from marking a fragment version current in
  Agentfile when that fragment still has `user-modified` or `blocked` managed
  surfaces.
- Added `status` / `doctor` partial-upgrade reporting so users can see which
  fragment version bumps are held back by preserved managed surfaces.
- Added `anamnesis upgrade plan`, a read-only package/project upgrade plan that
  summarizes CLI version drift, Agentfile schema support, update dry-run gates,
  partial adoption, doctor health, and exact next commands.
- Added `anamnesis release check`, a read-only release gate that combines
  `status`, `update --dry-run --allow-exec-adapters`, `doctor`, manifest drift,
  hook registration health, runtime evidence freshness, update evidence, and a
  sanitized old-project upgrade smoke.
- Added the release gate to `npm run release:check` before dogfood, doctor,
  benchmark gallery, prompt-gate, and build verification.

### Documentation

- Added the v1.9 upgrade compatibility and project-update planning roadmap,
  including the current v1.8 upgrade audit findings, conflict choice gaps, and
  compatibility fixture targets.
- Clarified the v1.9 upgrade UX target: package upgrade should hand off to
  project `update` / `doctor` guidance, with room for interactive/TUI conflict
  choices while keeping safe non-interactive defaults.
- Refreshed repair guidance for active handoff diagnostics now that v1.8
  semantic freshness and lifecycle checks have shipped.
- Documented how to repair partial upgrades after user-modified or blocked
  managed surfaces hold back an Agentfile fragment version bump.
- Documented `anamnesis upgrade plan` in the README upgrade flow.
- Documented `anamnesis release check` in the README lifecycle flow.

## [1.8.0] — 2026-07-02

### Added

- Added configurable handoff retention policy settings to Agentfile:
  `max_warm_handoff_archives`, `max_cold_handoff_age_days`, and
  `max_handoff_bytes`.
- Added a shared handoff retention policy resolver used by `gc`, context
  diagnostics, and `context resume`, with `gc` CLI flags remaining one-run
  overrides.

### Changed

- Bumped the base fragment to v17 so SessionStart hooks can honor
  `max_warm_handoff_archives` when `active.md` is absent: `0` disables latest
  archive fallback, and positive values include only the newest N warm archive
  pointers.

### Documentation

- Clarified release branch lifecycle policy: develop version work on
  `release/vX.Y`, merge verified releases back to `main`, then delete the
  merged release branch locally and remotely after publish smoke passes.

## [1.7.1] — 2026-07-02

### Fixed

- Fixed a context diagnostics false positive where generated
  `.bootstrap.yaml` provenance metadata such as `generator.name: anamnesis`
  could be treated as a semantic ontology entity and reported as a duplicate
  ID during `anamnesis doctor` / `status`.

## [1.7.0] — 2026-07-02

### Added

- Added the initial `task_harness` capability with a base
  `context-continuity` fixture rendered to `.anamnesis/task-harnesses/` across
  Claude Code, Codex, and Cursor adapters.
- Added `task-harness` entries to `anamnesis context index/query` so harness
  contracts are retrievable without injecting every harness body at session
  startup.
- Added `anamnesis gc --dry-run` task-harness lifecycle reporting for stale
  current harnesses, deprecated/superseded reusable harnesses, count-budget
  pressure, disk-budget pressure, and managed vs user-authored cleanup
  recommendations.
- Added v1.7 behavior metrics to `anamnesis benchmark task`, `task-compare`,
  `task-series`, and `prompt-gate` for source citations, managed-region edit
  attempts, bootstrap edit attempts, handoff refresh success, matched harness
  reads, and non-matched harness reads.
- Added `side_effects` metadata for executable hooks, skills, and slash
  commands so renderers and future diagnostics can distinguish read-only,
  local-write, repo-external-write, git-hook, network, credential-touching, and
  external-production behavior.
- Added executable adapter security diagnostics to `anamnesis status` and
  `doctor`, warning when managed hooks under-declare writes, repo-external
  writes, network access, likely credential touches, external-production
  commands, or shell safety settings.
- Added stale Codex native hook registration warnings when an
  anamnesis-managed hook command points at a missing wrapper file, plus fixture
  coverage for credential-touching and external-production executable hooks.
- Added advisory agent-config damage diagnostics to `anamnesis status` and
  `doctor`, warning about full handoff archives copied into startup context,
  adapter-parity overclaims in docs, hand-authored `.bootstrap.yaml` files, and
  duplicated managed region markers.
- Added preview-only handoff lifecycle reporting to `anamnesis gc --dry-run`,
  classifying active handoff state into hot, warm, cold, and deprecated tiers
  while preserving active archive references.
- Added `anamnesis handoff draft`, a preview-safe handoff drafting command
  that gathers git state, recent commits, touched files, latest evidence, and
  existing handoff pointers without finalizing `active.md`.
- Added preview-first `anamnesis handoff close` and `handoff deprecate`
  commands to mark finalized archives closed, deprecated, or superseded and
  remove matching active entries without deleting archive files.
- Added semantic freshness diagnostics for active handoff state to
  `anamnesis context diagnose`, `status`, and `doctor`, covering completed
  entries left open, inactive active-referenced archives, missing file
  pointers, clean-worktree stale git refs, and handoff byte-budget pressure.
- Added safe `anamnesis gc --apply` cleanup for clean manifest-owned task
  harness candidates. Apply mode backs up deleted harnesses under
  `.anamnesis/backups/`, updates the manifest, records `gc-apply` runtime
  evidence, and keeps user-authored, user-modified, and handoff candidates
  review-only.
- Added `anamnesis upgrade`, a CLI self-update helper that checks npmjs.org
  for the latest published `@mcprotein/anamnesis` version and runs
  `npm install -g` only with `--apply` when the registry version is newer.

### Changed

- Changed handoff lifecycle active-reference detection to use only `Current
  focus` and `Active tasks`; `Recently completed` archive pointers no longer
  keep closed archives hot or protected from lifecycle review.
- Bumped the base fragment to v15 so existing projects can receive
  lifecycle-aware SessionStart handoff guardrails through `anamnesis update`.
- Changed the release workflow to publish the same `package.json` version to
  both npmjs.org and GitHub Packages, then verify registry parity.
- Replaced the README's static published-version badge with a live npm registry
  badge so main-branch docs do not overclaim a version that was not published.

### Documentation

- Recorded the first public-safe v1.7 full-vs-compact behavior benchmark pair,
  including source-citation, protected-edit, matched-harness, token, and graph
  evidence.
- Added the v1.8 handoff lifecycle design, documenting hot/warm/cold and
  deprecated handoff tiers with bounded markdown retention.
- Documented the release branch policy: keep the current WIP line as-is, then
  use version-scoped `release/vX.Y` branches for future version work before
  merging verified releases back to `main`.
- Moved historical Agentfile/docs audit records under `docs/deprecated/` and
  updated active documentation links to point at current sources.

## [1.6.0] — 2026-06-25

### Added

- Added optional retrieval metrics to `anamnesis benchmark task`, including
  compact/full session context mode, required source reads, missed invariants,
  hallucinated facts, unnecessary context reads, task success, and token usage.
- Added `anamnesis benchmark task-compare` for paired full-vs-compact
  model-dependent task runs, including delta markdown and
  `agent-task-benchmark-compare` runtime evidence.
- Added `anamnesis benchmark task-compare --template` to generate matched
  full/compact task inputs before observed run metrics are filled in.
- Added `anamnesis benchmark task-series --write` to aggregate repeated
  full/compact compare evidence into average, standard deviation, min/max, and
  SVG chart artifacts.
- Added `anamnesis context index` and `anamnesis context query` as the first
  v1.6 local JSONL context index prototype.
- Added `anamnesis context diagnose` to report stale handoff pointers,
  duplicate ontology IDs, conflicting relationship claims, superseded entries,
  explicit docs-vs-bootstrap fact conflicts, invalid evidence lines, and
  missing evidence artifacts.
- Added context diagnostic surfacing to `anamnesis status` and `doctor`:
  `status` prints a short warning/info summary, while `doctor` includes the
  detailed advisory issues.
- Added `anamnesis context resume` to print or write a compact resume bundle
  with active handoff pointers, latest archive, touched files, latest evidence,
  diagnostics, and bundle size metrics.

### Changed

- Changed `anamnesis benchmark prompt-gate` to consume deterministic
  session-context benchmark JSON plus retrieval-aware task and task-compare
  evidence before recommending any prompt-time context delta.
- Hardened `anamnesis context index` and `context query` with stricter JSONL
  entry validation, repo-relative JSON output, broader source fixtures, malformed
  index-line tolerance, and diagnostic source-pointer coverage.

### Documentation

- Recorded the first public-safe Codex full-vs-compact retrieval diagnostic
  pair for the v1.5 `benchmark task-compare` workflow, keeping it separate
  from deterministic README claims.
- Updated the v1.6 context index design and roadmap notes for the JSONL
  prototype.
- Recorded the npmjs.org post-publish smoke for `@mcprotein/anamnesis@1.5.0`,
  including published compact SessionStart hook output from Claude Code and
  Codex native wrappers.

## [1.5.0] — 2026-06-19

### Added

- Added `anamnesis benchmark session-context`, a deterministic full-vs-compact
  SessionStart benchmark with public-safe fixtures, JSON/Markdown output, and
  dependency-free SVG charts for token deltas, payload composition, fixture
  growth, and cap/success status.

### Changed

- Changed Claude Code and Codex SessionStart continuity hooks to emit compact
  invariant digests, active handoff summaries, source pointers, and retrieval
  instructions by default. Full file-body injection remains available through
  `ANAMNESIS_SESSION_CONTEXT_MODE=full` for compatibility/debugging.

### Documentation

- Updated release docs and roadmap notes to reflect that the `v1.4.4`
  tag-triggered GitHub Actions workflow successfully published through npm
  Trusted Publishing/OIDC; manual npm publish is now an incident fallback,
  not the expected release path.

## [1.4.4] — 2026-05-19

### Added

- Added opt-in project documentation scaffolding for `init`:
  `--scaffold-docs` creates missing `README.md` and
  `docs/PROJECT-CONTEXT.md` starter docs, while `--enhance-docs` adds or
  refreshes managed context-review regions in existing docs without replacing
  user-authored content.
- Added the `anamnesis-init` agent skill so agents ask a multiple-choice
  README/docs question before choosing `init` documentation flags on the
  user's behalf.

### Changed

- Changed first-run project context bootstrap so `init` now writes a
  conservative `system_graph.yaml` draft even when no safe local project
  signals exist. Zero-context drafts contain only the project name, safety
  invariants, and open questions instead of inventing ontology facts or
  skipping the context file.

### Fixed

- Deduped Stop-hook handoff reminders by dirty git fingerprint, so repeated
  Stop invocations warn once for unchanged worktree state and warn again only
  after the git changes differ.

## [1.4.3] — 2026-05-19

### Fixed

- Fixed the Codex native SessionStart wrapper so a project-root
  `system_graph.yaml` symlink is followed and injected as user-managed
  ontology context.
- Changed Claude Code and Codex SessionStart ontology injection to emit the
  user-managed `system_graph.yaml` before generated ontology slices, so
  project-specific context survives tighter hook-output displays.

## [1.4.2] — 2026-05-11

### Security

- Removed private validation identifiers from public docs, benchmark evidence,
  and rewritten git history. Public evidence now uses self-checks and
  sanitized fixture names only.

## [1.4.1] — 2026-05-11

### Fixed

- Updated generated Codex hook config from deprecated
  `[features].codex_hooks = true` to current `[features].hooks = true`, and
  made update/diagnostics remove the legacy flag so Codex no longer shows the
  deprecation warning during hook review.

## [1.4.0] — 2026-05-11

### Added

- Added first-run project context bootstrap: `init` now creates a conservative
  `system_graph.yaml` draft from safe local project signals when the file is
  absent.
- Added existing `load-context` surface preservation so project-specific
  Claude skills can be moved aside before the managed anamnesis
  `load-context` skill is installed.

### Changed

- `init` and `update` evidence now record context-bootstrap and preserved
  surface-conflict outcomes.

## [1.3.0] — 2026-05-08

### Added

- Added fragment dependency resolution for `requires` entries with optional
  minimum integer versions, including dependency auto-inclusion during
  `init`/`update` and dependency diagnostics in `status`/`doctor`.
- Added local `fragment-lifecycle` runtime evidence for fragment installs,
  updates, pinned update blocks, and yanked/invalid library references.

### Documentation

- Planned v1.3 around fragment dependency resolution and local fragment
  update event hooks, while parking project templates and WebUI work outside
  the accepted roadmap.
- Recorded a sanitized before/after benchmark comparison after applying the
  current fragments and generating Layer A/B ontology files.

## [1.2.1] — 2026-05-08

### Fixed

- Fixed the published README status badges for the v1.2 line and recorded
  the v1.2.0 post-publish smoke in tracked docs.

## [1.2.0] — 2026-05-08

### Added

- Added benchmark scorecard v2 metrics to `anamnesis benchmark report`,
  including ready layers, continuity checks, ontology gaps, doctor issues,
  Codex hook warnings, adapter surfaces, and runtime evidence freshness in
  markdown, JSON, CLI output, and evidence records.
- Added `anamnesis benchmark compare --baseline <json> --after <json>` for
  before/after scorecard deltas, with markdown, JSON, append, and runtime
  evidence output.
- Added `anamnesis benchmark gallery --write|--validate` to generate and
  verify the evidence-backed `docs/BENCHMARK-GALLERY.md` region and README
  claim candidates from runtime evidence.
- Added sanitized public-shape benchmark evidence for a fresh Next.js
  frontend, a NestJS/Kubernetes backend, an existing Python/uv repo, and
  before/after adoption paths.
- Added `anamnesis benchmark task --template|--input` for explicitly
  model-dependent agent task benchmark runs, stored separately from
  deterministic context-quality scorecards.
- Added `anamnesis benchmark prompt-gate` to keep Codex prompt-time context
  delta injection behind evidence checks for continuity gaps, token overhead,
  duplicate-context risk, and model-dependent task friction.
- Added `anamnesis benchmark trace --append` to roll up benchmark trace logs
  from `.anamnesis/logs/benchmark-traces.jsonl` and store
  `benchmark-trace-rollup` runtime evidence.
- Added `anamnesis doctor --append` and a `doctor:check` release script so
  install integrity diagnostics can be stored as `doctor-check` runtime
  evidence instead of living only in terminal output.
- Added kind-level runtime evidence freshness to `anamnesis status`, including
  per-kind record counts, latest timestamps, age, and stale flags in CLI/JSON
  output.
- Added automatic `update-apply` runtime evidence for `anamnesis update
  --apply`; dry-runs remain read-only and do not write evidence.
- Added automatic `init-install` runtime evidence for `anamnesis init`;
  `init --dry-run` remains read-only and does not write evidence.
- Added `anamnesis hooks summary --append` to summarize hook runtime logs from
  `.anamnesis/logs/hooks.jsonl` and store `hook-log-summary` evidence.

## [1.1.1] — 2026-05-07

### Fixed

- Fixed CLI and ontology bootstrap generator version metadata so
  `anamnesis --version` and generated bootstrap headers read the package
  version from `package.json` instead of a hard-coded release string.

## [1.1.0] — 2026-05-07

### Added

- Added Codex native SessionStart continuity for the base ontology and
  handoff path. When executable adapters are allowed, anamnesis installs
  `.anamnesis/codex-native-hooks/session-start.mjs`, enables
  `.codex/config.toml` `codex_hooks = true`, and merges `.codex/hooks.json`
  without dropping user hook entries.
- Added Codex native lifecycle shell-hook wrappers for supported
  non-SessionStart events. Fragment shell hooks can now be adapted through
  `.anamnesis/codex-native-hooks/*.mjs` and registered in `.codex/hooks.json`
  for Codex-supported events such as `UserPromptSubmit`, `PreToolUse`,
  `PermissionRequest`, `PostToolUse`, and `Stop`, while keeping AGENTS.md and
  git pre-commit fallbacks.
- Added shared Codex hook ownership diagnostics. `status` now summarizes
  `.codex/hooks.json` entries by anamnesis, OMX, plugin, user, and invalid
  ownership, and `doctor` warns about duplicated commands, malformed entries,
  and older relative anamnesis-managed hook commands.
- Added Codex hook warning counts to automated dogfood self-check records so
  version-to-version continuity reports capture hook ownership health.
- Added dogfood native-hook evidence for Codex. The default self-check now
  runs a synthetic Codex JSON dispatch over generated SessionStart,
  PostToolUse, and Stop wrappers, while `ANAMNESIS_REAL_CODEX_SMOKE=1`
  enables opt-in real Codex CLI SessionStart smokes for both isolated
  `CODEX_HOME/hooks.json` and trusted project-local `.codex/hooks.json`, plus
  a real `UserPromptSubmit` additional-context output smoke.
- Added an authenticated Codex tool-turn dogfood smoke gated by
  `ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1`; it verifies a real Bash tool turn
  invokes both `PreToolUse` and `PostToolUse` hooks.
- Added a runtime evidence JSONL store at
  `.anamnesis/evidence/events.jsonl`. `dogfood check --append` and
  `benchmark report --append` now record machine-readable evidence alongside
  the markdown reports, and `status` reports the latest evidence record.

### Changed

- Updated `status` / `doctor` continuity checks and adapter parity docs so
  Codex SessionStart is no longer documented as fallback-only.
- Updated adapter parity docs and tests so the v1.1 Codex executable-hook
  surface explicitly covers `SessionStart`, `UserPromptSubmit`, `PreToolUse`,
  `PermissionRequest`, `PostToolUse`, and `Stop`.
- Updated the base fragment to v10 so Codex installs native dirty-work and
  handoff reminder hooks when executable adapters are allowed.

### Documentation

- Recorded the npmjs.org post-publish smoke for `@mcprotein/anamnesis@1.0.0`
  and marked v1.0 as shipped in the README and roadmap.
- Added post-v1.0 roadmap items from reviewing `openai/codex` and
  `oh-my-codex`: Codex native hook surface refresh, prompt/stop-time
  continuity, shared hook ownership diagnostics, real native-hook smokes,
  Codex plugin packaging research, and OMX-compatible runtime evidence
  boundaries.
- Added `docs/CODEX-PLUGIN-PACKAGING.md`, documenting the v1.1 decision to
  keep required Codex lifecycle hooks in config-layer `.codex/hooks.json` and
  defer optional plugin bundle emission until plugin-local hook execution has
  real Codex CLI smoke evidence.

## [1.0.0] — 2026-05-04

### Added

- Added `docs/AGENTFILE-V1-FREEZE.md`, the v1.0 Agentfile freeze record for
  reserved fields, ownership hints, registry/source exclusions, sync
  exclusions, migration impact, and post-v1 evolution rules.
- Added `docs/REGISTRY-V1-DECISION.md`, the v1.0 decision record that defers
  remote registry/signing implementation post-v1.0 while preserving built-in
  and local-library fragment safety.
- Added `docs/deprecated/DOCS-V1-AUDIT.md`, the v1.0 public documentation coverage map
  for install, lifecycle, parity, ontology, handoff, monorepo, release,
  fragment authoring, troubleshooting, and limitations.
- Added `docs/README-CLAIMS.md`, the v1.0 evidence ledger that maps README
  claims to dogfood records, switching fixtures, tests, and benchmark reports.

### Changed

- Tightened Agentfile parsing so unknown v1 fields are rejected instead of
  silently stripped. Fragment `params` remain open-ended for fragment-specific
  command-layer validation.
- Promoted `anamnesis migrate agentfile` from pre-freeze skeleton to v1.0
  availability surface by documenting its no-built-in-migration behavior and
  reporting the next recommended command in human and JSON output.
- Clarified the v1.0 public TypeScript API stability contract and added an
  exports-map test to keep deep imports outside the supported surface.
- Updated registry, signing, and remote-sync docs so v1.0 does not imply a
  shipped remote fragment registry or broad sync command.
- Recorded v1.0 candidate upgrade smoke proving published v0.7.0, v0.8.0,
  and v0.9.0 managed fixtures can update while preserving user-authored
  `AGENTS.md` prose.

## [0.9.0] — 2026-05-04

### Documentation

- Added `docs/FRAGMENT-REGISTRY.md`, the v0.9 design for registry metadata,
  discovery, version selection, cache layout, and trust boundaries before
  implementing remote fragment installation.
- Added `docs/FRAGMENT-SIGNING.md`, the v0.9 design for remote fragment
  checksums, signed release manifests, trust-store policy, unsigned local
  fragment migration behavior, and rejection diagnostics.
- Added `docs/FRAGMENT-AUTHORING.md`, a public fragment authoring guide with
  capability examples, rulebook guidance, executable-hook safety rules,
  versioning expectations, tests, review checklist, and compatibility rules.
- Added `docs/deprecated/DOCS-SITE-PLAN.md`, the v0.9 decision to stay GitHub-first
  through v1.0 while defining the future docs-site information architecture
  and trigger criteria.
- Added `docs/BENCHMARK-GALLERY.md`, a public-safe benchmark evidence surface
  with claim policy, current headline-safe entries, supporting evidence, and
  next collection targets.
- Added `docs/REMOTE-SYNC-STRATEGY.md`, the v0.9 decision to defer a broad
  `anamnesis sync` command and keep registry refresh, fragment discovery, and
  project update/apply as explicit separate operations.
- Updated the architecture docs to keep fragment trigger ownership aligned
  with the current `rulebook.md` model.

## [0.8.0] — 2026-05-04

### Added

- Added the `anamnesis migrate agentfile` skeleton: dry-run by default,
  optional `--apply`, JSON output, backup-on-write, idempotent migration
  planning, and tests with an injected fixture migration. No built-in schema
  transformations ship yet.
- Added a small public TypeScript API boundary at `@mcprotein/anamnesis` for
  Agentfile parse/stringify/read/write utilities and blocked unsupported deep
  imports with a package `exports` map.

### Documentation

- Recorded the published-package v0.7.0 smoke test in `docs/DOGFOOD.md`,
  covering a fresh sanitized NestJS/Prisma fixture through
  `npm exec @mcprotein/anamnesis@0.7.0`.
- Replanned the post-v0.7 roadmap into v0.8 schema/API/migration
  stabilization, v0.9 registry/signing/docs readiness, and v1.0 surface
  freeze criteria.
- Added `docs/deprecated/AGENTFILE-SCHEMA-AUDIT.md` and compatibility fixture tests for
  historical Claude Code-only, current all-adapter single-scope, and
  multi-scope pinned Agentfile shapes.
- Added `docs/AGENTFILE-MIGRATIONS.md` to define the planned
  `anamnesis migrate agentfile` command contract before implementation.
- Clarified `specs/agentfile.md` validation rules by separating parser-level
  hard errors from library/project-aware diagnostics.
- Clarified v0.8 Agentfile field decisions: `overrides.*.locked` are
  ownership hints rather than hard update locks, `commit_on_apply` is
  future-reserved / a deprecated candidate, and `declined_at` remains a
  parser-level string with ISO 8601 recommended.
- Documented the public API boundary in `docs/API.md`.
- Added `docs/REPAIR.md`, a playbook for user-modified managed files, missing
  hook registrations, partial adapter installs, stale pinned versions, stale
  handoff state, and ontology gaps.
- Added the recurring post-publish npmjs.org smoke gate to
  `docs/RELEASING.md`, including forced npmjs.org registry commands and a
  fresh-fixture `npm exec @mcprotein/anamnesis@X.Y.Z` check.

### Fixed

- `Agentfile` parsing now accepts partial `fragment.adapters` overrides such
  as `cursor: false` without requiring every supported adapter key.
- `update` and `doctor` now honor `fragment.adapters` as a per-fragment render
  gate for both root fragments and scope `fragments_add` entries.

## [0.7.0] — 2026-05-03

### Added

- Added a test-backed adapter parity matrix for v0.7. The canonical fixture
  records native vs fallback surfaces for `project_memory`, `ontology`,
  `executable_hook`, `skill`, and `slash_command` across Claude Code, Codex,
  and Cursor, and `docs/ADAPTER-PARITY.md` is locked to that fixture by tests.
- Added a test-backed 3x3 switching-agent scenario matrix. Claude Code,
  Codex, and Cursor are each tested as source and target agents, including
  same-agent restarts, with current active handoff and stale handoff
  diagnostics verified for every ordered pair.
- Added `anamnesis init --tools <list|all>` so first-time setup can install
  Claude Code, Codex, and Cursor surfaces without requiring a manual
  `Agentfile.tools` edit followed by `update`.
- Added `anamnesis benchmark report`, a deterministic context-quality report
  for static ontology, Layer A bootstrap facts, Layer B enrichment,
  continuity readiness, and adapter surface readiness.
- Added `docs/AGENT-SWITCHING-GUIDE.md`, a public user journey for installing
  all agent surfaces, preparing a handoff, resuming in Claude Code/Codex/Cursor,
  verifying continuity, and understanding native-vs-fallback limits.
- Added the first v0.7 sanitized benchmark comparison in
  `docs/BENCHMARKS.md`, showing ready layers improving from `1/5` to `5/5`
  after all-adapter install, Layer A bootstrap, and Layer B enrichment.

### Changed

- Included `docs/` in the npm package so README links to the roadmap,
  dogfood log, adapter parity matrix, switching scenarios, and release docs
  resolve from packaged installs.
- Dogfood handoff simulations now use the first-install all-adapter init path
  instead of editing `Agentfile.tools` and running `update` as a workaround.
- `update --apply` now enforces `settings.backup_retention` after creating a
  new backup. The default keeps the newest 10 backup directories; `0` keeps
  backups unlimited.
- `status` now marks `declined` entries as active or stale, and `doctor`
  warns when a declined fragment no longer matches the current rulebook.
- `benchmark report --append --output <absolute-path>` now reports the
  absolute appended path when the target is outside the benchmarked project,
  avoiding confusing `../../..` paths during cross-repo benchmark collection.

## [0.6.0] — 2026-05-03

Ontology-generation release: makes project ontology generation repeatable,
bounded, and agent-assisted. The CLI now produces clearer deterministic
Layer A facts, reports ontology gaps and drift, and routes the active agent
toward append-safe Layer B enrichment instead of making users hand-author
semantic YAML.

### Added

- Added generation-boundary CLI guidance to `init`, `status`, `doctor`,
  and `ontology bootstrap` output so users can tell which context and
  ontology files were generated deterministically and which require an
  active agent.
- Added a Claude Code `CLAUDE.md` entrypoint managed region. Projects with
  Claude Code enabled now get a Claude-specific pointer back to canonical
  `AGENTS.md`, managed ontology, and handoff state while preserving user
  prose outside the managed region.
- Added ontology gap reporting to `status` and `doctor`. `status` now
  reports missing static slices, missing `.bootstrap.yaml` facts, missing
  `.enriched.yaml` semantics, fragments without deterministic Layer A
  introspectors, and introspectors that are not applicable in a scope;
  `doctor` turns actionable gaps into repair warnings.
- Added the base v7 Layer B enrichment lifecycle contract. `/ontology-enrich`
  now tells every supported adapter to merge existing `.enriched.yaml`
  content by stable IDs, append new facts, use `supersedes` for replaced
  designs, and put weak inferences under `open_questions`.
- Added bootstrap ontology drift detection. `status` now compares existing
  `.bootstrap.yaml` files against the current deterministic introspector
  output and reports stale facts; `doctor` turns stale bootstrap output into
  an actionable repair warning.
- Added ontology schema version conventions. `.bootstrap.yaml` output now
  includes deterministic `schema_version`, `generator`, and `facts` fields;
  base v8 requires `.enriched.yaml` files to use
  `schema_version: anamnesis.enriched.v1`.
- Added agent-assisted enrichment guidance to ontology diagnostics.
  `status` and `doctor` now connect missing or stale Layer A facts to the
  follow-up `/ontology-enrich` step, and `ontology bootstrap` prints
  semantic follow-up targets for matching `.enriched.yaml` files.
- Added NestJS `@Sse()` route extraction. The NestJS Layer A introspector now
  records Server-Sent Events routes as deterministic route facts instead of
  leaving them only to Layer B enrichment.

### Documentation

- Updated the v0.6 roadmap to start with generation-boundary guidance:
  command output and docs should distinguish deterministic CLI-generated
  context/ontology from agent-required semantic enrichment and handoff
  documents.
- Documented the generation boundary in the README.
- Updated README, design notes, dogfood notes, and the Agentfile spec to
  describe the managed Claude Code entrypoint.
- Documented the ontology gap report in the README and ontology bootstrap
  design notes.
- Documented the Layer B enrichment re-run policy in the ontology bootstrap
  design notes.
- Documented bootstrap drift detection in the ontology bootstrap design notes.
- Documented the bootstrap and enriched ontology schema conventions.
- Re-centered the v0.6 roadmap and ontology bootstrap docs on bounded
  deterministic Layer A baselines plus agent-assisted Layer B enrichment,
  rather than broad framework introspector expansion.
- Clarified in the README that Layer A extracts provable facts while Layer B
  carries project-specific relationships, flows, intent, invariants, and open
  questions for future agents.
- Documented that bootstrap output should lead directly into agent-assisted
  enrichment instead of leaving users to hand-author semantic ontology YAML.
- Added the first v0.6 sanitized ontology before/after dogfood record,
  showing static-only ontology versus bootstrap plus agent-enriched ontology
  on a NestJS/Prisma backend fixture.
- Added a v0.7 roadmap item for a repeatable benchmark/report command so
  future README claims can be backed by measured before/after context quality,
  not just anecdotal dogfood notes.
- Documented the Layer A introspector change gate and recorded a sanitized
  follow-up showing NestJS route facts increasing after `@Sse()` support.

## [0.5.0] — 2026-04-30

Context-continuity release: validates the main product promise across
Claude Code, Codex, and Cursor with dogfood automation, active-handoff
simulation, stale-handoff diagnostics, and repair guidance.

### Documentation

- Re-centered the roadmap on anamnesis' product purpose: always inject
  current context/ontology and let users switch agents without re-briefing.
- Clarified the roadmap after v0.4: v0.5 proves context continuity across
  real agent switches, v0.6 deepens ontology automation from dogfood gaps,
  and v0.7 hardens multi-agent UX/lifecycle scale.
- Documented the current npm Trusted Publishing/OIDC status and the
  manual npmjs.org publish fallback.
- Aligned README, design notes, monorepo docs, fragment docs, and the
  Agentfile spec with the current context-continuity model.

### Tests

- Added a cross-agent continuity acceptance fixture for the base fragment.
  It verifies that Claude Code, Codex, and Cursor render the shared
  context/ontology contract, handoff startup instructions, operational
  guardrails, and command/skill surfaces needed for agent switching.

### Changed

- Dogfooded anamnesis on itself with all three supported adapters enabled:
  Claude Code, Codex, and Cursor.
- Added [`docs/DOGFOOD.md`](docs/DOGFOOD.md), a recurring self-check log
  for tracking whether new versions improve context continuity, ontology
  availability, adapter parity, diagnostics, and verification strength.
- Added `anamnesis dogfood check --append` plus npm `dogfood` /
  `release:check` scripts so version bumps can record the self-check before
  publish.
- `anamnesis status` now reports first-class continuity readiness for
  project memory, ontology, handoff startup, enabled adapter surfaces, and
  managed drift. `anamnesis doctor` surfaces the same failures as
  continuity-specific warnings, and dogfood scoring reuses the status
  continuity result instead of duplicating adapter checks.
- Dogfood verification now runs an active handoff switch simulation: it
  installs all supported adapter surfaces in a temporary project, writes an
  `active.md` handoff index plus archive, executes the Claude Code handoff
  injection hook, and verifies Codex/Cursor fallback instructions are present.
- `status` / `doctor` now diagnose stale active handoff state separately from
  handoff startup instructions. Missing archive references, active tasks
  pointing away from the newest archive, and completed/superseded entries in
  open handoff sections are reported before a fresh agent trusts stale state.
- Added the first sanitized dogfood matrix for v0.5, covering a managed
  NestJS+Prisma fixture, a fresh Next.js fixture, and a fresh NestJS+k8s
  fixture. The matrix records continuity, doctor, ontology bootstrap, and
  handoff injection evidence without publishing private source identifiers.
- Adapter-surface continuity failures now target only the missing or drifted
  surfaces, keeping `doctor` output actionable on real existing projects.
- `doctor` issues now include repair guidance for user-modified managed files,
  adapter-surface continuity failures, invalid settings, missing hook
  registrations, and stale active handoff state.
- Reviewed the current introspector API as part of the v0.5 scope and kept
  framework expansion deferred; v0.6 owns deeper ontology schema and refresh
  lifecycle work.

### Coverage

419 tests across 35 files.

## [0.4.4] — 2026-04-30

Release automation verification after npm Trusted Publishing was configured
for the GitHub Actions workflow.

### Changed

- Bumped the package to validate whether the tag-triggered publish workflow
  can publish via npm OIDC without a local owner-token fallback. The
  workflow reached `npm publish`, but npmjs.org rejected the OIDC publish
  with E404; `0.4.4` was not published to npmjs.org.

### Coverage

405 tests across 33 files.

## [0.4.3] — 2026-04-30

Packaging recovery for npm publish after the `v0.4.2` tag workflow
reached the registry step but could not complete the release.

### Fixed

- Normalized the CLI `bin` path so npm 11 does not auto-correct the
  package metadata during publish.
- Publish workflow now checks whether the package version already exists
  on npmjs.org before running `npm publish`, keeping tag workflows
  idempotent after a manual owner-token recovery publish.

### Coverage

405 tests across 33 files.

## [0.4.2] — 2026-04-30

Operational polish for agent continuity, pinned fragment updates, release
automation, and broader stack detection.

### Added

- **`anamnesis doctor`** — read-only installation integrity diagnostics.
  Reports manifest parse/missing errors, tracked file or region drift,
  missing library fragments, fragment updates, adapter renderer gaps,
  invalid `.claude/settings.json`, and installed Claude hooks missing
  from settings registration.
- **`anamnesis status --json`** — prints the existing structured status
  result as stable JSON for CI and other tools.
- **base v6 handoff continuity** — `/handoff-prepare` now writes both a
  timestamped archive and `.anamnesis/handoff/active.md` multi-task
  index. `inject-handoff.sh` injects the active index plus the latest
  archived handoff, and the new Claude Code `Stop` hook
  `handoff-reminder.sh` reminds agents when uncommitted work is newer
  than the latest handoff.
- **full fragment pinning** — `update` now renders `pinned: true`
  fragments from `base/.versions/<version>/` or
  `fragments/<id>/.versions/<version>/` instead of library-current.
  `update --bump-pinned` explicitly moves pinned entries to the current
  library version while keeping them pinned.
- **Trusted Publishing workflow** — GitHub Actions release workflow for
  npm Trusted Publishing via OIDC, plus release docs with the npmjs.com
  trusted publisher fields required for `@mcprotein/anamnesis`.
- **fragment catalog expansion** — added project memory + ontology
  fragments and rulebook triggers for Rails, Django, Go, Rust,
  SvelteKit, Remix, and Nuxt.
- **Codex hook auto-wiring** — Codex `executable_hook` rendering now
  installs a best-effort Git `pre-commit` bridge in Git repos while
  keeping the AGENTS.md fallback. Prisma and k8s fragments move to v2
  to opt into Codex hook support, with v1 archives preserved for pinned
  installs.

### Coverage

405 tests across 33 files.

## [0.4.1] — 2026-04-30

Ontology bootstrap expansion for common web/backend stacks and monorepo
scope-local bootstrap output.

### Added

- **nextjs introspector** (`cli/src/introspectors/nextjs.ts`) —
  finds App Router `page` / `route` files, Pages Router pages and
  `pages/api` routes, exported HTTP methods on route handlers, and
  middleware files. Output is stable-sorted.
- **nestjs introspector** (`cli/src/introspectors/nestjs.ts`) —
  scans source files for `@Controller()` classes and HTTP method
  decorators (`@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@All`,
  etc.), producing controller prefixes plus stable-sorted route facts
  without adding TypeScript parser dependencies.
- **fastapi introspector** (`cli/src/introspectors/fastapi.ts`) —
  scans Python source for `FastAPI()` apps, `APIRouter()` routers,
  path operation decorators (`@app.get`, `@router.post`,
  `@router.api_route`, etc.), and `include_router` calls. Route facts
  stay separate from include prefixes so Layer A avoids cross-file
  inference.
- **multi-scope ontology bootstrap** — `anamnesis ontology bootstrap`
  now resolves `project.scopes`, runs fragment introspectors from each
  scope root, and writes scope-local
  `<scope>/.anamnesis/ontology/<id>.bootstrap.yaml` files. The
  `--scope` and `--fragment` filters work across scopes.

### Coverage

389 tests across 32 files.

## [0.4.0] — 2026-04-29

Hybrid ontology bootstrap. New projects no longer start with an empty
ontology slice — `anamnesis init` now auto-populates
`.anamnesis/ontology/<id>.bootstrap.yaml` from project files via
fragment-specific introspectors (Layer A), and the new
`ontology-enrich` skill instructs the active agent (any tool) to add
the semantic layer parsers can't infer (Layer B). See
[`docs/ONTOLOGY-BOOTSTRAP.md`](docs/ONTOLOGY-BOOTSTRAP.md) for the
two-layer design.

### Added

- **`Introspector` interface + `IntrospectorRegistry`**
  (`cli/src/core/introspector.ts`). Each fragment that wants bootstrap
  support registers an Introspector keyed by its fragment id with two
  hooks: `appliesTo(project)` (cheap pre-flight) and `introspect(project)`
  (returns plain JS object → YAML).
- **`anamnesis ontology bootstrap`** command
  (`cli/src/commands/ontology.ts`) — Layer A entrypoint. Walks the
  Agentfile, looks up an introspector for each installed fragment,
  runs it, writes `.anamnesis/ontology/<id>.bootstrap.yaml` with a
  deterministic header. Flags: `--fragment <id>`, `--dry-run`,
  `--project-root`. Outcomes: `written` / `unchanged` /
  `skipped-no-introspector` / `skipped-not-applicable`.
- **k8s introspector** (`cli/src/introspectors/k8s.ts`) — walks
  project YAML files, multi-doc aware, extracts `namespaces`,
  `services` (name/ns/type/ports/selector), `ingresses` (host/paths/
  backend), `workloads` (Deployment / StatefulSet / DaemonSet / Job /
  CronJob with images + replicas). Stable sort by (namespace, name).
  Verified on a sanitized Kubernetes fixture: namespaces, ingresses, services,
  and workloads render as structured output.
- **prisma introspector** (`cli/src/introspectors/prisma.ts`) —
  finds `**/schema.prisma`, regex-based block parser, extracts
  `datasources`, `generators`, `models` (with field-level type +
  attributes like `@id` / `@default` / `@relation`), `enums` (with
  values). Multi-file schema layouts supported. Verified on a sanitized
  Prisma fixture with datasource, generator, enum, model, and attribute
  extraction.
- **`ontology-enrich` skill** — Layer B. Shipped as a new `skill`
  capability of the base fragment (v4 → v5). Tool-agnostic via the
  existing skill renderer pipeline: CC gets a native SKILL.md, Codex
  gets an AGENTS.md `codex-skill-ontology-enrich` region, Cursor gets
  a `.cursor/rules/ontology-enrich.mdc` with `agentRequested: true`.
  Instructs the active agent to read the bootstrap output + project
  manifests and write `<id>.enriched.yaml` files containing
  relationships / flows / operational_notes that parsers cannot
  extract.
- **`anamnesis init` auto-bootstrap** — after fragment install, init
  runs `ontology bootstrap` automatically. Fragments without a
  registered introspector are silently skipped. Bootstrap failures do
  not fail init; the message is surfaced in the CLI report. Opt out
  with `--no-bootstrap`.

### Coverage

356 tests across 29 files (was 329 at 0.3.0 ship). New: 5 k8s
introspector, 8 prisma introspector, 8 bootstrap command, 3 init
auto-bootstrap.

### Originally targeted for 0.4.x patches

- nextjs / nestjs / fastapi introspectors and multi-scope bootstrap
  shipped in 0.4.1.
- introspector author SDK docs moved to v0.5.

---

## [0.3.0] — 2026-04-28

Three-tool parity + agent handoff. anamnesis now renders all 5
capabilities for Claude Code, Codex, and Cursor; ships a tool-agnostic
agent-handoff workflow; auto-detects monorepo workspaces; and groups
`status` output by scope.

### Added

- **Cursor adapter** — full 5/5 capability coverage. `executable_hook`,
  `skill`, `slash_command` emit `.cursor/rules/<id>.mdc` files with
  `agentRequested: true` so Cursor's agent applies the rule when the
  situation matches `description`. `project_memory` and `ontology` reuse
  the Claude Code outputs (Cursor reads AGENTS.md natively). New prefix
  `.cursor/rules/` added to `EXEC_ADAPTER_PREFIXES` so Cursor exec-adapter
  files are gated behind `--allow-exec-adapters` for supply-chain
  consistency. `scoped_rule` (Cursor-native glob scoping) deferred.
- **Codex adapter completion** — `executable_hook`, `skill`,
  `slash_command` now have Codex renderers that emit AGENTS.md region
  fallbacks (`codex-hook-<basename>` / `codex-skill-<name>` /
  `codex-cmd-<name>`) carrying the script body / skill body / command
  body inline. Codex agents honor the intent manually since Codex has
  no native hook system. Git pre-commit auto-wiring deferred to v0.4.
- **`init --monorepo`** — detects `package.json` `workspaces` field,
  expands `<dir>/*` patterns and exact paths, runs the rulebook in each
  sub-project, and generates a multi-scope Agentfile with one
  `extends: '.'` scope per matched workspace. Sub-scopes skip fragments
  already at root to avoid duplicate installs. Empty workspaces (no rule
  match) reported separately. pnpm-workspace.yaml / lerna / nx /
  conventional-dir detection + interactive prompt remain follow-up.
- **`status` per-scope grouping** — multi-scope projects group fragments
  and drift entries under each scope. Single-scope output unchanged.
  Each entry is bucketed to its longest-matching scope path; exec-adapter
  files always belong to root (CC `settings.json` is read only at root).
- **Agent handoff MVP** — base fragment v3 + v4 ship `/handoff-prepare`
  slash command + `inject-handoff.sh` SessionStart hook + tool-agnostic
  AGENTS.md "session start: handoff 자동 확인" instruction. Departing
  agents write `.anamnesis/handoff/<ISO-ts>.md` capturing goal / done /
  in-flight / decisions / open questions / next steps; arriving agents
  (Claude Code via hook, Codex/Cursor via AGENTS.md instruction) read
  the latest handoff and resume from where the previous session stopped.
- **Multi-scope rendering** — `init` and `update` iterate over
  `effectiveScopes(agentfile)` and emit per-scope render targets.
  `dedupeActions` collapses duplicate AGENTS.md region writes when CC +
  Codex + Cursor all emit the same project_memory or ontology slice.

### Tests

329 passing across 27 test files (was 299 in v0.2). New coverage:
Cursor MDC rendering, Codex region fallbacks, monorepo detection,
multi-scope status grouping.

### Targeted for v0.4

- **Hybrid ontology bootstrap** — two-layer auto-generation. Layer A
  (deterministic CLI introspectors): `anamnesis ontology bootstrap` runs
  per-fragment parsers (k8s manifests → namespace/service/port, prisma
  schema → model/relation, nextjs → routes, fastapi/nestjs → routers).
  Layer B (agent-driven): `/ontology-enrich` skill fills in semantic
  relationships, flows, and operational notes parsers can't extract.
  Companion `Introspector` SDK so community fragments ship their own
  parsers.
- **Full version pinning** — fragment version cache + `.versions/`
  storage. Moved from v0.3 (low value while user base is small).
- **`anamnesis update --bump-pinned`** — companion to full pinning.
- **Handoff auto-trigger** + multi-task tracking + recovery.
- **`anamnesis doctor`** — installation integrity check.
- **Codex hook auto-wiring** — git pre-commit installer.
- **Trusted Publishing** — GitHub Actions + OIDC for npm releases.
- **Fragment catalog expansion** — Rails, Django, Go, Rust, sveltekit, etc.
- **`anamnesis status --json`** — structured output for CI.

Full breakdown in [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## [0.2.0] — 2026-04-27

Multi-tool, multi-scope. anamnesis now produces context for both Claude
Code and Codex, supports monorepo layouts, ships a `status` reporter,
and rounds out the fragment catalog.

### Added

- **`status` command** — read-only project state report. Lists installed
  fragments (`in-sync` / `update-available` / `pinned` / `library-missing`),
  per-region and per-file drift (`clean` / `user-modified` / `missing`),
  suggested rulebook matches, declined entries.
- **Codex adapter** (minimum scope) — `project_memory` + `ontology`
  capabilities. Codex reads AGENTS.md natively; the same content
  rendered for Claude Code is emitted when `codex` is listed in
  `Agentfile.tools`. Concurrent CC + Codex emissions are deduped by
  target identity. Hook / skill / slash-command fallbacks remain v0.3.
- **Monorepo `scopes` support** — multi-scope `Agentfile.project.scopes`
  layouts with `extends` chains and `overrides.{tools, fragments_add,
  fragments_remove}`. project_memory + ontology write to scope-relative
  paths; exec adapters stay at project root (Claude Code reads
  `settings.json` only at root).
- **`promote` supports `project_memory`** — promote a markdown file or
  extract a named region from AGENTS.md into a new fragment via
  `--type=project_memory [--region=<id>]`.
- **`nextjs` + `docker-compose` fragments** shipped. All 8 rulebook
  rules now resolve to a real fragment.
- **`.claude/settings.json` auto-registration** — `executable_hook`
  capabilities install the hook script AND register it in settings.json
  with idempotent JSON-structural merge. Older anamnesis installs
  self-heal on the next `update --apply`. Indent style of the existing
  settings.json file is detected and preserved (2-space / 4-space / tab).
- **`scope.ts` core module** — `effectiveScopes(agentfile)` resolves
  multi-scope inheritance and overrides into per-scope effective
  configs. v0.1 single-scope and `[- path: .]` Agentfiles map to a
  single root scope (back-compat).
- **base fragment v2** — `inject-ontology.sh` SessionStart hook now
  walks `**/.anamnesis/ontology/*.yaml` recursively for monorepo
  awareness. `load-context` skill and slash command updated to mention
  scoped ontology directories.

### Tests

299 passing across 22 test files (was 229 in v0.1).

### Targeted for v0.3

- ~~**Cursor adapter**~~ — *shipped (5/5 capabilities)* —
  · project_memory + ontology: same outputs as CC (Cursor reads
    AGENTS.md natively).
  · executable_hook / skill / slash_command: emit `.cursor/rules/<id>.mdc`
    with `agentRequested: true` so Cursor's agent applies the rule when
    the situation matches `description`.
  · `.cursor/rules/` added to `EXEC_ADAPTER_PREFIXES` (gated behind
    `--allow-exec-adapters` for supply-chain consistency).
  · CC + Codex + Cursor co-existence: each adapter targets its own files;
    region/file dedup applies for shared targets (AGENTS.md region,
    ontology slice).
  · `scoped_rule` capability (Cursor-native glob scoping) deferred to
    a follow-up patch — current MDC output uses `agentRequested` only.
- ~~**Codex adapter completion**~~ — *shipped (AGENTS.md region path)* —
  `executable_hook`, `skill`, `slash_command` now have Codex
  renderers that emit region-based fallbacks (script body / skill body /
  command body) into AGENTS.md so Codex agents can honor the intent
  manually. CC + Codex co-existence: CC installs native files; Codex
  reads region instructions from AGENTS.md. Git pre-commit auto-wiring
  for hooks remains v0.4 polish (low value compared to the AGENTS.md
  path).
- ~~**Monorepo init UX**~~ — *partial: `init --monorepo` shipped* —
  detects `package.json` `workspaces` field, expands `<dir>/*` patterns,
  runs the rulebook in each sub-project, and generates a multi-scope
  Agentfile with one `extends: '.'` scope per matched workspace.
  Reports empty workspaces (no rule match) separately. Interactive
  prompt + pnpm-workspace.yaml / lerna / nx / conventional-dir detection
  remain follow-up.
- ~~**`status` per-scope grouping**~~ — *shipped* — multi-scope projects
  group fragments and drift entries under each scope. Single-scope output
  unchanged. Each entry is bucketed to its longest-matching scope path
  (exec-adapter files always belong to root since CC `settings.json`
  is read only at root).
- ~~**Agent handoff MVP**~~ — *shipped in base v3 + v4* —
  `/handoff-prepare` slash command + `inject-handoff.sh` SessionStart hook
  + base v3 capability bundling for Claude Code (settings.json
  auto-registered). Base v4 added a tool-agnostic "session start: handoff
  자동 확인" instruction in AGENTS.md so Codex/Cursor agents read
  `.anamnesis/handoff/<ts>.md` manually at session start.

### Targeted for v0.4

- **Hybrid ontology bootstrap** — two-layer auto-generation of
  `.anamnesis/ontology/<id>.yaml`. Layer A: `anamnesis ontology bootstrap`
  runs deterministic per-fragment introspectors (k8s manifests, prisma
  schema, nextjs routes, fastapi/nestjs routers) to extract namespace,
  port, model, route facts without an LLM. Layer B: `/ontology-enrich`
  skill instructs the active agent (any tool) to fill in semantic
  relationships, flows, and operational notes parsers can't extract.
  Fragment-author SDK exposes an `Introspector` interface so community
  fragments can ship their own parsers.
- **Full version pinning** — fragment version cache so `pinned: true`
  renders the pinned version, not library-current. Library stores past
  versions under `fragments/<id>/.versions/`. (Moved from v0.3 — low
  value while user base is small.)
- **`anamnesis update --bump-pinned`** — companion to full pinning.
- **Handoff auto-trigger** + multi-task tracking + recovery.
- **`anamnesis doctor`** — installation integrity check.
- **Codex hook auto-wiring** — git pre-commit installer for
  `executable_hook` (deferred from v0.3). Currently Codex agents read
  region instructions manually.
- **Trusted Publishing** — GitHub Actions + OIDC for npm releases.
- **Fragment catalog expansion** — Rails, Django, Go, Rust, sveltekit, etc.
- **`anamnesis status --json`** — structured output for CI.

Full breakdown in [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## [0.1.0] — 2026-04-26

First daily-use release. Validated on 4 repositories (anamnesis itself
plus 3 user projects across infra / ML / NestJS stacks).

### Added

#### Core
- `Agentfile` (v1 schema) — declarative project manifest.
- `.anamnesis/manifest.json` — region/file hash tracking with 6-field
  entries (`base_rendered_hash`, `last_applied_hash`,
  `current_user_hash`, fragment id/version, template version, params).
- Region anchor parser (`<!-- anamnesis:region id=… fragment=…@n -->`):
  parse, render, upsert, remove, byte-perfect roundtrip.
- Fragment loader with topological sort (`requires`) and conflict
  detection.
- `triggers.ts`: TriggerExpr DSL (`package_json_has`, `pyproject_has`,
  `file_exists`, `dir_exists`, `any_yaml_contains` + `any` / `all`).
- `rulebook.ts`: markdown rulebook parser with code-fence skipping.
- `applier.ts`: planning + applying with 5 statuses
  (`create`, `update`, `noop`, `user-modified`, `blocked`).
- Backup-before-apply to `.anamnesis/backups/<ISO-timestamp>/`.

#### Adapters
- Claude Code adapter for all 5 capabilities
  (`project_memory`, `ontology`, `executable_hook`, `skill`,
  `slash_command`).
- `RendererRegistry` — adapter-scoped, isolation-friendly.

#### Commands
- `init`: rulebook → suggestions → install. Auto-includes `base`.
- `update`: dry-run by default; `--apply` writes. Reports `suggested`
  rulebook matches without auto-installing. Auto-bumps fragment
  versions in Agentfile on apply.
- `promote`: lift a project-local file into the library as a fragment
  capability (executable_hook / slash_command / skill / ontology;
  project_memory added in v0.2).

#### Fragments (library)
- `base`, `prisma`, `k8s`, `nestjs`, `python-uv`, `fastapi`.

#### Safety
- `--allow-exec-adapters` flag gates `.claude/{hooks,commands,skills}/`
  writes (supply-chain protection).
- Files on disk without manifest entries are classified as
  `user-modified` and never overwritten.
- `update` is dry-run by default.

### Coverage

229 tests across 18 test files.

### Repository policy

The repository is public. All committed fragments and tests use
synthetic data. Personal data (IPs, hostnames, user paths, internal
identifiers) does not appear in any committed file.

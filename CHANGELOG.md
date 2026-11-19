# Changelog

All notable changes to anamnesis are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
the project follows semver from v1.0 forward. Before v1.0, minor version bumps
could include breaking changes.

Older entries live in `docs/changelog/`:

- [1.0.0 – 1.9.6](docs/changelog/1.0-1.9.md)
- [0.1.0 – 0.9.0](docs/changelog/0.x.md)

## [Unreleased]

- `context index` also indexes top-level Markdown files in `docs/roadmap/`, `docs/dogfood/`, and `docs/changelog/` when those folders exist, so `context query` still finds roadmap, dogfood, and changelog entries moved out of the top-level files. It skips subfolders, indexes at most 200 files per folder by name, and reports a warning when a folder has more.

## [1.25.5] — 2026-10-11

- `apply` adopts a tracked managed file whose content already equals the new content, even when its manifest hash is out of date, instead of reporting it as user-modified; managed regions follow the same rule. A git checkout that restores a tracked `.anamnesis/manifest.json` while the file lives outside git (for example `.git/hooks/pre-commit`) made `projects apply` skip such projects on every run.

## [1.25.4] — 2026-10-11

- Base fragment v31 fixes the Claude hook scripts on macOS's default bash 3.2: an empty array under `set -u` ended `handoff-reminder.sh` with "unbound variable" (Codex turned that error into a Stop block on every turn), and the same pattern is fixed in `inject-handoff.sh` and `inject-ontology.sh`.
- `apply` rewrites a bare `.claude/hooks/...` command left under a user-chosen matcher to the `"$CLAUDE_PROJECT_DIR"` form, removes a bare entry of a user-modified hook when the current form is already registered, and treats a hand-written `$CLAUDE_PROJECT_DIR` spelling under a legacy matcher as superseded. `doctor` warns when a bare command remains next to the current form.
- The generated `CLAUDE.md` mentions the Codex fallback sections only when the project also renders Codex, and states that `.claude/` and `.anamnesis/codex-instructions/` are at the repository root.
- A registered project whose volume device number changed stays valid only when its Agentfile still names the registered project; another volume mounted at the same path can reuse the root inode number.
- Work prompt staging treats a concurrent hook that staged the same bytes at the same ordinal as a replay instead of adding a second token.
- CLI integration tests kill a blocked child process after 60 seconds, and the publish workflow limits the test step to 15 minutes.

## [1.25.3] — 2026-10-11

- `doctor` accepts hand-written hook commands that spell `$CLAUDE_PROJECT_DIR` differently (unquoted, fully quoted, or `${CLAUDE_PROJECT_DIR}`) as the same registration. A managed hook that a user registered under a different event is reported as warning `hook-registration-moved` instead of error `hook-registration-missing`.

## [1.25.2] — 2026-10-11

- Registered projects stay valid when only the volume device number changes. macOS can renumber APFS volumes after a reboot or OS update, and the registry compared that number, so `projects plan|apply` and `upgrade --apply` skipped unchanged projects as stale. The canonical path plus inode still detects a replaced directory.

- The publish workflow retries each registry up to 12 times (255 seconds of 5–30 second backoff, plus up to 10 seconds per lookup; the step is capped at 20 minutes) before the parity check fails. v1.25.0 and v1.25.1 both published successfully but failed the previous 15-second window, so the GitHub Release waited for a rerun.

## [1.25.1] — 2026-10-11

- Fix the opt-in real Codex dogfood smokes for current Codex CLI (verified on 0.160.0). Each smoke now uses a temporary `CODEX_HOME` that links the operator's `auth.json` and trusts its own smoke hooks through the Codex app-server, because Codex skips untrusted hooks. Trust state is written only to the temporary home. `dogfoodCheck` is now async.
- `anamnesis dogfood check` prints the reason under each failed check.
- The Codex pre-commit bridge prints each distinct hook output line once per commit. A project-wide reminder no longer repeats once per staged file. Hook exit codes are unchanged.

## [1.25.0] — 2026-10-11

- Claude Code reuses the current `prompt_id` for later turns inside one user prompt, such as background-task notifications and queued messages. Work prompt capture no longer reports these turns as a failed stage that holds repository writes: an identical pending replay is not staged again, and different text takes the next ordinal boundary (`<prompt_id>#2`, ...) with its own classification token. The ordinal never derives from prompt bytes.
- The generated `CLAUDE.md` states the Work capture policy when `work_prompt_capture` is enabled. In five `claude -p` runs per arm, Claude Sonnet 5.5 recorded the classification in 4/5 runs with this line versus 2/5 with hook text alone (small sample).
- The `load-context` skill description no longer invites a reload at session start, because SessionStart hooks already inject the digest. The ontology digest matches case-insensitively in BSD awk too (`IGNORECASE` is gawk-only).

- Register Claude Code hooks as `"$CLAUDE_PROJECT_DIR"/.claude/hooks/...` and prune the legacy bare relative registrations on apply. The relative form made the `work-briefing.sh` shell/Node polyglot fail with `MODULE_NOT_FOUND` on every prompt, so Work prompt capture and briefings never ran under Claude Code; the polyglot now also resolves a relative `$0`.
- Base fragment v30 makes the uncommitted-changes and handoff reminders reach Claude Code. Claude never sees stderr from an exit-0 hook, so the Claude path now emits PostToolUse `additionalContext` (once per block of 8 dirty paths) and a user-facing Stop `systemMessage`; the Codex bridges keep their plain-text output. The Claude edit matcher widens from `Edit` to `Edit|Write|NotebookEdit`.
- The generated `CLAUDE.md` imports `AGENTS.md` with `@AGENTS.md`. Claude Code does not load `AGENTS.md` when a `CLAUDE.md` exists, so the previous prose pointer only worked when the model chose to open it.
- Claude SessionStart hooks no longer repeat the context-query rule (now loaded once through the imported `CLAUDE.md`/`AGENTS.md`) and state source pointers as facts instead of imperative rules. Work hook context, shared by Claude Code and Codex, is restated as factual policy with the same outcomes and commands; Claude Code's hook guidance notes that command-style injected text can trigger prompt-injection defenses.

## [1.24.4] — 2026-09-21

- Refresh version-sensitive Next.js, Prisma and Remix guidance; archive the previous fragment versions and advance their integer versions.

- Refresh repository guides against the current CLI, capability schema and adapter behavior; distinguish historical designs from shipped contracts.
- Align generated Claude Code handoff guidance with active/warm archive selection so completed and cold history is not loaded at startup.
- Base fragment v29 avoids preliminary directory scans and rereading already-loaded instructions when sources are known. Batch already-required queries with independent startup checks; retain dependent source reads, ontology/handoff checks, and recovery from missing paths.
- A controlled GPT-6 Astra pilot (18 main runs plus 4 missing-path holdout runs) preserves task/source correctness in all 22 runs. Versus v1.24.3, total tokens fall 27.82% for known-path edits and 36.38% for stale-evidence edits; missing-path recovery is +0.37%. These cached-inclusive, small-fixture results are not general latency or billing claims. See `docs/benchmark-evidence/retrieval-batching-candidate/README.md`.

## [1.24.3] — 2026-09-17

- Base fragment v28 uses evidence sufficiency, rather than edit intent, to decide when context queries are required. Align shared Claude Code/Codex/Cursor instructions and native startup reminders; preserve source reading, stale-evidence retrieval, ontology/handoff checks, and authorization boundaries.
- Avoid replaying completed native startup discovery or rereading unchanged originals already checked in the current session. Compact pointers and summaries still do not replace original evidence.

## [1.24.2] — 2026-09-08

- Drain large registered-project JSON output before CLI exit, including upgrade's combined result. This prevents successful project synchronization from being reported as a JSON parse failure when output exceeds a pipe buffer.
- Isolate CLI integration-test registrations in temporary state so tests do not add fixtures to the user's project registry. Preserve all behavior assertions and existing process deadlines.

## [1.24.1] — 2026-09-07

- Give each advanced-namespace CLI help invocation its own existing test budget instead of charging three sequential subprocesses to one deadline. Preserve all assertions and the same three CLI executions.

## [1.24.0] — 2026-09-07

Unpublished: the tag workflow stopped at the CLI namespace-help test timeout
(36.7 seconds across three subprocesses against a shared30-second test limit).
Neither registry publication nor GitHub Release creation ran. The failed tag
and run34141177326 are retained; superseded by1.24.1.

- Guide agents to transition newly verified Work requirements using existing evidence before reporting execution complete, while preserving cancellation, read-only requests and terminal Work boundaries.

- Align Codex native source-retrieval guidance with the shared read-only fast path and identify completed built-in startup discovery; base fragment advances to v27.

- Restrict Codex hook manual loading to the actual trigger and unavailable per-procedure native support; silent native success does not require replay. Unsupported custom SessionStart hooks no longer advertise the built-in wrapper.

- Avoid redundant source discovery for read-only tasks with sufficient known originals, while preserving mandatory ontology/handoff checks, query-on-insufficient-evidence and edit safeguards. Batch independent startup reads; base fragment advances to v26.

- Keep Codex procedure routing in AGENTS.md while preserving full hook, skill and command fallback instructions in managed Markdown sources. Native adapters and other clients retain their existing paths; runtime efficiency is evaluated separately.

- Add an explicit read-only instruction audit with bounded project inventory, recorded ownership and drift, literal duplicate references, and compatibility-aware review guidance. Disk bytes are kept separate from runtime token/performance claims.

- Remove six redundant adapter registration checks already covered by the parity matrix and consolidate two identical reviewer-repair cases while preserving their combined assertions. Exercise three publication recovery faults directly, preserving their assertions and end-to-end publication coverage without rerunning the entire fake benchmark.

- Remove five further duplicate tests and 14 redundant assertions with retained coverage witnesses. Run adapter-independent stale diagnostics once while retaining all nine actual adapter-switch paths. The cleanup checkpoint retained 1,275 passing tests; subsequent feature regressions are counted separately.

## [1.23.6] — 2026-09-07

### Fixed

- Serialize dead-owner reclamation by owner nonce and revalidate held directory
  and owner-file identities after death proof. Concurrent reclaimers cannot
  remove a newly acquired Work ledger or source lock; uncertain ownership and
  abandoned reclaim claims fail closed.
- Run concurrent CLI regression children directly with the TypeScript loader,
  preserving all 64 concurrent calls and accounting assertions while avoiding
  a redundant Node launcher per child.
- Carry the Codex steering, private capture and native Work recovery fixes from
  the unpublished 1.23.5 attempt. Its tag workflow stopped at tests before either
  registry publication; the tag is retained as failure evidence.

## [1.23.5] — 2026-09-07

Unpublished: the tag workflow failed its test gate before registry publication.
Superseded by the next patch; the original tag and failed run remain unchanged.

### Fixed

- Fix native session binding in Work selection and explicit legacy-cursor repair so compact recovery can retain its strict session equality checks.

- Capture each Codex user-prompt delivery separately because a native `turn_id`
  can contain multiple mid-turn steering messages. Local capture tokens grant
  no Work authority; explicit classification and contract CAS remain required.
  Existing stable-ID receipt validation remains strict; resolution retries
  still use the explicit idempotent resolution commands.
- Verify entire raw-storage directories, not sentinel filenames, and recheck
  privacy on each capture so changed ignore rules cannot reuse a stale proof.
- Prepare private raw-prompt Git exclusions during bounded-capture init/apply,
  preserving user ignore content and failing closed on tracked or unsafe paths.
  Protected primary Work storage remains usable from linked worktrees without
  modifying the owning checkout.
- Document strict Work draft formats in `anamnesis work --help` and link that
  help from prompt classification, avoiding schema guesses during onboarding.

- Normalize Codex native `spawn_agent` and `collaborationspawn_agent` hook
  names to the existing `Agent` boundary without forwarding tool payloads.
- Make open Work briefing continuation subordinate to the latest user
  cancellation, pause, or redirection; recovery does not change ledger state.
- Keep Work hook briefings and session cursor observations aligned with fresh
  ledger state when prompt updates and parallel tool completions overlap.
- Restore the exact session-selected Work after Codex `SessionStart` with source
  `compact`, including unchanged requirements and completion criteria. Recovery
  is read-only, respects disabled reconciliation, and fails open when unavailable.
- Clarify standalone versus auxiliary handoff/orientation behavior: supporting
  checkpoints continue the active task, reminders do not write handoffs, and
  clearly completed stale handoffs do not require redundant confirmation.
  Base fragment 25 carries the instruction and native-hook updates; existing
  project adapters are updated only through the normal explicit apply process.

## [1.23.4] — 2026-09-01

### Fixed

- Kept maintainer-only subagent benchmark freshness findings out of the default
  human-readable `doctor` warning count and issue list. The full diagnostics
  remain available through `doctor --verbose` and continue to feed release,
  dogfood, markdown, and evidence consumers.

## [1.23.3] — 2026-09-01

### Fixed

- Applied a shared 90-second CI budget to the deterministic Work-agent
  benchmark artifact tests. The `v1.23.2` tag stopped on a loaded runner
  timeout before any registry write, so it is unpublished and superseded by
  `v1.23.3`.

## [1.23.2] — 2026-09-01

### Fixed

- Applied the explicit CI budget to both init-driven CLI presentation
  regressions. The `v1.23.1` tag stopped on the adjacent default timeout before
  any registry write, so it is unpublished and superseded by `v1.23.2`.

## [1.23.1] — 2026-09-01

### Fixed

- Added an explicit CI budget to the narrow-width doctor CLI regression test.
  The `v1.23.0` tag stopped on the default test timeout before any registry
  write, so it is unpublished and superseded by `v1.23.1`.

## [1.23.0] — 2026-09-01

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

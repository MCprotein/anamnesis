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

Branch-state note: the current unreleased WIP line is allowed to remain in the
existing branch state. Starting with the next version line, version-specific
work should happen on `release/vX.Y` branches with focused `feat/vX.Y/<topic>`
branches, then merge to `main` only when that release line is verified and
ready to tag. After publish and post-publish smoke pass, delete the merged
release branch locally and remotely unless a documented blocker or immediate
patch recovery need remains. This keeps roadmap WIP, package version, registry
state, and branch inventory from drifting apart.

## Product north star

anamnesis exists to make AI coding agents remember a project without the
user repeating setup instructions every session.

Two promises drive the roadmap:

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

## v0.1 — *shipped 2026-04-26*

> First daily-use release. Single tool (Claude Code). Local installs only.

| Area | Done |
|---|---|
| Core primitives | Agentfile schema, manifest hash tracking, region anchors, fragment loader, applier with 5 statuses |
| Capabilities | `project_memory`, `ontology`, `executable_hook`, `skill`, `slash_command` (Claude Code adapter only) |
| Commands | `init`, `update`, `promote` |
| Idempotency | dry-run by default, backups before apply, user-modified detection |
| Fragments | `base`, `prisma`, `k8s`, `nestjs`, `python-uv`, `fastapi` |
| Coverage | 229 tests |

---

## v0.2 — *shipped 2026-04-27*

> Multi-tool, multi-scope. npm publish. Doubled test coverage.

| Area | Done |
|---|---|
| New command | `status` (drift + suggested + declined report) |
| New adapter | Codex (`project_memory` + `ontology` only) |
| New layout | Monorepo `scopes` with `extends` + `overrides.{tools, fragments_add, fragments_remove}` |
| New fragments | `nextjs`, `docker-compose` (rulebook 100% mapped) |
| Settings | Auto-register hooks in `.claude/settings.json` (idempotent JSON merge, indent preserved) |
| `promote` | Now supports `project_memory` (region extraction from AGENTS.md) |
| Distribution | Published as `@mcprotein/anamnesis` on npmjs.org |
| Coverage | 299 tests |

---

## v0.3 — *shipped 2026-04-28*

> **Theme: complete the multi-tool promise + monorepo UX polish**

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Cursor adapter** | shipped | `.cursor/rules/*.mdc` output with `agentRequested: true`. Covers all 5 capabilities. `scoped_rule` (Cursor-native glob scoping) deferred. |
| 2 | **Codex adapter completion** | shipped (AGENTS.md path) | `executable_hook` / `skill` / `slash_command` emit AGENTS.md region fallbacks (script body / skill body / command body). Git pre-commit auto-wiring deferred to v0.4 polish. |
| 3 | **Init multi-scope detect** | partial | `init --monorepo` detects `package.json` `workspaces`, expands `<dir>/*`, runs rulebook per sub-project, generates multi-scope Agentfile. pnpm-workspace.yaml / lerna / nx / interactive prompt deferred. |
| 4 | **`status` per-scope** | shipped | Multi-scope projects group fragments and drift entries under each scope. Single-scope output unchanged. |
| 5 | **`/handoff-prepare` slash command** | shipped | Departing agent writes structured markdown to `.anamnesis/handoff/<ISO-ts>.md` capturing goal/done/in-flight/decisions/open questions/next steps. |
| 6 | **SessionStart handoff injection** | shipped | CC uses native SessionStart hook (`inject-handoff.sh`, settings.json auto-registered). Codex/Cursor parity via AGENTS.md "session start: handoff 자동 확인" instruction (base v4). |
| 7 | **Cross-adapter handoff parity** | shipped | Same handoff file format consumed by all three adapters via tool-agnostic AGENTS.md instruction. |

**Moved to v0.4** (low value while user base is small):
- ~~Full version pinning~~ — fragment version cache + `.versions/` storage. Without external user pressure, current "library-current always" is fine.
- ~~`update --bump-pinned`~~ — companion to full pinning. Moves with it.

---

## v0.4 — *shipped 2026-04-29; patches through 0.4.4 on 2026-04-30*

> **Theme: agent continuity at scale + operational polish + project introspection**

Design: [`docs/ONTOLOGY-BOOTSTRAP.md`](ONTOLOGY-BOOTSTRAP.md)

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Hybrid ontology bootstrap** | shipped in 0.4.0; expanded in 0.4.1 | **Layer A** (deterministic CLI introspectors): `anamnesis ontology bootstrap` writes `.anamnesis/ontology/<id>.bootstrap.yaml`. ✓ k8s (namespaces/services/ingresses/workloads). ✓ prisma (datasources/generators/models/enums). 0.4.1 adds ✓ nextjs, ✓ nestjs, ✓ fastapi, plus multi-scope scope-local output and `--scope`. **Layer B** (agent-driven `/ontology-enrich` skill, base v5): shipped via the existing skill pipeline for Claude Code, Codex, and Cursor. **`init` auto-bootstrap**: shipped; `init` runs bootstrap after fragment install (`--no-bootstrap` opt-out). |
| 2 | **Handoff auto-trigger** | shipped in 0.4.2 | Claude Code `Stop` hook reminds agents to run `/handoff-prepare` when uncommitted work is newer than the latest handoff. |
| 3 | **Multi-task handoff tracking** | shipped in 0.4.2 | `/handoff-prepare` writes `.anamnesis/handoff/active.md` plus timestamped archives. Session start injection reads the active index first, then the latest archive. |
| 4 | **`anamnesis doctor`** | shipped in 0.4.2 | Read-only installation integrity check: manifest errors, tracked file/region drift, missing library fragments, update warnings, adapter coverage gaps, and `.claude/settings.json` hook registration drift. |
| 5 | **Full version pinning** | shipped in 0.4.2 | Fragment version cache so `pinned: true` renders the pinned version, not library-current. Library stores past versions under `base/.versions/<version>/` or `fragments/<id>/.versions/<version>/`. |
| 6 | **`anamnesis update --bump-pinned`** | shipped in 0.4.2 | Explicitly bump pinned fragments after manual review while keeping them pinned. Companion to #5. |
| 7 | **Trusted Publishing setup** | shipped; OIDC verified in 1.4.4 | GitHub Actions workflow + documented npm Trusted Publisher config shipped. Early 0.4.x tags exposed an npm OIDC mismatch, so manual npmjs.org publish stayed documented as a fallback. The later `v1.4.4` tag workflow completed and published through Trusted Publishing, so OIDC is now the primary release path. |
| 8 | **Fragment catalog expansion** | shipped in 0.4.2 | Ruby on Rails, Django, Go services, Rust, plus more JS frameworks (SvelteKit, Remix, Nuxt). |
| 9 | **Codex hook auto-wiring** | shipped in 0.4.2 | Git pre-commit bridge for `executable_hook` in the Codex adapter. Codex still gets AGENTS.md fallback instructions; Git repos also get `.anamnesis/codex-hooks/` plus `.git/hooks/pre-commit` when exec adapters are allowed. |
| 10 | **Aider/Windsurf adapters (optional)** | optional | If community demand justifies. Same content+capabilities IR, different render targets. |
| 11 | **`anamnesis status --json`** | shipped in 0.4.2 | Structured output for CI integration. |

**Shipped in 0.4.1 patch:**
- nextjs introspector (App Router + Pages Router routes)
- nestjs introspector (`@Controller` / route method decorators)
- fastapi introspector (`@app.*` + `@router.*`)
- multi-scope bootstrap (per-scope ontology output + `--scope`)

**Shipped in 0.4.2 patch:**
- base v6 handoff continuity (`active.md` + Stop reminder)
- `anamnesis doctor`
- `anamnesis status --json`
- full version pinning + `update --bump-pinned`
- Trusted Publishing workflow + release docs
- Fragment catalog expansion (Rails, Django, Go, Rust, SvelteKit, Remix, Nuxt)
- Codex hook auto-wiring

**Shipped in 0.4.3 patch:**
- npm publish recovery to npmjs.org using local package-owner credentials
- normalized CLI `bin` metadata so npm 11 does not auto-correct the package at publish time
- publish workflow skip guard for versions that already exist on npmjs.org

**Shipped in 0.4.4 patch:**
- tag-triggered Trusted Publishing verification release
- GitHub Actions reached `npm publish`, but npm OIDC exchange/publish still failed with E404 at that time

**Later release automation update:**
- 2026-05-19: `v1.4.4` completed the tag-triggered GitHub Actions
  `Publish` workflow and npmjs.org returned `1.4.4`. Trusted Publishing is
  the primary path again; manual npmjs.org publish remains only an incident
  recovery fallback.

---

## v0.5 — *shipped 2026-04-30*

> **Theme: prove automatic context continuity across real agent switches**

v0.5 is not primarily an introspector expansion release. The next risk is
whether the tool actually fulfills its main promise in day-to-day use:
install once, keep context/ontology current, and switch agents without
manual re-briefing.

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Dogfood lifecycle matrix** | shipped | Ran current anamnesis against sanitized managed fixtures and recorded `init/update/status/doctor/ontology bootstrap/handoff` behavior per repo and adapter. Candidate repos stayed dogfood-driven, not framework-completion driven. |
| 2 | **Agent-switch acceptance fixtures** | shipped | Added tests/fixtures for the same Agentfile rendered to Claude Code, Codex, and Cursor, then asserted that project memory, ontology instructions, handoff startup instructions, and operational guardrails are present in each output. |
| 3 | **Session-start continuity contract** | shipped | Made the "new agent starts here" contract explicit and testable: read managed context, read ontology, read latest/active handoff, detect stale handoff, then continue without the user giving extra instructions. |
| 4 | **Actionable `status`/`doctor` output** | shipped | Improved diagnostics so a user can tell whether context, ontology, handoff, fragments, pinned versions, and adapter render targets are installed and current. |
| 5 | **README/guide alignment** | shipped | Updated user-facing docs around the two product promises: context/ontology injection and agent switching continuity. Avoided presenting framework introspection as the main product. |
| 6 | **Release fallback normalization** | shipped | Kept npmjs.org manual publish fallback documented while OIDC remains unresolved, so release operations do not block lifecycle work. |
| 7 | **Introspector API review, not expansion** | shipped (review-only) | Reviewed the current k8s/prisma/nextjs/nestjs/fastapi introspector interface for accidental coupling. The current contract remains a small registry keyed by fragment id with deterministic `appliesTo` / `introspect` methods; deeper output schema stabilization stays in v0.6. |

Progress:
- 2026-04-30: Added the initial cross-agent continuity acceptance fixture
  for the base fragment.
- 2026-04-30: Enabled Claude Code, Codex, and Cursor outputs on this repo
  itself and recorded the first dogfood self-check in
  [`docs/DOGFOOD.md`](DOGFOOD.md).
- 2026-04-30: Added `anamnesis dogfood check --append` so future version
  bumps can record continuity score/trend automatically.
- 2026-04-30: Added first-class `status` continuity readiness and `doctor`
  continuity warnings for project memory, ontology, handoff startup, adapter
  surfaces, and managed drift.
- 2026-04-30: Added dogfood active-handoff simulation: temporary all-adapter
  project, `active.md` plus archive, Claude Code injection hook output, and
  Codex/Cursor fallback instructions.
- 2026-04-30: Added stale active-handoff diagnostics to `status` / `doctor`
  for missing archive references, active entries that do not point at the
  newest archive, and completed/superseded entries left in open sections.
- 2026-04-30: Ran the first sanitized dogfood matrix across frontend,
  backend, and backend/infra fixture shapes. Fresh frontend and backend/infra
  installs reached continuity `6/6`; an existing managed fixture exposed a
  repair/review gap around user-modified native surfaces.
- 2026-04-30: Added `doctor` repair guidance for user-modified managed files,
  adapter-surface continuity failures, invalid settings, missing hook
  registrations, and stale active handoff state.
- 2026-04-30: Reviewed the current introspector API and kept the v0.5
  decision at "no expansion"; v0.6 owns deeper ontology schema and refresh
  lifecycle work.

Exit criteria met:
- A fresh agent can enter a managed project through each supported adapter
  and find the same current context, ontology, handoff state, and guardrails
  without a bespoke user prompt.
- `status`/`doctor` can identify missing or stale context-continuity pieces.
- The next implementation task is chosen from dogfood evidence, not from
  a framework catalog wishlist.

---

## v0.6 — *shipped 2026-05-03*

> **Theme: make ontology generation repeatable, bounded, and agent-assisted**

v0.6 is not a framework-introspection expansion release. The product risk is
whether anamnesis can keep project ontology current without making the user
hand-write context every time. The CLI should produce the factual base it can
prove, then guide the active agent to enrich that base into durable project
memory that every supported adapter can load.

| # | Item | Description |
|---|---|---|
| 1 | **Generation boundary guidance** | Make CLI output and docs clearly show what anamnesis generated deterministically (`AGENTS.md`, static ontology slices, `.bootstrap.yaml`) and what still needs an agent (`/ontology-enrich`, `/handoff-prepare`, semantic notes). This should appear before deeper ontology work so users do not mistake Layer A facts for complete project understanding. |
| 2 | **Ontology gap reports** | Use dogfood runs to identify which missing context pieces actually make agents less effective. Prioritize missing static slices, missing/stale bootstrap facts, missing enrichment, and adapter-visible guidance before adding broad framework coverage. |
| 3 | **Layer B enrichment lifecycle** | Define how `/ontology-enrich` re-runs should merge, replace, or diff semantic notes so agent-curated ontology can evolve safely. |
| 4 | **Ontology drift in `status`** | Report when project files imply bootstrap facts have changed and `.bootstrap.yaml` should be regenerated. |
| 5 | **Output schema stabilization** | Stabilize enough bootstrap/enriched YAML conventions for agents and docs to rely on them. |
| 6 | **Layer A baseline discipline** | Keep introspectors focused on shallow, deterministic, high-confidence facts. Improve or add one only when dogfood evidence shows the factual base itself is blocking agent continuity; semantic intent and operational meaning stay in Layer B. |
| 7 | **Agent-assisted enrichment UX** | Make the path from `status` / `doctor` / `ontology bootstrap` to `/ontology-enrich` obvious enough that users can get useful enriched ontology without manually authoring YAML. |
| 8 | **Dogfood proof of generated ontology value** | Run the full bootstrap + enrichment lifecycle against at least one sanitized managed fixture and record whether the next agent receives better context than static fragments alone. |

Progress:
- 2026-05-02: Added generation-boundary CLI guidance for `init`,
  `ontology bootstrap`, `status`, and `doctor`, plus README documentation
  explaining CLI-generated vs agent-required outputs.
- 2026-05-02: Added managed `CLAUDE.md` entrypoint generation for
  Claude Code so its native memory surface points at canonical `AGENTS.md`,
  ontology, and handoff state without replacing user prose.
- 2026-05-03: Added ontology gap reporting to `status` / `doctor` so
  installed fragments show whether static ontology, deterministic bootstrap
  facts, semantic enrichment, or Layer A introspector support is missing.
- 2026-05-03: Added base v7 Layer B enrichment lifecycle rules so
  `/ontology-enrich` re-runs merge by stable IDs, append new facts, use
  `supersedes` for replaced designs, and record weak evidence as
  `open_questions`.
- 2026-05-03: Added bootstrap ontology drift detection so `status` compares
  existing `.bootstrap.yaml` files with current deterministic introspector
  output and `doctor` reports stale Layer A facts as repairable warnings.
- 2026-05-03: Stabilized ontology output conventions: `.bootstrap.yaml` now
  renders `schema_version: anamnesis.bootstrap.v1`, deterministic
  `generator`, and wrapped `facts`; `.enriched.yaml` guidance now requires
  `schema_version: anamnesis.enriched.v1`.
- 2026-05-03: Re-centered the remaining v0.6 plan on bounded Layer A
  baselines plus agent-assisted Layer B enrichment. Introspector work remains
  allowed only when a real dogfood gap shows that deterministic facts, not
  semantic enrichment, are the blocker.
- 2026-05-03: Added agent-assisted enrichment UX to diagnostics: missing or
  stale bootstrap guidance now points to the follow-up `/ontology-enrich`
  step, and `ontology bootstrap` prints the `.enriched.yaml` targets an agent
  should create or refresh after Layer A facts are current.
- 2026-05-03: Ran the first v0.6 sanitized ontology before/after dogfood on a
  NestJS/Prisma fixture. Static-only ontology had 2 ontology warnings and no
  bootstrap/enriched files; after bootstrap plus agent enrichment, ontology
  warnings dropped to 0 with deterministic model/controller/route facts and
  semantic Layer B entries captured.
- 2026-05-03: Resolved the first dogfood-proven deterministic Layer A gap by
  adding NestJS `@Sse()` route extraction. A follow-up sanitized fixture
  bootstrap recorded the SSE route fact and increased the deterministic route
  count.

Exit criteria met:
- Users can tell from command output whether the current ontology/context
  state is CLI-generated, agent-enriched, or still missing.
- Agents get materially better project understanding from generated and
  enriched ontology in at least one sanitized managed fixture.
- Layer A output stays deterministic and shallow enough to be trusted as
  facts; Layer B carries relationships, flows, intent, invariants, and weak
  inferences.
- Ontology refresh and enrichment are safe enough to run repeatedly during
  normal project lifecycle work.

---

## v0.7 — *shipped 2026-05-03*

> **Theme: harden multi-agent UX and lifecycle scale**

| # | Item | Description |
|---|---|---|
| 1 | **Adapter parity matrix** | Publish and test a matrix for each capability (`project_memory`, `ontology`, `executable_hook`, `skill`, `slash_command`) across Claude Code, Codex, Cursor, and any new supported adapter. |
| 2 | **Switching-agent scenarios** | Exercise the full ordered 3x3 handoff matrix across Claude Code, Codex, and Cursor, including same-agent restarts, with active handoff files and stale-handoff detection. |
| 3 | **Native-surface improvements** | Where a tool offers a better native surface, use it; where it does not, keep fallback instructions explicit and testable. |
| 4 | **Lifecycle hardening** | Reduce surprises around pinned fragments, user-modified regions, backups, declined suggestions, and multi-scope updates as projects evolve. |
| 5 | **Public UX docs** | Document the expected user journey for "install once, switch agents, continue work" with limitations per adapter. |
| 6 | **Ontology refresh workflow hardening** | Turn the v0.6 bootstrap/enrichment path into a reliable lifecycle workflow: detect stale facts, prompt or route agent enrichment, preserve reviewed semantics, and keep all adapter entrypoints pointing at the same context. |
| 7 | **Benchmark/report command** | Add a repeatable benchmark surface that measures static-only vs bootstrap vs enriched context on sanitized snapshots. Candidate metrics: context recall score, question reduction, time-to-first-correct-action, handoff continuity, ontology coverage, and diagnostic quality. Output should be suitable for `docs/BENCHMARKS.md` and a compact README evidence section. |

Progress:
- 2026-05-03: Started the v0.7 adapter parity work with a canonical
  test-backed matrix in `cli/src/adapters/parity.ts` and
  `docs/ADAPTER-PARITY.md`. The matrix documents native vs fallback surfaces
  for all current capabilities across Claude Code, Codex, and Cursor.
- 2026-05-03: Expanded switching-agent scenarios to the full ordered 3x3
  matrix: Claude Code, Codex, and Cursor as both source and target agents,
  including same-agent restarts. `cli/src/adapters/switching.test.ts` now
  verifies prepare surfaces, resume surfaces, current active handoff state,
  and stale active handoff diagnostics for every pair.
- 2026-05-03: Added first-install adapter selection with
  `anamnesis init --tools <list|all>`, so projects can create Claude Code,
  Codex, and Cursor surfaces during initial setup instead of manually editing
  `Agentfile.tools` before the first `update`.
- 2026-05-03: Added the first `anamnesis benchmark report` surface for
  deterministic context-quality reporting across static ontology, Layer A
  bootstrap facts, Layer B enrichment, continuity readiness, and adapter
  surfaces. Reports append to `docs/BENCHMARKS.md`.
- 2026-05-03: Hardened backup lifecycle behavior by enforcing
  `settings.backup_retention` during `update --apply`; old
  `.anamnesis/backups/*` directories are pruned only after a new backup is
  created, and `0` keeps backups unlimited.
- 2026-05-03: Hardened declined-suggestion lifecycle reporting. `status`
  now labels declined entries as active or stale, and `doctor` warns when an
  Agentfile declined entry no longer corresponds to a current rulebook match.
- 2026-05-03: Added `docs/AGENT-SWITCHING-GUIDE.md` as the public UX guide
  for the "install once, switch agents, continue work" flow. The guide links
  install-time adapter selection, ontology refresh, `/handoff-prepare`, target
  agent resume behavior, verification commands, and known native-vs-fallback
  limitations.
- 2026-05-03: Recorded the first v0.7 sanitized benchmark comparison in
  `docs/BENCHMARKS.md`. The existing Claude Code-only managed baseline scored
  ready layers `1/5`; the same sanitized fixture after all-adapter install,
  Layer A bootstrap, and Layer B enrichment scored `5/5` with continuity
  `6/6` and zero ontology warnings.
- 2026-05-03: Polished cross-repo benchmark collection UX so
  `benchmark report --append --output <absolute-path>` prints the absolute
  output path when the report is written outside the benchmarked project.

Exit criteria:
- Switching agents preserves project memory, ontology access, handoff
  continuity, and operational reminders in normal workflows.
- Known adapter gaps are documented as tool-surface limitations, not hidden behavior.
- At least one benchmark report compares before/after context quality on a
  sanitized fixture without requiring proprietary or credential-bearing source
  snippets in public docs.

---

## v0.8 — *shipped 2026-05-04*

> **Theme: stabilize schema, API, and migration contracts**

v0.8 should reduce the risk of freezing the wrong surface in v1.0. The
priority is not new adapter breadth; it is making the existing lifecycle safe
to depend on.

| # | Item | Description |
|---|---|---|
| 1 | **Agentfile schema audit** | Review `Agentfile` v1 fields, defaults, scope inheritance, `settings`, `declined`, and pinned fragment semantics. Decide what can be frozen as-is and what needs a pre-1.0 adjustment. |
| 2 | **Schema fixture suite** | Add explicit compatibility fixtures for real single-scope, multi-scope, pinned, declined, and all-adapter Agentfiles so future changes can prove backward compatibility. |
| 3 | **Migration command design** | Designed in `docs/AGENTFILE-MIGRATIONS.md`; CLI skeleton shipped with dry-run/apply/backup/idempotency behavior and no built-in schema transforms yet. |
| 4 | **Stable TypeScript API boundary** | Public import boundary added at `@mcprotein/anamnesis` for Agentfile utilities only; unsupported deep imports are blocked by package `exports`. |
| 5 | **Existing-project repair workflow** | `docs/REPAIR.md` now covers user-modified managed files, missing hook registrations, partial adapter installs, stale Agentfile versions, stale handoff state, and ontology gaps. |
| 6 | **Published package smoke gate** | Recurring post-publish gate documented in `docs/RELEASING.md`: force npmjs.org, verify package version/CLI, run a fresh fixture through `npm exec @mcprotein/anamnesis@<version>`, and record sanitized smoke when release claims depend on it. |

Exit criteria met:
- We can say which parts of `Agentfile` are v1-stable candidates.
- Backward-compatibility fixtures exist for the project shapes we already dogfood.
- Release validation includes source checks and published-package smoke checks.
- Any remaining schema/API uncertainty is explicitly assigned to v0.9 or v1.0.

Progress:
- 2026-05-04: Started the Agentfile schema audit in
  `docs/deprecated/AGENTFILE-SCHEMA-AUDIT.md` and added compatibility fixtures for
  historical Claude Code-only, current all-adapter single-scope, and
  multi-scope pinned Agentfiles in `cli/src/core/agentfile.compat.test.ts`.
- 2026-05-04: Updated `specs/agentfile.md` to distinguish parser-level hard
  errors from library/project-aware diagnostics owned by `status`, `doctor`,
  `init`, and `update`.
- 2026-05-04: Implemented `fragment.adapters` as a render gate for existing
  projects. `update` skips disabled adapters for root fragments and scope
  `fragments_add`; `doctor` uses the same gate for renderer and hook-setting
  diagnostics. Existing managed-file cleanup remains assigned to the v0.8
  repair/migration workflow.
- 2026-05-04: Added `docs/AGENTFILE-MIGRATIONS.md` with the dry-run-first
  command contract, backup/idempotency rules, preservation rules, and test
  requirements for future `anamnesis migrate agentfile` implementation.
- 2026-05-04: Added the `anamnesis migrate agentfile` skeleton with dry-run
  default, `--apply`, `--json`, backup-on-write, and idempotency tests via an
  injected fixture migration. Built-in schema transforms remain pending until
  the remaining v0.8 field decisions are made.
- 2026-05-04: Clarified remaining Agentfile field semantics:
  `overrides.*.locked` are ownership hints, not hard update locks;
  `settings.commit_on_apply` is future-reserved / a deprecated candidate; and
  `declined_at` remains a string for historical compatibility.
- 2026-05-04: Added `docs/API.md`, `cli/src/api.ts`, and package `exports` so
  the only supported TypeScript import surface is `@mcprotein/anamnesis`
  Agentfile utilities. Command internals remain CLI-only.
- 2026-05-04: Added `docs/REPAIR.md` as the existing-project repair playbook
  for user-modified managed surfaces, hook registration drift, partial adapter
  installs, pinned updates, stale handoff state, and ontology gaps.
- 2026-05-04: Added the recurring post-publish smoke gate to
  `docs/RELEASING.md`, covering forced npmjs.org checks and fresh-fixture
  `npm exec @mcprotein/anamnesis@<version>` validation.

---

## v0.9 — *shipped 2026-05-04*

> **Theme: public ecosystem readiness**

v0.9 should prepare the project for users and fragment authors beyond the
current local-library workflow.

| # | Item | Description |
|---|---|---|
| 1 | **Fragment registry design** | Specify registry metadata, discovery, version selection, and trust boundaries before building a hosted registry. |
| 2 | **Fragment signing & checksums design** | Define how fragment archives are signed, verified, cached, and rejected. Include migration behavior for unsigned local fragments. |
| 3 | **Fragment authoring docs** | Turn current internal fragment conventions into public author guidance with examples, review checklist, and compatibility rules. |
| 4 | **Official docs site plan** | Decide whether docs remain GitHub-first or move to a docs site. Include installation, adapter parity, ontology lifecycle, handoff, monorepo, release, and fragment authoring pages. |
| 5 | **Public benchmark gallery** | Collect sanitized before/after reports across multiple public repo shapes and surface headline evidence in README/docs. |
| 6 | **Remote sync strategy** | Decide whether `anamnesis sync` belongs before v1.0 or should wait until a registry exists. |

Exit criteria met:
- Registry and signing are specified deeply enough to implement without
  changing the frozen Agentfile surface.
- Public docs cover both users and fragment authors.
- Benchmark evidence includes more than one repo shape.

Progress:
- 2026-05-04: Added `docs/FRAGMENT-REGISTRY.md` as the v0.9 registry design
  draft. The design keeps current local-library and Agentfile flows intact,
  treats registry discovery as passive, requires archive checksums before use,
  defers signature policy to the next v0.9 item, and calls out Agentfile
  source metadata as an explicit pre-v1.0 decision.
- 2026-05-04: Added `docs/FRAGMENT-SIGNING.md` as the v0.9 signing/checksum
  design draft. Remote archives require checksum verification and signed
  release manifests for default install/update, unsigned local and bundled
  fragments stay valid, unsigned remote executable adapters are rejected, and
  optional Agentfile source metadata remains migration-owned before v1.0.
- 2026-05-04: Added `docs/FRAGMENT-AUTHORING.md` as the public fragment
  authoring guide. It documents capability schemas, rulebook ownership,
  executable-hook safety, Layer A vs Layer B boundaries, versioning,
  verification, review checklist, and compatibility rules for future public
  fragments.
- 2026-05-04: Added `docs/deprecated/DOCS-SITE-PLAN.md` as the v0.9 docs-site
  decision. Documentation stays GitHub-first through v1.0; the plan defines
  user/audience entry points, future site navigation, site trigger criteria,
  and maintenance rules so a generated site can mirror repo markdown later
  without creating a second source of truth.
- 2026-05-04: Added `docs/BENCHMARK-GALLERY.md` as the public-safe benchmark
  evidence surface. It separates allowed README claims from unsupported
  claims, summarizes the current sanitized backend and self-dogfood evidence,
  and records the additional frontend, infra/backend, and Python API shapes
  needed before broad public benchmark claims.
- 2026-05-04: Added `docs/REMOTE-SYNC-STRATEGY.md` as the v0.9 remote sync
  decision. A top-level `anamnesis sync` command is deferred until after
  v1.0-safe registry primitives exist; registry refresh, fragment discovery,
  and project update/apply remain explicit operations, and remote upload of
  handoff or ontology state is out of scope.

---

## v1.0 — *shipped 2026-05-04*

> **Theme: lock the surface, open to community**

| # | Item | Description |
|---|---|---|
| 1 | **Frozen Agentfile schema** | No more breaking changes after this. Strict semver from v1.0 forward. |
| 2 | **Migration tooling available** | `anamnesis migrate` supports any pre-1.0 schema adjustments that must survive the freeze. |
| 3 | **Stable public TypeScript API** | Documented import targets are semver-stable; internal modules remain private. |
| 4 | **Registry/signing MVP decision** | Either ship a minimal registry/signing path or explicitly keep registry support post-1.0 without weakening local-library safety. |
| 5 | **Public documentation complete** | Install, lifecycle, adapter parity, ontology generation, handoff, monorepo, release, fragment authoring, and troubleshooting docs are coherent. |
| 6 | **Evidence-backed README claims** | Public claims about continuity and ontology quality point to dogfood, switching fixtures, and benchmark reports. |

Exit criteria:
- `npm install -g @mcprotein/anamnesis` plus the documented quickstart works
  from the published package.
- Existing v0.7/v0.8/v0.9 managed projects can upgrade without losing user edits.
- The schema/API surfaces marked stable have explicit tests and docs.
- Known limitations are documented as limitations, not hidden behavior.

Progress:
- 2026-05-04: Froze the Agentfile v1 schema in
  `docs/AGENTFILE-V1-FREEZE.md` and tightened the parser so unknown fields are
  rejected instead of silently stripped. `settings.commit_on_apply` remains a
  reserved no-op, `overrides.*.locked` remains an ownership hint,
  `fragments[].source` and generic `sync` stay out of v1, and no built-in
  Agentfile migration is required for the freeze.
- 2026-05-04: Closed the v1.0 migration-tooling availability surface. The
  existing `anamnesis migrate agentfile` pipeline remains dry-run first,
  backs up before writes, has no built-in transforms because the v1 freeze
  requires none, preserves current no-op formatting/comment content, and now
  reports the next recommended command in both human and JSON output.
- 2026-05-04: Closed the v1.0 public TypeScript API boundary by documenting
  the semver-governed stability contract in `docs/API.md`, keeping command
  result shapes internal, and adding an exports-map test so only
  `@mcprotein/anamnesis` plus `@mcprotein/anamnesis/package.json` are public
  package imports.
- 2026-05-04: Closed the registry/signing MVP decision in
  `docs/REGISTRY-V1-DECISION.md`: remote registry installation, cache,
  checksum, signature verification, trust store, Agentfile source metadata,
  and unsigned remote escape hatches are post-v1.0; v1.0 keeps built-in and
  local-library fragments as the only installable sources.
- 2026-05-04: Closed the public documentation completeness item with
  `docs/deprecated/DOCS-V1-AUDIT.md`, mapping install, lifecycle, adapter parity,
  ontology generation, handoff, monorepo, release, fragment authoring,
  troubleshooting, schema/API/migration, registry/sync scope, and evidence
  docs to canonical repo entry points plus known v1.0 limitations.
- 2026-05-04: Closed evidence-backed README claims with
  `docs/README-CLAIMS.md`, mapping current README claims to dogfood records,
  switching fixtures, tests, benchmark reports, and explicit disallowed
  wording for unsupported ecosystem, native-UX, automatic-ontology, registry,
  signing, and no-review claims.
- 2026-05-04: Verified the pre-v1 upgrade exit criterion and recorded it in
  `docs/DOGFOOD.md`: fresh fixtures initialized with published `0.7.0`,
  `0.8.0`, and `0.9.0` all updated with the current candidate while preserving
  user-authored `AGENTS.md` sentinel prose, retaining continuity `ready (6/6)`,
  and reporting doctor `0 error(s)`.
- 2026-05-04: Published `@mcprotein/anamnesis@1.0.0` from the tag-triggered
  workflow and completed npmjs.org post-publish smoke: version lookup returned
  `1.0.0`, published CLI execution returned `1.0.0`, and a fresh Prisma
  fixture reached continuity `ready (6/6)` with doctor `0 error(s)`.

---

## v1.1 — *shipped 2026-05-07*

> **Theme: remove avoidable fallback-only gaps after the v1 surface freeze**

External review input, 2026-05-04:
- [`openai/codex`](https://github.com/openai/codex) now exposes a broader
  native lifecycle surface than the SessionStart-only path anamnesis first
  targeted. The official Codex docs describe config-layer hook discovery,
  project/user `.codex/hooks.json`, inline `[hooks]`, plugin lifecycle
  config, and current hook events including `SessionStart`,
  `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, and
  `Stop`.
- [`Yeachan-Heo/oh-my-codex`](https://github.com/Yeachan-Heo/oh-my-codex)
  is useful prior art for separating native Codex hooks, runtime/plugin hook
  dispatch, derived fallback signals, persistent state, logs, and team-safety
  behavior. anamnesis should learn from those boundaries without becoming
  dependent on OMX or turning into a runtime orchestrator.

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Codex native SessionStart continuity** | shipped | Add a Codex native SessionStart wrapper for the base ontology + handoff continuity path. `--allow-exec-adapters` installs `.anamnesis/codex-native-hooks/session-start.mjs`, enables `.codex/config.toml` `[features].hooks = true`, and merges `.codex/hooks.json` while preserving user hook entries. AGENTS.md fallback instructions remain for environments without native hook installation. |
| 2 | **Codex native hook surface refresh** | shipped | Refreshed the Codex adapter against the current official hook vocabulary instead of treating Codex as SessionStart-only. `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, and `Stop` are modeled as event-aware render targets with explicit fallback notes for unsupported or version-gated behavior. |
| 3 | **Prompt-time and stop-time continuity** | stop-time implemented; prompt-time deferred | Codex `Stop` now handles the same dirty-work / handoff reminder role Claude Code already gets. `UserPromptSubmit` transport is supported and smoke-proven, but compact prompt-time context delta injection is deferred until a real dogfood gap justifies budget policy, dedupe rules, and noise controls. |
| 4 | **Native executable-hook bridge for Codex** | shipped | Where Codex `PreToolUse`, `PermissionRequest`, and `PostToolUse` support useful matchers (`Bash`, `apply_patch`/`Edit`/`Write`, MCP tool names), safe fragment hooks render natively before falling back to AGENTS.md instructions or the Git pre-commit bridge. `Stop` and `UserPromptSubmit` also use matcherless native wrappers when installed. Supply-chain gating stays under `--allow-exec-adapters`. |
| 5 | **Shared Codex hook ownership diagnostics** | shipped | Teach `status` / `doctor` to explain active Codex hook sources and ownership: user config, project config, anamnesis-managed entries, OMX-managed entries, plugin-provided lifecycle config, duplicate handlers, relative-path fragility, and project-trust gating. Preserve unrelated hook entries during every update. |
| 6 | **Real native-hook smoke tests** | shipped | Add reproducible smoke tests that prove native Codex hook behavior, not just rendered files. Dogfood now separates synthetic Codex JSON dispatch from opt-in real Codex CLI execution, proves both isolated `CODEX_HOME/hooks.json` and trusted project-local `.codex/hooks.json` SessionStart discovery, proves real `UserPromptSubmit` additional-context output before model transport completes, and proves authenticated Bash tool-turn `PreToolUse`/`PostToolUse` execution through the CLI. |
| 7 | **Codex plugin packaging research** | researched; implementation deferred | [`docs/CODEX-PLUGIN-PACKAGING.md`](CODEX-PLUGIN-PACKAGING.md) records the v1.1 decision: do not emit a Codex plugin by default yet. Keep required runtime hooks in config-layer `.codex/hooks.json`; treat future plugin output as optional packaging for skills, examples, or MCP/app metadata until plugin-local hook execution and trust semantics are verified in real Codex. |
| 8 | **Runtime inspiration from OMX, not dependency** | v1.1 slice implemented; expansion deferred | Added a small anamnesis-owned runtime evidence layer inspired by OMX `.omx/` state/log patterns; see [`docs/RUNTIME-EVIDENCE.md`](RUNTIME-EVIDENCE.md). `dogfood check --append` and `benchmark report --append` now write machine-readable records to `.anamnesis/evidence/events.jsonl`, and `status` reports the latest record. Later scope: hook-log events, install/update/doctor evidence, benchmark trace rollups, and public README evidence surfacing. Do not add task orchestration, HUD, team runtime, or OMX as a dependency. |

Progress:
- 2026-05-05: Started the Codex hook surface refresh by adding native
  lifecycle shell-hook wrappers for Codex-supported events. The renderer now
  treats `PostToolUse:Edit` as `PostToolUse` with
  `Edit|Write|apply_patch`, supports matcherless `Stop` wrappers, and keeps
  AGENTS.md plus git pre-commit fallbacks. Base v10 uses this path for Codex
  dirty-work reminders and stop-time handoff reminders.
- 2026-05-07: Added shared Codex hook ownership diagnostics. `status` now
  reports `.codex/hooks.json` ownership counts for anamnesis, OMX, plugin,
  user, and invalid entries; `doctor` warns on duplicate commands, malformed
  hook entries, and stale relative anamnesis-managed hook commands.
- 2026-05-07: Added Codex native-hook dogfood evidence. The default
  self-check runs synthetic Codex JSON dispatch against generated
  SessionStart, PostToolUse, and Stop wrappers; the opt-in
  `ANAMNESIS_REAL_CODEX_SMOKE=1` path proved the Codex CLI invokes a
  SessionStart hook from isolated `CODEX_HOME/hooks.json` before the expected
  isolated auth failure.
- 2026-05-07: Extended the opt-in real Codex smoke to a trusted project-local
  `.codex/hooks.json` fixture. `ANAMNESIS_REAL_CODEX_SMOKE=1 npm run dogfood`
  now records both real SessionStart paths: isolated `CODEX_HOME/hooks.json`
  and project-local `.codex/hooks.json` discovered through `codex exec -C`.
- 2026-05-19: Tightened stop-time continuity UX. The Stop handoff reminder is
  now deduped by dirty git fingerprint, so repeated agent Stop invocations do
  not keep blocking on the same unchanged worktree state while still warning
  again after the git changes differ.
- 2026-05-19: Published `@mcprotein/anamnesis@1.4.4` from the tag-triggered
  GitHub Actions `Publish` workflow. npmjs.org returned `1.4.4`, and a
  published-package smoke verified fresh init/status/doctor plus Stop hook
  first-run/second-run dedupe behavior.
- 2026-05-07: Added real `UserPromptSubmit` smoke coverage. The opt-in real
  dogfood path now verifies Codex invokes `UserPromptSubmit` before model
  transport completes and accepts the `hookSpecificOutput.additionalContext`
  output shape.
- 2026-05-07: Added authenticated Codex tool-turn smoke coverage. When
  `ANAMNESIS_REAL_CODEX_TOOL_SMOKE=1` is set, dogfood asks Codex to run a
  safe Bash `printf` command inside an isolated temp project and verifies both
  `PreToolUse` and `PostToolUse` hook payloads are emitted for `tool: Bash`.
- 2026-05-07: Started the anamnesis-owned runtime evidence layer. Dogfood
  and benchmark append runs now write versioned JSONL records under
  `.anamnesis/evidence/events.jsonl`, and `status` reports total/invalid
  evidence counts plus the latest record kind and timestamp.
- 2026-05-07: Closed Codex plugin packaging research for v1.1 with
  [`docs/CODEX-PLUGIN-PACKAGING.md`](CODEX-PLUGIN-PACKAGING.md). The current
  decision is to keep required continuity hooks in config-layer
  `.codex/hooks.json` and reserve optional plugin packaging for skills,
  examples, and integration metadata until plugin-local lifecycle hooks have
  real Codex CLI smoke evidence.
- 2026-05-07: Locked the v1.1 Codex hook surface as a release candidate.
  Renderer tests now cover event-aware native wrapper registration for
  `PreToolUse`, `PermissionRequest`, and `UserPromptSubmit`, in addition to
  the existing `SessionStart`, `PostToolUse`, and `Stop` coverage. Prompt-time
  delta injection and broader runtime evidence collection are explicitly
  deferred beyond the v1.1 release cut.
- 2026-05-07: Post-publish smoke for `@mcprotein/anamnesis@1.1.0` caught
  hard-coded CLI / ontology-generator version metadata. The v1.1 patch line
  now reads package metadata from `package.json`, adds regression coverage,
  and treats published CLI version mismatches as release blockers.
- 2026-05-07: Published `@mcprotein/anamnesis@1.1.1` as the v1.1 patch.
  npmjs.org version lookup returned `1.1.1`, published CLI execution from
  a fresh temp directory returned `1.1.1`, and a fresh Prisma fixture initialized
  with `--tools all --allow-exec-adapters` reached continuity `ready (6/6)`,
  Codex hook warnings `0`, and doctor `0 error(s)` with only the expected
  agent-required `.enriched.yaml` warning.

Exit criteria:
- Fresh `--tools codex --allow-exec-adapters` install gets automatic
  ontology and handoff context at Codex SessionStart.
- `status` / `doctor` report the Codex native hook wrapper, feature flag,
  hook registrations, and shared hook ownership as part of adapter continuity.
- Existing user `.codex/hooks.json` entries are preserved and stale
  anamnesis-managed wrapper entries are deduped on update.
- `docs/ADAPTER-PARITY.md` and switching fixtures distinguish Codex native
  hook parity, fallback parity, and version-gated gaps for every supported
  capability.
- Real Codex native-hook smokes prove each newly claimed native path before
  README or benchmark claims mention it. Synthetic dispatch evidence is
  recorded separately from real CLI execution evidence.
- Markdown dogfood and benchmark reports have a machine-readable evidence
  counterpart that future status, benchmark gallery, and README-claims
  surfaces can consume without scraping prose.
- Codex plugin packaging has a documented boundary: optional UX packaging may
  follow later, but no core continuity promise depends on plugin install state
  or unverified plugin-local hooks.
- OMX remains compatible as a co-installed runtime, but anamnesis does not
  require OMX to provide its context/ontology/handoff continuity promise.

---

## v1.2 — shipped 2026-05-08

> **Theme: numeric evidence for context quality and agent-switch continuity**

Benchmarking is useful here only when the metric is honest about what it
measures. anamnesis can measure deterministic context surfaces numerically:
ready layers, continuity checks, ontology gap counts, adapter/hook diagnostics,
doctor errors, evidence freshness, and before/after deltas on the same repo
snapshot. It should not pretend those are raw model-intelligence scores.
Model-dependent outcomes such as "time to first correct action" need a
separate controlled task harness with repeated runs, fixed prompts, and clear
limitations.

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Benchmark scorecard v2** | shipped | Extend `anamnesis benchmark report` with a stable numeric scorecard that keeps raw dimensions visible: ready layers `/5`, continuity `/6`, ontology warning/error counts, doctor error/warning counts, Codex hook warning counts, adapter parity, and evidence freshness. Composite scores are allowed only as a convenience summary, not as the source of truth. |
| 2 | **Before/after adoption harness** | shipped | Add a repeatable workflow for sanitized snapshots: baseline report -> install/update/bootstrap/enrich -> follow-up report -> delta summary. Report the numeric movement for ready layers, continuity, ontology gaps, doctor issues, adapter surfaces, generated files, and evidence records. |
| 3 | **Agent-effectiveness task benchmark** | shipped | Introduce an optional, explicitly model-dependent harness for controlled tasks. Candidate metrics: prompts/questions needed before work starts, tool turns to locate key context, first-correct-action success, handoff recovery success, and elapsed time. Store this separately from deterministic `benchmark-report` evidence so README claims do not confuse product surfaces with model capability. |
| 4 | **Evidence gallery automation** | shipped | Generate or validate `docs/BENCHMARK-GALLERY.md` and README claim candidates from `.anamnesis/evidence/events.jsonl` plus sanitized benchmark artifacts. Claims without matching evidence should be flagged before release. |
| 5 | **Public-safe multi-shape collection** | shipped | Collect at least three public-safe benchmark shapes: a frontend app, a backend plus infra repo, and a Python/API repo. Each entry must include fragment set, raw score dimensions, before/after or fresh-install state, and limitations. |
| 6 | **Prompt-time context delta decision gate** | shipped | Revisit Codex `UserPromptSubmit` context delta injection only through `anamnesis benchmark prompt-gate`. The gate reads benchmark/task evidence, estimates duplicate ontology/handoff prompt overhead, reports duplicate-context risk, and keeps injection disabled unless repeated continuity failures justify a bounded non-default prototype. |
| 7 | **Runtime evidence expansion** | shipped | Expand runtime evidence beyond dogfood and benchmark append runs. `anamnesis doctor --append` records install integrity diagnostics as `doctor-check`, `anamnesis hooks summary --append` records hook runtime summaries as `hook-log-summary`, `anamnesis init` records first-install evidence as `init-install`, `anamnesis update --apply` records write-path evidence as `update-apply`, `anamnesis benchmark trace --append` records trace rollups as `benchmark-trace-rollup`, and `status` reports per-kind evidence counts/freshness. |

Progress:
- 2026-05-07: Implemented benchmark scorecard v2 for
  `anamnesis benchmark report`. The report now exposes raw numeric dimensions
  through `scorecard` in JSON/evidence output, a markdown scorecard table, and
  concise CLI lines for continuity, doctor health, Codex hook warnings, and
  evidence record counts.
- 2026-05-07: Implemented `anamnesis benchmark compare` for before/after
  adoption evidence. It reads two `benchmark report --json` snapshots, reports
  raw scorecard deltas, and can append markdown plus `benchmark-compare`
  runtime evidence.
- 2026-05-07: Implemented `anamnesis benchmark gallery --write|--validate`.
  The command refreshes a generated evidence region in
  `docs/BENCHMARK-GALLERY.md`, derives README claim candidates from runtime
  evidence, and fails validation when the generated region is stale.
- 2026-05-07: Added public-safe multi-shape benchmark evidence for a fresh
  Next.js frontend, a fresh NestJS/Kubernetes backend, an existing Python/uv
  repo, and two before/after comparisons. The generated gallery now reports
  12 valid evidence records, 7 entries, 5 claim candidates, and no release
  warnings while still marking weak/regressed shapes as non-claim evidence.
- 2026-05-07: Implemented `anamnesis benchmark task --template|--input`.
  The command validates controlled task-run JSON, reports model-dependent
  metrics such as questions before action and tool turns to context, appends
  to `docs/AGENT-TASK-BENCHMARKS.md`, and writes separate
  `agent-task-benchmark` evidence that the deterministic gallery ignores.
- 2026-05-07: Implemented `anamnesis benchmark prompt-gate`. The command
  turns prompt-time context delta into an evidence gate instead of a default
  hook behavior: it consumes deterministic and model-dependent evidence,
  estimates duplicated ontology/handoff token overhead, reports duplicate
  context risk, and records `prompt-delta-gate` evidence when appended.
- 2026-05-07: Added `anamnesis doctor --append` as the first v1.2 runtime
  evidence expansion beyond dogfood/benchmark checks. Doctor append writes
  `docs/DOCTOR.md` snapshots plus `doctor-check` JSONL evidence with
  install-integrity issue summaries.
- 2026-05-07: Expanded `anamnesis status` runtime evidence output from a
  single latest record to a kind-level freshness rollup with per-kind counts,
  latest timestamps, age, and stale flags for both CLI and JSON consumers.
- 2026-05-07: Added automatic `update-apply` runtime evidence for
  `anamnesis update --apply`. Dry-runs remain side-effect free, while apply
  records summarize planned change counts, backup/prune counts,
  Claude/Codex hook registration outcomes, suggested fragments, and apply
  flags.
- 2026-05-08: Added automatic `init-install` runtime evidence for
  `anamnesis init`. `init --dry-run` remains side-effect free, while first
  install records summarize selected fragments, installed tools, planned
  change counts, monorepo detection, post-install bootstrap outcomes,
  Claude/Codex hook registration outcomes, and install flags.
- 2026-05-08: Added `anamnesis hooks summary --append` for hook-log
  summaries. It reads `.anamnesis/logs/hooks.jsonl`, reports valid/invalid
  hook runtime records by event and status, appends `docs/HOOKS.md`, and
  records `hook-log-summary` runtime evidence.
- 2026-05-08: Added `anamnesis benchmark trace --append` for benchmark trace
  rollups. It reads `.anamnesis/logs/benchmark-traces.jsonl`, aggregates
  trace records by phase/status plus numeric metrics, appends
  `docs/BENCHMARK-TRACES.md`, and records `benchmark-trace-rollup` runtime
  evidence.
- 2026-05-08: Published `@mcprotein/anamnesis@1.2.0` from the tag-triggered
  workflow. npmjs.org `latest` returned `1.2.0`, published CLI execution
  from a fresh temp directory returned `1.2.0`, and a fresh Prisma fixture initialized
  with continuity `ready (6/6)`, `init-install` evidence, and the expected
  Layer B enrichment follow-up.
- 2026-05-08: Published `@mcprotein/anamnesis@1.2.1` as a package-facing
  README patch after the `1.2.0` tarball still showed the old status badges.
  npmjs.org `latest` returned `1.2.1`, the package README showed
  `500 passing` and `v1.2 stable`, published CLI execution returned `1.2.1`,
  and the fresh Prisma fixture smoke remained continuity `ready (6/6)`.

Exit criteria:
- `anamnesis benchmark report` exposes stable numeric raw dimensions and a
  clear scorecard schema that can be compared over time.
- At least one before/after adoption benchmark and at least three public-safe
  repo shapes are represented in the benchmark gallery.
- Any README benchmark claim points to raw evidence and states limitations.
- Model-dependent task metrics are separated from deterministic context-quality
  metrics in both schema and documentation.
- Prompt-time context injection is either justified by benchmark evidence and
  bounded by token/noise rules, or explicitly kept deferred.
- Runtime evidence records are usable by `status`, benchmark gallery, and
  README-claims workflows without markdown scraping.

---

## v1.3 — *shipped 2026-05-08*

> **Theme: fragment lifecycle intelligence**

v1.3 should make installed fragments behave less like manually curated
snippets and more like a small dependency graph with observable update
signals. The scope stays narrow: resolve fragment dependencies and version
constraints before rendering, then expose local update events that future
automation can consume. This is still configuration lifecycle management, not
project scaffolding or a hosted control plane.

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Fragment dependency resolution** | done | Replace the current `requires` behavior from simple topological ordering with explicit dependency resolution. A selected fragment should be able to require another fragment id plus a minimum integer version. `init`, `update`, `status`, and `doctor` should report missing dependencies, unsatisfied minimum versions, pinned fragments that block a requirement, and dependency cycles before rendering managed files. |
| 2 | **Fragment update event hooks** | done | Add a local update notification surface for fragment lifecycle changes. Start with deterministic event records for installed, updated, pinned-blocked, yanked/invalid, and dependency-blocked fragments; keep external webhook delivery optional and disabled until the local event schema and trust boundary are stable. |

Progress:
- 2026-05-08: Promoted `Fragment dependency resolution` and fragment update
  notifications from cross-cutting backlog to the v1.3 planned scope. Deferred
  project templates and WebUI work so v1.3 stays focused on fragment lifecycle
  correctness and observable update signals.
- 2026-05-08: Implemented dependency parsing for `requires: [id]` and
  `requires: [{ id, min_version }]`, auto-inclusion in `init`/`update`, and
  dependency diagnostics in `status`/`doctor`.
- 2026-05-08: Added local `fragment-lifecycle` evidence records for
  first-install and update/apply fragment events. External webhook delivery
  remains intentionally absent until there is an opt-in delivery smoke.
- 2026-05-08: Published `@mcprotein/anamnesis@1.3.0` from the tag-triggered
  workflow. npmjs.org `@mcprotein/anamnesis@1.3.0` returned `1.3.0`,
  published CLI execution from a fresh temp directory returned `1.3.0`, and a fresh
  Prisma fixture reached continuity `ready (6/6)` with both `init-install`
  and `fragment-lifecycle` evidence records plus the expected Layer B
  enrichment follow-up.

Exit criteria:
- Fragment dependency requirements are parsed from fragment metadata without
  changing existing Agentfile v1 installed-fragment entries.
- `init` and `update` can auto-include or clearly report required dependency
  fragments before rendering.
- `status` and `doctor` explain missing, incompatible, pinned-blocked, and
  cyclic fragment dependencies with actionable next steps.
- Update/apply flows write local machine-readable fragment lifecycle events
  without sending data to any external service by default.
- README and release claims do not mention external webhook delivery unless a
  real opt-in delivery smoke exists.

---

## v1.4 — *shipped 2026-05-11*

> **Theme: adoption automation and project context bootstrap**

v1.4 should reduce the manual work needed when anamnesis is first applied to
an existing project. The product target is not more public proof; it is better
first-run UX: install the cross-agent surfaces, preserve pre-existing local
agent affordances safely, and create a useful project context draft even when
no framework-specific fragment exists.

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Generic project context bootstrap** | shipped | During `init`, create a conservative `system_graph.yaml` draft when one does not already exist. Use safe local signals such as `package.json`, README/CLAUDE/docs headings, common source directories, and dependency names when available. If no safe signals exist yet, still create a zero-context draft with safety invariants and open questions rather than inventing facts or leaving the next agent with no project-level ontology file. Do not read or emit secret values from env files, Terraform state, tfvars, PEM keys, logs, or credentials. |
| 2 | **Existing surface conflict handling** | shipped | When a pre-existing project-specific `.claude/skills/load-context` blocks the managed base surface, preserve it under a project-specific name and install the standard anamnesis `load-context` surface so first-run continuity can reach `6/6` without manual rename work. Keep the behavior conservative and visible in CLI output/evidence. |
| 3 | **Adoption UX report** | shipped | Make `init` output explain which context was generated, which local surfaces were preserved, and which follow-ups remain agent-required. The report should answer "what did this just do?" without forcing users to inspect manifest internals. |
| 4 | **Opt-in project docs scaffold/enhance** | shipped | Add gated first-run documentation support: `--scaffold-docs` creates missing `README.md` and `docs/PROJECT-CONTEXT.md` starter docs, while `--enhance-docs` adds managed context-review regions to existing docs without replacing user prose. Add the `anamnesis-init` agent skill so agents ask a multiple-choice README/docs question before selecting those flags for the user. Keep default init conservative so user-owned docs are not rewritten unexpectedly. |

Progress:
- 2026-05-11: Implemented the v1.4 adoption helpers in the CLI. `init`
  now writes or plans `system_graph.yaml`, `init`/`update` preserve
  conflicting project-specific `load-context` skills before installing the
  managed surface, and runtime evidence records both outcomes.
- 2026-05-11: Ran a sanitized TypeScript service-shaped CLI smoke from
  a fresh temp directory. The smoke reached continuity `6/6`, doctor `0/0`, and
  benchmark ready layers `3/5` without publishing any private-project
  evidence.
- 2026-05-11: Cut the v1.4.0 release prep after `npm run release:check`
  passed locally.
- 2026-05-11: Published `@mcprotein/anamnesis@1.4.0` from the tag-triggered
  workflow. npmjs.org returned `1.4.0`, published CLI execution from
  a fresh temp directory returned `1.4.0`, and a fresh sanitized TypeScript service
  fixture verified context bootstrap plus load-context preservation.
- 2026-05-11: Prepared `1.4.1` to follow Codex CLI `0.130.0`'s renamed hook
  feature flag, replacing `[features].codex_hooks` with `[features].hooks`
  and removing the deprecated key during updates.
- 2026-05-11: Published `@mcprotein/anamnesis@1.4.1`. npmjs.org returned
  `1.4.1`, published CLI execution returned `1.4.1`, and a published-package
  migration smoke verified a v1.4.0 install upgrades from `codex_hooks = true`
  to `hooks = true` with doctor `0/0`.
- 2026-05-19: Tightened the v1.4 bootstrap plan for completely blank
  projects: `init` should still write `system_graph.yaml`, but from the
  pre-install project state and with open questions plus invariants only when
  no safe signals exist, so downstream `/ontology-enrich` or human review can
  add semantics without the CLI pretending to know project intent.
- 2026-05-19: Added opt-in `init` docs support. `--scaffold-docs` creates
  missing starter docs, and `--enhance-docs` adds managed review regions to
  existing README/docs so users can explicitly decide when anamnesis touches
  user-facing documentation.
- 2026-05-19: Added the `anamnesis-init` base skill. When an agent performs
  setup for the user, it asks one multiple-choice README/docs question and maps
  the answer to no docs flag, `--scaffold-docs`, or `--enhance-docs`.
- 2026-05-19: Published `@mcprotein/anamnesis@1.4.4` from the tag-triggered
  GitHub Actions `Publish` workflow. The published-package smoke verified
  the deduped Stop handoff reminder: first unchanged dirty fingerprint warns,
  the second run with the same dirty state is silent.

Private validation notes:
- Use private validation only as internal development evidence.
  Do not add project-specific private evidence to README,
  `docs/BENCHMARK-GALLERY.md`, public claim candidates, or public benchmark
  fixtures unless it has been explicitly sanitized and approved later.

Exit criteria:
- Fresh adoption on a TypeScript service-style repo can produce
  cross-agent surfaces plus a useful `system_graph.yaml` draft without an
  agent manually writing it.
- Optional docs scaffolding can create or enhance README/context docs only
  when explicitly requested by flag.
- Existing project-specific `load-context` content is preserved instead of
  overwritten, while the standard anamnesis `load-context` surface becomes
  cleanly managed.
- `status` / `doctor` / `benchmark report` can reach continuity `6/6` and
  doctor `0/0` on the target dogfood shape after init/apply.
- Public docs describe the feature generically without exposing private repo
  names, secrets, tokens, infra identifiers, or internal benchmark records.

---

## v1.5 — *shipped 2026-06-19; follow-ups planned*

> **Theme: compact session context with numeric proof**

The next product risk was context over-injection. SessionStart continuity is
valuable only when it gives agents the minimum current state they need and
clear pointers to retrieve the rest. v1.5 moved ontology and handoff startup
behavior from "print everything we found" toward a compact, retrieval-first
contract, then proved the change with numeric reports and graphs before
making broad claims.

This version is informed by recent agent/LLM ecosystem signals around
context-budget discipline, large-context failure modes, and local-model cost
pressure, but the roadmap below is the canonical plan.

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Compact SessionStart default** | shipped | Change ontology and handoff startup injection to emit a short invariant digest, active-task summary, source pointers, and retrieval instructions by default. Full file injection remains an explicit compatibility/debug mode via `ANAMNESIS_SESSION_CONTEXT_MODE=full`, not the default. |
| 2 | **Session context budget policy** | shipped; status/doctor surfaced in v1.12 | Add a documented budget contract for startup payloads: estimated tokens, chars, lines, source-pointer count, required-rule presence, and cap-exceeded status. `benchmark session-context` reports those dimensions and hard-cap outcomes; v1.12 added current-project compact SessionStart budget diagnostics to `status` and `doctor`. |
| 3 | **Deterministic `benchmark session-context`** | shipped | Add a model-free benchmark comparing `full` and `compact` session context across sanitized fixtures. Metrics include startup chars, lines, estimated tokens, included file bytes, source pointers, required rules present, and hard-cap outcomes. |
| 4 | **Numeric graph artifacts** | shipped | Generate dependency-free SVG charts from the same benchmark JSON so context tradeoffs are visible without reading raw data or adding a chart runtime. Required graphs are generated: mode-by-mode token bar chart, stacked payload composition, fixture-size growth line, and cap/success summary. Store public-safe generated artifacts under docs or benchmark output paths. |
| 5 | **Model-dependent retrieval benchmark** | partial | `benchmark task` now accepts optional compact/full retrieval metrics, `benchmark task-compare` compares paired full/compact runs, and `benchmark task-series` rolls repeated compare evidence into averages, ranges, standard deviations, and SVG charts. The remaining follow-up is repeated public-safe full-vs-compact task runs before any success-rate claim. |
| 6 | **Session-context fixture suite** | shipped | Add fixtures for tiny, normal, large ontology, stale handoff, conflicting ontology, missing handoff, and multi-scope projects so compact mode is tested against the failure modes that caused full injection to look attractive. |
| 7 | **Prompt-gate integration** | shipped | `benchmark prompt-gate` now reads deterministic session-context JSON and retrieval-aware task evidence so prompt-time context deltas stay disabled unless repeated measured failures justify bounded extra injection. |

Progress notes:
- 2026-06-19: Shipped compact SessionStart defaults for Claude Code and
  Codex native wrappers. Default startup context now emits invariant digest,
  active handoff summary, source pointers, and retrieval instructions; full
  file-body injection remains available through
  `ANAMNESIS_SESSION_CONTEXT_MODE=full`.
- 2026-06-19: Added deterministic `anamnesis benchmark session-context`.
  Current public-safe fixture run covers 7 fixture shapes, reports compact
  required rules `7/7`, compact source pointer fixtures `7/7`, large-fixture
  token reduction `94%`, and cap exceeded counts `compact=0`, `full=2`.
  Generated artifacts live under
  `docs/benchmark-evidence/session-context/`.
- 2026-06-19: Extended `anamnesis benchmark task` with optional
  `session_context_mode` and retrieval metrics, and taught
  `anamnesis benchmark prompt-gate` to consume both
  `docs/benchmark-evidence/session-context/session-context.json` and
  retrieval-aware `agent-task-benchmark` records. This enables the
  compact-vs-full model-dependent comparison, but repeated public-safe runs
  are still required before claiming compact task success parity.
- 2026-06-19: Added `anamnesis benchmark task-compare` for paired full vs
  compact retrieval runs. It validates that the two run inputs share the same
  project/task/prompt/agent/model/context state, records compact/full deltas,
  and emits `agent-task-benchmark-compare` evidence that `prompt-gate` can use
  as retrieval friction/failure signal.
- 2026-06-19: Added `anamnesis benchmark task-compare --template` so repeated
  full/compact retrieval runs can start from matched public-safe input pairs
  before observed model metrics are filled in.
- 2026-06-19: Recorded the first public-safe Codex full-vs-compact retrieval
  diagnostic pair under `docs/benchmark-evidence/agent-task/`. Both modes
  completed the fixed task with `3/3` required source reads, `0` missed
  invariants, and `0` hallucinated facts. The compact run was slower and used
  more total tokens in this single pair, so it is evidence for retrieval
  instrumentation and prompt-gate friction tracking, not success parity.
- 2026-06-19: Added `anamnesis benchmark task-series --write` to roll repeated
  compare evidence into average/stddev/min/max metrics and SVG charts. The
  current committed series has only one pair, so it is a pipeline check, not a
  parity claim.

Exit criteria:
- Compact SessionStart includes required invariants and source pointers in
  100% of fixture runs.
- Compact mode reduces startup estimated tokens by at least 60% on the
  large-ontology fixture.
- Model-dependent compact task success is no more than 5 percentage points
  below full mode on the controlled task suite.
- Compact mode increases required-source-read rate versus full mode, showing
  agents retrieve exact context instead of relying on startup payload memory.
- Numeric chart artifacts are generated from the same benchmark data used for
  JSON/markdown reports.
- `status`, `doctor`, or benchmark output can explain when a project is over
  the session-context budget and which source category dominates the payload.

---

## v1.6 — *shipped 2026-06-25*

> **Theme: repo-local executable context and contradiction diagnostics**

After startup payloads are compact, the missing piece is retrieval quality.
v1.6 should make repo-local context easier for agents to query without
turning anamnesis into a cloud memory service or an agent runtime.

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Local context index design** | done | Designed a read-only JSONL index over `AGENTS.md`, `system_graph.yaml`, `.anamnesis/ontology/*.yaml`, `.bootstrap.yaml`, `.enriched.yaml`, handoff files, manifest data, runtime evidence, and selected docs. Draft/decision record: [`docs/CONTEXT-INDEX-DESIGN.md`](CONTEXT-INDEX-DESIGN.md). |
| 2 | **Context index prototype** | done | Added and hardened `anamnesis context index` and `anamnesis context query` prototype commands that build/query a disposable JSONL index with source paths, stable refs, freshness, kinds, tags, snippets, malformed-index tolerance, and diagnostic source-pointer coverage. |
| 3 | **Ontology and handoff contradiction report** | done | Added `anamnesis context diagnose` for stale/missing handoff archive pointers, duplicate ontology entity IDs, conflicting relationship IDs, explicit docs-vs-bootstrap fact conflicts, superseded semantic entries still treated as current, malformed evidence lines, and evidence records with missing artifacts. `status` exposes a short context diagnostic summary and `doctor` exposes detailed advisory issues. |
| 4 | **Compact resume bundle** | done | Added `anamnesis context resume` and `--write` to produce a repo-native compact bundle with active task lines, active/latest handoff pointers, touched files, latest evidence, diagnostic warnings, retrieval rules, and line/char/token estimates. |
| 5 | **Export interface decision** | done | Deferred MCP/API export for v1.6. Core continuity stays on local CLI commands and regenerable `.anamnesis/context/` files; revisit MCP only if dogfood shows file/CLI access is materially blocking cross-session use. |

Exit criteria:
- The index can be regenerated from tracked and local anamnesis files without
  requiring network access or credentials.
- Query output cites source file paths and stable IDs rather than anonymous
  memory blobs.
- Doctor/status diagnostics identify at least stale handoff pointers and
  contradictory ontology claims in fixtures.
- Resume output stays compact enough to fit within the v1.5 session-context
  budget.
- MCP/API export work is explicitly deferred based on current product scope;
  core cross-session use remains file/CLI based.

Progress notes:
- 2026-06-19: Started the JSONL prototype with local indexing for `AGENTS.md`,
  `CLAUDE.md`, ontology YAML, active handoff plus referenced archives,
  manifest entries, runtime evidence summaries, and selected docs.
- 2026-06-22: Added `anamnesis context diagnose` as an advisory context
  consistency report over handoffs, ontology YAML, and runtime evidence.
- 2026-06-22: Surfaced context diagnostics through `status` summary output
  and detailed `doctor` advisory issues without adding prompt-time injection.
- 2026-06-22: Added an explicit docs-vs-bootstrap contradiction fixture using
  `anamnesis-fact: facts... = ...` markers, closing the v1.6 contradiction
  report item without free-form prose inference.
- 2026-06-22: Added `anamnesis context resume` for compact handoff/evidence
  resumption; targeted tests assert the generated bundle stays below 300
  estimated tokens on the fixture.
- 2026-06-25: Deferred MCP/API export from v1.6; local CLI commands and
  regenerable `.anamnesis/context/` files remain the continuity interface.
- 2026-06-25: Hardened context index/query fixtures around `system_graph.yaml`,
  bootstrap facts, docs fact markers, runtime evidence, stale handoff pointers,
  malformed JSONL rows, repo-relative JSON output, and diagnostic follow-up
  source pointers.

---

## v1.7 — *release cut 2026-07-02*

> **Theme: task harnesses, behavior verification, and adapter security**

Once agents receive compact context and can retrieve exact project memory, the
next step is to make agent work verifiable. v1.7 should promote the strongest
Hada-radar signals around harnesses, rubrics, agentic review, and executable
adapter safety into repo-native capabilities and diagnostics.

Task harness storage must be lifecycle-bounded. The default design should
separate one-task `current` harnesses from reusable task templates, inject at
most one matched harness at session start, and leave the rest as indexed
retrieval targets. Completed `current` harnesses should be removed from active
startup context and either deleted or archived under bounded retention.
Reusable harnesses should carry lifecycle metadata such as `last_used`,
`use_count`, `deprecated`, and `superseded_by`, so old or replaced templates can
be reported by `anamnesis gc --dry-run` before any deletion. The goal is not to
grow an unbounded task-memory store; it is to keep a small, useful set of
retrievable contracts with explicit disk and injection budgets.

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **`task_harness` capability design** | done | Specified a tool-agnostic capability for task goal, stop condition, read/write scope, required evidence, test commands, role/subagent hints, rubric, lifecycle kind (`current` or `reusable`), and lifecycle metadata. Preserves adapter parity semantics across Claude Code, Codex, and Cursor through a shared repo-local retrieval file. Design: [`TASK-HARNESS-DESIGN.md`](TASK-HARNESS-DESIGN.md). |
| 2 | **Task harness retention and GC policy** | managed apply shipped | Added cleanup reporting for active `current` harnesses, reusable templates, disk/count budgets, stale age, `last_used`/`use_count`, deprecation/supersession behavior, and managed vs user-authored cleanup recommendations. `gc --apply` backs up and deletes only clean manifest-owned task harness candidates, updates the manifest, and leaves user-authored or user-modified files review-only. |
| 3 | **Base task harness fixture** | done | Added one base-fragment harness fixture and adapter-rendering tests before expanding to stack-specific harnesses. The first fixture targets context/ontology/handoff continuity behavior and stays retrievable through `context index` without adding all harness bodies to startup context. |
| 4 | **Behavior benchmark expansion** | partial | Extended `benchmark task` and `task-compare` with numeric behavior metrics for source citations, managed-region edit attempts, `.bootstrap.yaml` edit attempts, handoff refresh success, matched harness reads, and non-matched harness reads. `task-series --write` now emits a source-citation delta SVG alongside token and quality charts. Repeated public-safe runs remain planned before claiming compact/full behavior parity. |
| 5 | **Executable capability side-effect metadata** | done | Added `side_effects` metadata for executable hooks, skills, and slash commands, covering read-only, local-write, repo-external-write, git-hook, network, credential-touching, and external-production behavior. Renderers propagate the metadata to planned actions, Codex/Cursor fallback text, and Codex native shell wrapper metadata. |
| 6 | **Executable adapter security diagnostics** | done | Added shared executable-surface diagnostics to `doctor` and `status` for generated or managed hooks that under-declare writes, repo-external writes, network access, likely credential touches, external-production commands, or shell safety settings. Managed wrapper drift remains covered by existing tracked-entry drift diagnostics. |
| 7 | **Malicious and unsafe-fragment fixtures** | done | Added unsafe executable-hook and native-hook fixtures for missing shell safety, network egress, read-only write mismatch, repo-external writes, credential-touching, external-production, relative/duplicate native wrappers, and stale Codex hook registrations. |
| 8 | **Review diagnostics for AI-agent config damage** | done | Added advisory `status` / `doctor` checks for copied handoff archives in startup context, generated docs that overclaim adapter parity, duplicated managed region markers, and bootstrap ontology files edited by hand. |

Exit criteria:
- `task_harness` has a documented schema or design decision and at least one
  adapter-parity fixture.
- Harness lifecycle rules distinguish `current` and `reusable` artifacts,
  update usage/deprecation metadata, bound disk growth, and keep non-matched
  harnesses out of startup injection.
- Cleanup remains preview-first: retention and stale-template candidates are
  reported before deletion, and user-authored files are not silently removed.
- Behavior benchmarks report numeric pass/fail dimensions separately from
  deterministic context-quality scorecards.
- Executable adapter security diagnostics are visible in `doctor` or `status`
  and backed by unsafe fixture tests.
- Security checks remain advisory unless a command would generate unsafe
  managed executable output; user-authored files are not auto-reverted.
- README or public claims mention task harnesses or security diagnostics only
  after fixture and dogfood evidence exist.

Progress notes:
- 2026-06-27: Added the initial `task_harness` capability, base
  `context-continuity` harness fixture, adapter parity row, renderer tests, and
  context-index retrieval support. Runtime GC deletion remains planned; the
  current implementation only renders and indexes bounded harness files.
- 2026-06-27: Added preview-only `anamnesis gc --dry-run` reporting for
  task-harness lifecycle candidates. The dogfood repo currently reports one
  managed reusable harness, 2026 bytes, and zero cleanup candidates.
- 2026-06-28: Added v1.7 behavior metrics to the model-dependent task
  benchmark path. The intended contract is now explicit: `AGENTS.md` and
  `CLAUDE.md` should act as compact control planes with source pointers, while
  project facts live in ontology/docs and behavior benchmarks verify that
  agents retrieve, cite, and protect those sources.
- 2026-06-29: Recorded the first public-safe v1.7 behavior benchmark pair for
  `context-continuity`. Full and compact modes both read and cited `4/4`
  required sources, had zero missed invariants, zero hallucinated facts, zero
  managed-region or bootstrap edit attempts, and read the matched harness.
  Compact reduced total tokens by `46.833%` in this pair, but still scored
  lower on convenience due elapsed time. This is diagnostic evidence only;
  repeated pairs remain required before compact/full behavior parity claims.
- 2026-06-30: Added executable capability `side_effects` metadata to the
  fragment schema and render pipeline. Built-in base, Prisma, and Kubernetes
  executable/agent-action capabilities now declare their side effects, and
  promote defaults new hooks to `local-write`. Security diagnostics still
  remain a separate v1.7 step.
- 2026-06-30: Added executable adapter security diagnostics shared by
  `doctor` and `status`. Unsafe fixture tests now verify missing shell safety,
  read-only/write mismatch, undeclared network egress, and undeclared
  repo-external writes while keeping clean installs warning-free.
- 2026-07-02: Closed the unsafe-fragment fixture set with credential-touching,
  external-production, and stale Codex native hook registration coverage.
  Codex hook ownership diagnostics now warn when anamnesis-managed hook
  commands point at missing wrapper files.
- 2026-07-02: Added advisory agent-config damage diagnostics shared by
  `doctor` and `status`. Fixture tests now verify full handoff archives copied
  into startup context, adapter-parity overclaims in docs, hand-authored
  `.bootstrap.yaml` files, and duplicated managed region markers while keeping
  the dogfood repo warning-free.
- 2026-07-02: Added safe `anamnesis gc --apply` cleanup for managed task
  harness candidates. Apply mode deletes only clean files still matching their
  manifest `last_applied_hash`, backs them up under `.anamnesis/backups/`,
  removes those entries from the manifest, writes `gc-apply` runtime evidence,
  and skips user-authored, user-modified, and handoff candidates.
- 2026-07-02: Prepared v1.7.1 from the `release/v1.7` branch after the v1.7.0
  published-package fixture smoke exposed a context-diagnostics false positive.
  Generated `.bootstrap.yaml` provenance remains available for
  docs-vs-bootstrap fact checks, but no longer participates in semantic
  ontology duplicate-ID diagnostics.

---

## v1.8 — *shipped 2026-07-02*

> **Theme: handoff lifecycle automation with bounded markdown retention**

The core handoff lifecycle implementation landed during the v1.7 release cut
because it is tightly coupled to lifecycle cleanup, semantic freshness
diagnostics, and base@15 SessionStart guardrails. v1.8 completed the
configurable lifecycle policy layer and aligned startup injection, diagnostics,
resume, and GC on the same retention settings.

Handoff should become a lifecycle-managed project artifact, not an unbounded
folder of session notes. anamnesis should keep handoff state as repo-local
markdown plus regenerable context-index entries, then use lifecycle tiers to
decide what enters startup context.

Design: [`docs/HANDOFF-LIFECYCLE.md`](HANDOFF-LIFECYCLE.md)

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Handoff lifecycle tiers** | done | Added a documented and code-backed hot/warm/cold/deprecated model. `hot` means active current work in `active.md`; `warm` means recent or active-referenced archives; `cold` means older completed archives available only through query/resume; `deprecated` means superseded, too old, or semantically stale and never injected. |
| 2 | **Auto-draft handoff flow** | done | Added `anamnesis handoff draft`, a safe draft path that gathers git status, recent commits, changed files, latest evidence, current active handoff, and latest archive. The CLI prepares structure only; the agent must confirm decisions, blockers, rejected options, and next steps before finalizing. |
| 3 | **Handoff close/deprecate workflow** | done | Added preview-first `anamnesis handoff close` and `handoff deprecate`. With `--apply`, they mark finalized archives closed, deprecated, or superseded, remove matching active entries from `active.md`, and preserve the underlying archive file. |
| 4 | **Handoff retention in GC** | review-only shipped | Extended `anamnesis gc --dry-run` beyond task harnesses to report handoff archive count, byte budgets, active references, cold/deprecated review candidates, and protected active references. `gc --apply` still leaves handoff archives review-only; close/deprecate removes them from startup context without deleting the markdown record. |
| 5 | **Semantic freshness diagnostics** | done | Taught `status`, `doctor`, and `context diagnose` to warn when `active.md` is structurally valid but semantically stale: old git ref on a clean worktree, completed entries under active sections, missing referenced files, inactive active-referenced archives, or handoff byte-budget pressure. |
| 6 | **SessionStart budget guardrails** | done | Updated Claude Code and Codex SessionStart handoff injection to keep startup bounded: hot summary only, warm active archive source pointers only, cold/deprecated/superseded archives excluded, and full archive bodies available only through explicit debug mode for eligible active archives. Shipped through base@15. |
| 7 | **Configurable bounded retention policy** | done | Handoff lifecycle thresholds moved from code-only defaults into project policy. `max_warm_handoff_archives`, `max_cold_handoff_age_days`, and `max_handoff_bytes` resolve from Agentfile settings, with CLI flags remaining one-run overrides. `gc`, `status`, `doctor`, and `context resume` share the resolver path; SessionStart hooks use the warm fallback count when `active.md` is absent. Deletion stays explicit and backup/hash gated; automatic policy enforcement must not silently remove user-authored handoff records. |

Exit criteria:
- Handoff startup context stays compact and does not inject full archives by
  default.
- `status` or `doctor` can distinguish structural validity from semantic
  freshness for active handoff state.
- `gc --dry-run` reports handoff lifecycle candidates with age/count/byte
  reasons and preserves active references.
- Handoff lifecycle thresholds are configurable per project, and CLI flags act
  only as temporary overrides.
- The same resolved retention policy is used by startup injection, `status`,
  `doctor`, `context resume`, and `gc`, so hot/warm/cold/deprecated decisions
  do not drift between commands.
- Completed work can be removed from active startup context without deleting
  useful historical archives immediately.
- Disk growth is bounded by policy through automatic classification, startup
  exclusion, and explicit review/apply cleanup paths; no handoff markdown is
  silently deleted.
- No hosted service or separate handoff storage backend is introduced for
  handoff continuity.

Progress notes:
- 2026-07-02: Added `core/handoff_lifecycle` and `gc --dry-run` handoff
  lifecycle preview. The CLI now reports hot/warm/cold/deprecated handoff
  counts, active archive references, handoff byte budget pressure, and
  review-only candidates while protecting archives referenced by `active.md`.
- 2026-07-02: Added `anamnesis handoff draft` as the v1.8 auto-draft path.
  It gathers git ref, recent commits, touched files, latest evidence, active
  handoff, and latest archive, then emits a TODO-marked draft without changing
  `active.md` or creating a finalized archive.
- 2026-07-02: Added preview-first `anamnesis handoff close` and
  `handoff deprecate`. The commands reject drafts and `active.md` as lifecycle
  targets, update finalized archive frontmatter only with `--apply`, and remove
  matching active entries while keeping archives on disk.
- 2026-07-02: Added semantic freshness diagnostics for active handoff state.
  `context diagnose`, `status`, and `doctor` now flag completed entries left
  under active sections, active references to closed/deprecated/superseded
  archives, missing file pointers, clean-worktree stale git refs, and handoff
  byte-budget pressure. Lifecycle active-reference detection now treats only
  `Current focus` and `Active tasks` bullets as hot references; `Recently
  completed` archive links are historical breadcrumbs.
- 2026-07-02: Added SessionStart budget guardrails for handoff lifecycle.
  Claude Code and Codex native startup surfaces now inject active summaries
  plus warm active archive pointers only; cold/deprecated/superseded archive
  bodies are excluded even when `Recently completed` links remain in
  `active.md`. The behavior ships through base@15 and is covered by hook
  tests plus dogfood/update evidence.
- 2026-07-02: Started configurable bounded retention policy. Agentfile accepts
  `max_warm_handoff_archives`, `max_cold_handoff_age_days`, and
  `max_handoff_bytes`; `gc`, context diagnostics, status/doctor through
  diagnostics, and `context resume` resolve the same policy, while GC flags
  remain one-run overrides. The follow-up hook policy ships through base@17:
  Claude Code and Codex SessionStart hooks now honor the configured warm
  archive fallback count when `active.md` is absent: `0` injects no fallback
  archive, while positive values include only the newest N eligible warm
  archive pointers.

---

## v1.9 — *release cut 2026-07-03*

> **Theme: upgrade compatibility and project-update planning**

The next risk was not raw feature coverage; it was whether existing users can
move from an older published `@mcprotein/anamnesis` to the current release and
confidently know what happened to their project. The v1.9.0 release is
conservative and mostly backward-compatible: package upgrade, Agentfile parsing,
manifest drift detection, user-modified preservation, backup-on-apply, pinned
fragment rendering, hook config merge, repair diagnostics, a read-only
`upgrade plan`, and a release readiness gate all exist. The remaining gap is
interactive conflict choice UX: the deterministic plan exists, while a TUI-style
chooser and optional setting materialization policy stay post-1.9 work. The
post-release audit below treats these as v1.10 feature candidates, not missing
v1.9.0 release blockers.

Baseline behavior from the v1.8 audit, with v1.9 release updates:

- Before the user-level project registry shipped, `anamnesis upgrade --apply`
  upgraded the global CLI package only. The current flow reloads the installed
  CLI and synchronizes the safe registered-project subset; moved, replaced,
  blocked, or user-modified projects remain reported and skipped. It does not
  automatically migrate Agentfiles, repair doctor findings, enrich ontology,
  or run adapter smoke checks for projects that fail the safe apply gate.
- The v1.9 text pass now hands off from package upgrade to project
  `update` / `doctor` guidance for managed projects, and registry lookups are
  bounded so a slow registry/auth path does not hang indefinitely. Deeper
  project gate detection is available through `anamnesis upgrade plan`.
- `anamnesis update` is dry-run first, reads the existing Agentfile and
  manifest, preserves user-modified managed files, backs up files before
  writing updates, auto-adds required dependency fragments, and bumps
  non-pinned fragment versions on apply only when that fragment has no
  preserved or blocked managed surfaces.
- Pinned fragments intentionally stay on their archived versions unless
  `--bump-pinned` is supplied. Missing pinned archives are hard blockers.
- Executable adapter writes are blocked unless `--allow-exec-adapters` is
  provided. This is the correct supply-chain default, but users need an obvious
  choice when new hooks, commands, skills, Cursor rules, or Codex wrappers are
  part of an upgrade.
- `.claude/settings.json` and `.codex/hooks.json` are structurally merged and
  preserve unrelated user/plugin/OMX entries, but invalid JSON or intentionally
  customized managed hook files still require review.
- New optional Agentfile settings can work through parser defaults even when
  older Agentfiles do not contain them. That preserves compatibility, but it
  makes new policy knobs harder for users to discover unless an upgrade plan
  surfaces them.
- `doctor` and `status` report repair guidance, but conflict resolution is
  still mostly textual: keep local edits, manually merge, re-run with
  `--allow-exec-adapters`, re-run with `--bump-pinned`, add a suggested
  fragment, or list it under `declined`.

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Upgrade compatibility matrix** | v1.9.0 baseline shipped | Added matrix tests for clean old projects, old Agentfiles without new optional settings, user-modified managed regions, executable-adapter permission gates, registry timeout behavior, package/project guidance, partial adoption, and release smoke gating. Broader historical fixture coverage remains useful post-1.9, especially representative v1.4/v1.5/v1.7 published states, pinned fragments, partial adapter installs, stale hook registrations, hook config preservation, and suggested-but-declined fragments. |
| 2 | **Project upgrade plan command** | v1.9.0 shipped | Added `anamnesis upgrade plan`, a read-only package/project plan that reports current/latest CLI versions, Agentfile schema support, fragment updates, update dry-run gates, partial adoption, doctor health, and exact next commands. Remaining post-1.9 work: surface new optional settings/materialization choices explicitly instead of only relying on parser defaults and docs. |
| 3 | **Upgrade-to-update handoff UX** | v1.9.0 shipped | Text output now prints the package/project boundary and `update` / `doctor` next commands for managed projects, while `upgrade plan` surfaces pinned fragments, blocked executable adapters, user-modified surfaces, partial adoption, and doctor issues. Remaining post-1.9 work: expose an optional interactive/TUI chooser using the same deterministic plan. |
| 4 | **Guided conflict choices** | deferred to v1.10 | Convert common upgrade conflicts into explicit choices instead of only counts and prose: apply safe managed updates, include executable adapters, keep local user-modified content, open/manual-merge library content, bump pinned fragments, leave pinned fragments as-is, add suggested fragments, or add suggestions to `declined`. Keep the default non-interactive path deterministic and safe. |
| 5 | **Partial-upgrade state hardening** | done | `update --apply` now delays the Agentfile version bump for any fragment with `user-modified` or `blocked` managed surfaces. `status`, `doctor`, and `upgrade plan` all report partial adoption targets explicitly. |
| 6 | **Optional setting materialization policy** | deferred to v1.10 | Decide when new optional Agentfile settings should remain implicit defaults versus being written into existing Agentfiles. The command should explain new knobs, preserve existing settings, avoid formatting churn unless `--apply` is chosen, and never introduce required fields without a schema migration. |
| 7 | **Agentfile migration integration** | deferred to v1.10 | Keep `anamnesis migrate agentfile` dry-run/apply/backup-first, but make `update` and the upgrade plan detect when a schema migration is required before rendering. No fragment render or managed file write should happen from a CLI that cannot parse the project schema safely. |
| 8 | **Post-upgrade verification gate** | done | Added `anamnesis release check`, a read-only release gate that composes `status`, `update --dry-run --allow-exec-adapters`, `doctor`, manifest drift, hook registration health, runtime evidence freshness, update-apply evidence, and a sanitized old-project upgrade smoke. It now runs first in `npm run release:check`. |
| 9 | **Repair docs refresh** | shipped | `docs/REPAIR.md` covers partial upgrades caused by preserved managed surfaces, and README documents `upgrade plan` plus `release check` in the lifecycle flow. Docs distinguish package upgrade, project update, schema migration, and semantic agent tasks such as `/ontology-enrich` or `/handoff-prepare`. |

Post-release audit, 2026-07-03:

- `v1.9.0` is complete for the package/project boundary, bounded registry
  lookup, read-only `upgrade plan`, partial-adoption diagnostics, release
  readiness gate, and dual-registry publish flow.
- `v1.9.1` should stay limited to documentation and small upgrade-copy fixes
  unless a post-release smoke exposes a concrete bug.
- `v1.10` should own new behavior: guided conflict choices, optional setting
  materialization, schema migration gating, and broader compatibility fixtures.
- The old v1.9 exit criteria mixed released behavior with future UX. They are
  split below so future work does not make the published `1.9.0` look
  incomplete.

v1.9.0 accepted evidence:

- A user who has an older managed project can run one read-only command and
  understand whether the CLI package, Agentfile schema, fragment versions,
  managed files, hooks, ontology, and handoff lifecycle are current.
- After `upgrade --apply`, the CLI explicitly tells users whether they are in
  an anamnesis-managed project and which project `update` / `doctor` command
  to run next; users should not confuse package upgrade with project surface
  upgrade.
- Clean old projects can upgrade through a documented command sequence without
  losing user-authored content, with backups and runtime evidence written on
  apply.
- `status` and `doctor` can distinguish fully upgraded projects from partial
  adoption states where some managed surfaces were intentionally preserved.
- Release readiness includes an upgrade smoke that starts from at least one
  older published package state or sanitized old-project fixture and ends with
  `doctor` reporting zero errors after the chosen repair path.

Deferred acceptance criteria:

- Projects with `user-modified`, `blocked`, `pinned`, malformed hook config,
  or suggested fragment states receive explicit choices rather than only prose
  and next commands.
- New optional settings are either safely defaulted or surfaced as an explicit
  materialization choice; required schema changes go through
  `migrate agentfile`.
- Automated compatibility tests cover old Agentfile shapes, pinned fragments,
  user-modified managed regions, executable adapter gates, hook merge
  preservation, stale hook registrations, and suggested-but-declined fragments
  across representative published versions.

Progress notes:
- 2026-07-02: Audited current v1.8 upgrade behavior. The package updater is
  intentionally package-only; project changes are owned by `update`, schema
  changes by `migrate agentfile`, diagnostics by `status`/`doctor`, and
  semantic memory by agent workflows. This is safe but fragmented, so v1.9
  should turn the existing primitives into a coherent upgrade plan and conflict
  choice flow.
- 2026-07-02: Clarified the user-facing upgrade UX requirement. `upgrade`
  should hand off to project `update` guidance directly, with scriptable
  command output first and optional interactive/TUI conflict choices using the
  same underlying plan.
- 2026-07-02: Implemented the first text-output pass for `upgrade` so managed
  projects see the CLI/package boundary plus `update --dry-run`,
  `update --apply`, and `doctor` next commands. Deeper gate detection and the
  optional interactive/TUI chooser remain planned.
- 2026-07-03: Added the first upgrade compatibility matrix tests for clean old
  projects, old Agentfiles without optional settings, user-modified managed
  regions, and executable-adapter gates. Hardened `update --apply` so fragments
  with preserved or blocked managed surfaces keep their previous Agentfile
  version instead of being marked fully current.
- 2026-07-03: Added `status.partialAdoptions`, CLI `status` output, and
  `doctor` warning `fragment-partial-adoption` so held-back fragment bumps cite
  the exact managed targets that need manual merge or executable-adapter review.
  `docs/REPAIR.md` now documents the repair loop for those partial upgrades.
- 2026-07-03: Added `anamnesis upgrade plan` as the first project upgrade plan
  surface. It combines package version drift, Agentfile schema readiness,
  `status`, `update --dry-run`, `doctor`, partial adoption, and next commands
  without mutating the package or project.
- 2026-07-03: Added `anamnesis release check` as the first post-upgrade
  verification gate. It reports release readiness from `status`, update
  dry-run, `doctor`, manifest drift, hook registration health, runtime
  evidence freshness, update-apply evidence, and a sanitized old-project
  upgrade smoke, so the gate now reports pass/fail instead of a skipped smoke
  lane.
- 2026-07-03: Completed the post-release roadmap audit after `v1.9.0` was
  published to npmjs.org and GitHub Packages. The audit separates the shipped
  package/project upgrade plan from v1.9.1 patch candidates and v1.10 feature
  candidates.

---

## v1.9.1 — *release cut 2026-07-03*

> **Theme: post-release audit and upgrade UX copy polish**

This patch line should stay small. Use it only for documentation consistency,
upgrade command copy, or a concrete post-release bug found by registry/package
smoke tests. Do not add new upgrade behavior here unless the lack of it blocks
users who already installed `1.9.0`.

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Roadmap post-release audit** | done | Split the v1.9 section into published `1.9.0` evidence, patch candidates, and v1.10 feature candidates. This keeps the public release from looking incomplete while preserving the next work. |
| 2 | **Upgrade copy audit** | done | Re-read `upgrade`, `upgrade plan`, `status`, and `doctor` output as a user upgrading from `1.8.0`. Patched upgrade-plan copy so safe-mode dry-run counts, executable-adapter gates, user-modified surfaces, pinned fragments, suggested fragments, and doctor issues point to concrete next steps without changing behavior. |
| 3 | **Release evidence summary** | done | README, changelog, and roadmap now identify `1.9.1` as a small patch over the dual-registry `1.9.0` release line. New guided upgrade behavior stays assigned to v1.10. |

Exit criteria:

- No package behavior changes unless tied to a concrete post-release bug.
- Local verification remains `npm run release:check`, plus targeted tests if
  CLI copy changes.
- Publish `1.9.1` because the patch changes CLI output users receive through
  npm/GitHub Packages.

---

## v1.9.2 — *release cut 2026-07-03*

> **Theme: warning-only doctor guidance copy**

The `1.9.1` published smoke caught one remaining copy issue: `upgrade plan`
used an error-oriented next step even when `doctor` reported warnings only.
This patch keeps behavior unchanged and clarifies that errors block applying
project updates while warnings may be expected agent-required follow-up.

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Doctor warning guidance** | done | `upgrade plan` now tells users to run `doctor`, resolve errors before applying project updates, and review warnings for expected agent-required follow-up. |

---

## v1.9.3 — *release cut 2026-07-03*

> **Theme: release automation hardening**

The release process exposed a recurring operational failure mode: package tags,
npmjs.org, GitHub Packages, GitHub Releases, changelog state, and branch cleanup
were not enforced by one repeatable path. v1.9.3 keeps package behavior stable
and hardens the project release lane so future versions are cut through scripts
instead of a manual checklist.

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Tag workflow GitHub Release creation** | done | The tag-triggered `Publish` workflow now validates `vX.Y.Z` against `package.json`, publishes or verifies npmjs.org and GitHub Packages, checks registry parity, then creates or updates the matching GitHub Release from the changelog section. |
| 2 | **Historical release backfill** | done | Existing tags from `v0.2.0` through `v1.9.2` now have GitHub Releases; `v1.9.2` is the latest public release and both package registries report `1.9.2`. |
| 3 | **Repo release runner** | done | Added `npm run release:prepare`, `release:publish`, `release:verify`, and `release:status` so version files, changelog promotion, evidence refresh, release gate, commit, tag, push, branch cleanup, and post-publish smoke use a single scripted path. |
| 4 | **Release docs simplification** | done | `docs/RELEASING.md` now treats the scripts as the normal path and keeps manual npm publish only as an incident recovery fallback. |
| 5 | **Agent-facing release invariant** | done | Added release rules to `AGENTS.md` and the top of `docs/RELEASING.md` so future agents see the scripted path before they can fall back to memory or older manual release habits. |

Exit criteria:

- A normal release can be prepared with `npm run release:prepare -- --version X.Y.Z`.
- A normal release can be cut with `npm run release:publish -- --version X.Y.Z --push --cleanup-branch`.
- Public artifacts can be verified with `npm run release:verify -- --version X.Y.Z`.
- No step asks the maintainer to remember separate manual npm, GitHub Package,
  GitHub Release, tag, or branch cleanup commands during the normal path.
- Fresh agent sessions see the release invariant in `AGENTS.md` before doing
  release work.

---

## v1.9.4 — *release cut 2026-07-05*

> **Theme: build and release verification hardening**

v1.9.3's scripted release path exposed two follow-on gaps: a locally built
CLI entrypoint could lose its executable bit, and the dogfood release gate's
cross-agent checks had no explicit timeout budget. v1.9.4 closes both without
changing package behavior.

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Postbuild executable-bit guard** | done | Added a `postbuild` script so `cli/dist/index.js` keeps its executable bit after every local build. |
| 2 | **Dogfood release verification stabilization** | done | Gave the slower cross-agent dogfood tests an explicit timeout budget so release verification does not flake under load. |

---

## v1.9.5 — *release cut 2026-07-07*

> **Theme: internal quality and maintenance hardening**

v1.9.5 is a maintenance patch: it turns on real lint enforcement,
deduplicates handoff-parsing helpers into a shared module, adds a missing
test suite for the executable-adapter security gate, and reconciles stale
roadmap/handoff state. No user-facing CLI behavior changes.

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Real lint gate** | done | Replaced the no-op `lint` script with Biome, using a narrow correctness-focused rule set; fixed the initial 16 violations. |
| 2 | **Handoff text-parsing dedup** | done | Extracted `isCompletedHandoffTaskLine`, `activeHandoffOpenTaskLines`, `extractArchiveRefs`, and `newestHandoffArchive` into `core/handoff_active_text.ts`, replacing four duplicated implementations across `status.ts`, `context_diagnostics.ts`, `handoff_draft.ts`, and `benchmark_prompt_gate.ts`. |
| 3 | **Executable security test coverage** | done | Added `core/executable_security.test.ts` covering the security-signal detection boundary that previously had no direct unit tests. |
| 4 | **Adapter component test coverage (codex/cursor)** | deferred | Scope: `adapters/{codex,cursor}/{ontology,skill,slash_command,task_harness,executable_hook}.ts`; deferred to a follow-up patch rather than bundled into this maintenance release. |
| 5 | **Roadmap state reconciliation** | done | Fixed the stale "planned patch" heading on the already-shipped v1.9.3 section and backfilled the missing v1.9.4 section. |

**Backlog note**: `index.ts` (~2663 lines) and `dogfood.ts` (~1705 lines) are
the highest-churn modules in the repo. Splitting `index.ts`'s command
dispatch and extracting `dogfood.ts`'s sub-concerns deserves a dedicated
design and characterization-test pass, not a patch-release bolt-on.

---

## v1.9.6 — *release cut 2026-07-07*

> **Theme: contributor documentation follow-up**

v1.9.5 turned the `lint` script into a real Biome gate but did not surface
it in the contributor and agent guides. v1.9.6 closes that documentation
gap. No code or CLI behavior changes.

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Document the lint step** | done | Added `npm run lint` alongside typecheck/test in `AGENTS.md` and `CONTRIBUTING.md`, and dropped the stale hardcoded test counts. |

---

## v1.10 — *shipped 2026-07-07*

> **Theme: guided upgrade decisions, release gates, and compatibility depth**

v1.10 took the deterministic `upgrade plan` from v1.9 and turned its
reported gates into clearer choices. The default path remains scriptable,
dry-run-first, and safe for unattended use. The v1.9 patch line also exposed a
smaller quality-track gap: release, contributor, and agent guidance mentioned
lint and benchmark gates, so v1.10 aligned the automated gates and their output
with that contract instead of relying on humans to remember extra checks.

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Guided conflict choices** | done | `upgrade plan` now emits structured choices for package upgrades, schema migration, executable-adapter preview/apply, local managed edits, pinned fragments, suggested fragments, doctor follow-up, and optional setting defaults. Each choice carries a stable id, effect class, command when directly executable, outcome, and recommendation flag. v1.10 stayed deterministic and dry-run-first; v1.11 later added the interactive chooser and safe choice executor on top. |
| 2 | **Optional setting materialization policy** | done | `upgrade plan` now reports whether optional Agentfile settings are implicit defaults, partially materialized, or fully materialized. Existing projects keep defaults implicit by default; the plan offers a recommended choice to avoid Agentfile churn and a manual choice to materialize only settings the user wants to tune. |
| 3 | **Schema migration gate integration** | done | `update` now checks `migrate agentfile` dry-run state before planning managed surface renders and stops with the migration command when required. `upgrade plan` stops at the schema gate before status/update/doctor diagnostics and emits the migration choice first. Required schema changes stay backup-first and dry-run visible. |
| 4 | **Historical compatibility fixture matrix** | done | Expanded `upgrade_compatibility.test.ts` with representative published-state fixtures for v1.4, v1.5, and v1.7 Agentfile shapes, pinned fragment archives, partial adapter installs, stale Codex hook registration refresh, hook config preservation, and suggested-but-declined fragments. |
| 5 | **Upgrade benchmark evidence** | done | Added `anamnesis benchmark upgrade`, which repeatedly runs public-safe existing-project upgrade fixtures and writes JSON/Markdown/SVG evidence under `docs/benchmark-evidence/upgrade/`. Current evidence is 15/15 pass across clean old projects, pinned archives, partial adapter choices, stale Codex hook refresh, and suggested-but-declined fragments, with zero post-upgrade pending writes, doctor errors, or manifest drift. |
| 6 | **Release gate alignment** | done | The scripted release path now runs the same quality gates documented for contributors and agents: `npm run lint` is included in `release:check`, `prepublishOnly`, and the tag publish workflow before typecheck/test/build can publish a package. `release:verify` remains the public registry/GitHub Release/CLI smoke gate. |
| 7 | **Agent-facing status cleanup** | done | Replaced stale repo-local status copy such as `v0.1 alpha` / `Pre-1.0` in `AGENTS.md` with pointers to `package.json`, `CHANGELOG.md`, and this roadmap. Avoids hardcoded test counts or release-state claims that drift after patch cuts. |
| 8 | **Dev dependency security refresh** | done | Refreshed development-only dependencies that produced `npm audit` warnings (`vitest`/`vite`/`esbuild` path and related transitive packages) while keeping runtime `npm audit --omit=dev` clean. Treats this as release-readiness hardening, not a runtime security incident. |
| 9 | **Prompt-gate UX semantics** | done | Clarify `benchmark prompt-gate` output so non-blocking risk signals do not look like release failures. Keep the decision conservative (`collect-more-evidence` / no prompt-time injection) unless repeated benchmark evidence justifies a bounded prototype. |

Release criteria met:

- Existing v1.9 upgrade-plan behavior still works non-interactively and
  remains dry-run-first.
- Guided choices are optional on top of the deterministic plan, not a new
  requirement for scripts or CI.
- `npm run release:check`, the tag publish workflow, and contributor docs agree
  on which local gates define release readiness.
- Public verification still ends with npmjs.org, GitHub Packages, GitHub
  Release, and published CLI smoke checks for the same version.

---

## v1.11 — *shipped 2026-07-07*

> **Theme: guided upgrade execution UX**

v1.10 made upgrade choices deterministic and inspectable. v1.11 turns selected
choices into executable workflow steps while keeping the default
non-interactive path safe for CI and scripted users. Interactive UX stays a
presentation layer over the deterministic command and benchmark evidence.

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Choice execution command** | done | Added `upgrade apply-choice <id>` as a safe executor over existing `upgrade plan` choices. It does not shell out arbitrary command strings: supported choice ids map to internal commands. Read-only choices execute directly, manual choices stay guidance-only, and local-write/package-install choices preview by default unless `--apply` is explicit. |
| 2 | **Interactive/TUI chooser** | done | Added `upgrade choose`, a no-dependency terminal chooser that renders numbered `upgrade plan` choices, accepts either a number or choice id, and delegates execution to `upgrade apply-choice`. Non-interactive scripts can pass `--choice <id|number>`; without a TTY or explicit choice it fails closed and points users back to `upgrade plan` / `upgrade apply-choice`. |
| 3 | **Choice execution evidence** | done | Extended `benchmark upgrade` with a choice-execution fixture that verifies preview-required behavior, no writes before `--apply`, successful apply, post-upgrade pending writes, doctor errors, drift, and unsupported-choice count. Current generated evidence is 18/18 pass with zero pending writes, doctor errors, drift, or unsupported choices. |

Release criteria met:

- `upgrade choose` and `upgrade apply-choice` are presentation/execution layers
  over the deterministic `upgrade plan` output, not a replacement for the
  scriptable plan.
- Local-write and package-install choices remain preview-first unless
  `--apply` is explicit.
- Choice execution is benchmarked with generated evidence and no unsupported
  choice ids in the public-safe fixture set.
- `v1.11.0` was published to npmjs.org, GitHub Packages, and GitHub Releases,
  then verified with the published CLI smoke check.

---

## v1.12 — *shipped 2026-07-07*

> **Theme: SessionStart budget diagnostics in daily maintenance**

v1.5 shipped compact SessionStart defaults and deterministic benchmark graphs,
but the open follow-up was surfacing that budget in normal maintenance
commands. v1.12 keeps the default injection compact and read-only while making
current-project startup payload size visible in `status` and actionable in
`doctor`.

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Current-project SessionStart budget** | done | Added a compact SessionStart budget analyzer that estimates chars, lines, tokens, source pointers, source bytes, invariant digest lines, active task lines, required retrieval rules, and cap-exceeded status for the current project. It follows startup semantics by including ontology/system-graph pointers plus active handoff and startup-active warm archives, not every historical handoff record. |
| 2 | **Status/doctor surfacing** | done | `anamnesis status` now prints the compact SessionStart budget line, and `anamnesis doctor` raises a `session-context-budget-exceeded` warning when the compact startup payload exceeds the default budget. This closes the v1.5 status/doctor surfacing gap without adding a new Agentfile schema setting. |
| 3 | **Regression coverage** | done | Added tests for startup-active source selection, over-budget detection, `status` summary output, and `doctor` warning generation. Self-check on this repo reports `115/800` estimated compact startup tokens and no doctor warnings. |

Release criteria met:

- The diagnostic remains read-only and does not change SessionStart hook
  output by itself.
- The measured source set matches the compact startup contract: source
  pointers first, active handoff index when present, active referenced warm
  archives, and no cold/deprecated historical archive injection.
- Existing benchmark artifacts remain the public evidence source for full vs
  compact comparisons; `status`/`doctor` are daily project-health diagnostics.

---

## v1.13 — *shipped 2026-07-08*

> **Theme: first-run guidance and prose-doc freshness**

Dogfood on downstream projects exposed two adjacent UX gaps: stale prose docs
can keep misleading agents even when managed context is clean, and first-time
users need clearer command guidance before they learn the full CLI surface.

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Prose doc file-reference drift** | done on release/v1.13 | Extended `context diagnose` with deterministic repo-relative path-token checks for `README.md`, `CLAUDE.md`, and `docs/**/*.md`. Missing file references warn without attempting semantic truth checks. URLs, placeholders, sibling-repo paths, generated/code-heavy `AGENTS.md`, and common generated directories are ignored to reduce false positives. |
| 2 | **Doc freshness review surface** | done on release/v1.13 | Added the read-only `doc-freshness-review` base skill as the agent-facing semantic review path for claims the CLI cannot safely prove, such as present-tense architecture statements that still point at a moved or deleted subsystem. Deterministic CLI facts remain separate from agent judgment. |
| 3 | **Bare CLI first-run guide** | done on release/v1.13 | `anamnesis` with no command now prints a concise guide for previewing first-time adoption, installing all agent surfaces, verifying with `doctor`/`status`, updating, planning upgrades, and running agent follow-ups. `anamnesis --help` remains the full command reference. |
| 4 | **Init next-step guidance** | done on release/v1.13 | `anamnesis init` output now ends with an explicit next-step block: how to apply a reviewed dry-run, when `--tools all --allow-exec-adapters` is needed, which verification commands to run next, and which follow-ups are intentionally agent-required (`/ontology-enrich`, `/handoff-prepare`). |

Exit criteria:

- `context diagnose` catches stale prose file references without requiring an
  LLM or a local database.
- Bare `anamnesis` is useful for a new user without dumping every advanced
  command and benchmark flag.
- First-time `init` output answers "am I done, and if not, what exact command
  comes next?".

---

## v1.14 — *shipped 2026-07-09*

> **Theme: Codex native skill parity and adapter surface evidence**

v1.13 exposed a parity gap: Codex itself can use skill directories, while
anamnesis rendered `skill` capabilities for Codex only as AGENTS.md fallback
regions. v1.14 closes that gap by adding native project-local Codex skills
without removing the fallback path or weakening supply-chain gates.

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Codex native skill surface research** | shipped | Verified the real Codex project-local skill discovery contract with `codex exec -C <tmp-project> --ignore-user-config --sandbox read-only` over `.codex/skills/anamnesis-smoke/SKILL.md`; Codex loaded the project skill and returned the expected sentinel. |
| 2 | **Codex skill renderer parity** | shipped | The Codex `skill` renderer now emits `.codex/skills/<name>/...` native skill files while keeping the existing `AGENTS.md` `codex-skill-*` fallback mandatory. Nested skill assets are mirrored like Claude Code skills. |
| 3 | **Executable-adapter safety for Codex skills** | shipped | Generated `.codex/skills/**` files are treated as agent-behavior surfaces gated by `--allow-exec-adapters`. `init`, `update`, `status`, `doctor`, and applier tests cover native files, blocked writes, and missing-surface diagnostics. |
| 4 | **Adapter parity docs and tests** | shipped | `README.md`, `docs/ADAPTER-PARITY.md`, `docs/AGENT-SWITCHING-GUIDE.md`, `docs/MONOREPO.md`, `docs/DESIGN.md`, and relevant tests now describe Claude Code native skills, Codex native+fallback skills, and Cursor rule fallbacks accurately. |

Exit criteria:

- Codex native skill discovery is verified by a reproducible smoke or held as
  research-only if the project-local path is not supported.
- Existing `AGENTS.md` Codex fallback skill regions remain installed and tested.
- `.codex/skills/**` writes, if enabled, respect the executable-adapter review
  gate and do not silently bypass `--allow-exec-adapters`.
- `status` / `doctor` continuity targets include any new Codex native skill
  files only after the native path is proven.

---

## v1.15 — *shipped 2026-07-09*

> **Theme: subagent context contract and injection-success evidence**

v1.14 gives Codex native project skills, but subagents are a different
problem. A separately launched Claude/Codex/OMX worker process can receive the
normal startup context through the installed surfaces. A same-session native
subagent may not trigger a fresh SessionStart hook, so anamnesis should not
claim hidden automatic injection there until it is measured. v1.15 makes this
boundary explicit and adds repeated-run evidence.

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Subagent context contract** | shipped | Define the leader-to-subagent contract for work that depends on project memory: the leader must either pass a compact anamnesis context preamble or require the subagent to read and report the exact source pointers it used (`AGENTS.md`, `.anamnesis/handoff/active.md`, startup-active warm archives, `system_graph.yaml`, `.anamnesis/ontology/*.yaml`, and relevant `.codex/skills/*`). |
| 2 | **Separate-process hydration path** | shipped | `anamnesis context subagent-preamble` now prints a launcher-wrapper payload for externally started subagents and worker processes. It includes agent control pointers, compact startup source pointers, the resume bundle, and a required `anamnesis_context_sources` response contract, so launchers can prepend it before the task prompt. |
| 3 | **Same-session native subagent guardrails** | shipped | Treat same-session native subagents as prompt-contract enforced until the runtime exposes a subagent hook or equivalent startup interception point. The leader should reject subagent reports that omit required context evidence for tasks that need project state. |
| 4 | **Injection success benchmark** | shipped | `anamnesis benchmark subagent-injection --attempts <n>` now reports raw attempts, injected count, missed count, injection rate, prompt-contract accepted/rejected counts, JSON/Markdown evidence, runtime evidence, and SVG graphs. The separate-process lane validates the generated launcher-wrapper preamble; current dogfood run: separate-process startup `20/20` injected; same-session prompt-contract `20/20` accepted. |
| 5 | **Status/doctor surfacing** | shipped | `status` reads appended `subagent-injection-benchmark` runtime evidence through the shared evidence summary. `doctor` reports missing subagent benchmark evidence as info for multi-tool/Codex projects, and stale or failed subagent benchmark evidence as warnings. |

Benchmark design:

- **Separate-process lane**: run a fresh worker/session command repeatedly
  from a fixture project and assert that the expected anamnesis sentinel,
  source pointers, or resume bundle appears in the agent-visible startup
  context. This lane should be suitable for a pass/fail threshold such as
  `19/20` or better once the runner is stable.
- **Same-session native subagent lane**: measure whether the delegated
  subagent returns the required context-evidence fields. This is not the same
  as proving SessionStart injection, so the report must label it as
  prompt-contract evidence.
- **Graph output**: generate count and rate graphs so regressions are visible
  without reading raw JSON. Counts matter more than percentages: `18/20`
  is clearer than `90%` alone.
- **No overclaiming**: documentation must distinguish "startup-hook enforced",
  "launcher-wrapper enforced", and "prompt-contract enforced" subagent lanes.

Exit criteria:

- A deterministic or fixture-backed benchmark can run repeated attempts and
  produce raw counts plus machine-readable evidence.
- Public docs explain which subagent paths can be forced today and which paths
  are only contract-enforced.
- `status` or `doctor` points users to the benchmark when the configured
  subagent path has no recent evidence.
- No README or roadmap claim says same-session native subagents receive
  automatic SessionStart injection unless the benchmark proves it.

---

## v1.16 — *shipped 2026-07-09*

> **Theme: command UX consolidation and terminal UI polish**

v1.15 made the subagent boundary explicit, but the CLI surface had become too
crowded. Core project tasks, maintainer release commands, benchmark harnesses,
handoff lifecycle commands, and context retrieval tools are all visible in one
plain-text help dump. v1.16 made the default path readable without
breaking existing scripts.

Design: [`docs/COMMAND-UX-PLAN.md`](COMMAND-UX-PLAN.md)

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Command surface taxonomy** | done on release/v1.16 | Commands are grouped as core commands, workflow namespaces, compatibility paths, and maintainer/full-catalog entries. Default help highlights `init`, `apply`, `status`, `doctor`, `upgrade`, and the major namespaces; `update` remains visible only as compatibility. |
| 2 | **Grouped help and no-command guide** | done on release/v1.16 | `anamnesis` remains a concise action guide. `anamnesis --help` now shows grouped core help instead of the monolithic catalog, and `anamnesis --help --all` preserves the full command/flag reference for maintainers and scripts. |
| 3 | **Guided command consolidation** | done on release/v1.16 | `upgrade` remains the CLI package upgrade flow, `apply --dry-run` previews project-managed changes, and `apply` writes reviewed project-managed changes. `update` / `update --apply` stay available only as deprecated compatibility commands that point to `apply`. Future discovery/local-fragment work is folded into `init` and `apply --dry-run` instead of new top-level commands. |
| 4 | **Shared terminal UI renderer** | done on release/v1.16 | Added a dependency-free CLI UI layer for semantic colors, verdict headers, grouped checks, command rows, width-aware wrapping, and color/plain parity. Human output now distinguishes CLI upgrade, project apply preview, and project apply; `--json` remains machine-readable and unstyled. |
| 5 | **High-impact reporter migration** | done on release/v1.16 | Migrated common `doctor`, `status`, `init`, `apply`, `update`, `upgrade`, and `upgrade plan/apply-choice` human output to the shared layout while keeping benchmark/release outputs stable. |
| 6 | **Adaptive workspace profile design hook** | done on release/v1.16 | `init --dry-run` and `apply --dry-run` report supported stacks, unsupported tool signals, artifact-heavy workspaces, agent surfaces, and verification signals without adding standalone `discover` or `fragment draft` commands. Project-local fragment generation remains review-only and deferred. |
| 7 | **Snapshot and accessibility tests** | done on release/v1.16 | Added plain/color tests, no-color and forced-color coverage, compact help snapshot coverage, long-description wrapping tests, and compatibility assertions for the deprecated `update` path. |

Exit criteria:

- `anamnesis` with no command stays short enough to be useful as a guide, not
  a command encyclopedia.
- `anamnesis --help` shows grouped core commands first and does not dump every
  advanced benchmark/release flag by default.
- A full catalog remains available for maintainers and scripts.
- CLI upgrade, project apply preview, and project apply are distinct in
  command labels, help text, and next-step output.
- Common commands share a recognizable terminal layout with color enabled,
  color disabled, and JSON output all tested.
- Existing public commands still work or print a clear compatibility alias
  message.
- Non-code or unknown-tool project signals are handled through `init` and
  `apply --dry-run` planning, not by adding more top-level commands.

---

## v1.17 — *release cut 2026-07-10*

> **Theme: ontology source management, retrieval reminders, and document pointer diagnostics**

v1.16 made document-heavy and artifact-heavy workspaces visible in dry-run
output, but those signals are still advisory. The next gap is not a full wiki,
RAG database, or automatic prose-to-ontology importer. The gap is a bounded
source-management layer that helps agents find the right documents, detect
stale links or ontology references, and promote reviewed evidence into
`system_graph.yaml` or `.anamnesis/ontology/*.enriched.yaml`.

The important behavioral gap is not that anamnesis lacks another memory store.
It is that agents may forget to use the existing retrieval surface when the
compact startup context only gives source pointers. v1.17 should therefore
complete the loop:

1. compact SessionStart points to authoritative context sources;
2. agent remembers when to use `anamnesis context query`;
3. query returns the exact file/heading/ontology pointer to read;
4. the agent reads the source before making project claims or editing
   ontology/docs;
5. diagnostics and benchmarks prove the loop stayed fresh and compact.

Product boundary:

- Ontology remains the durable memory layer.
- Documents, specs, README files, and non-code artifacts are evidence sources,
  not a second source of truth.
- Context indexes are regenerable source-pointer maps, not authoritative
  knowledge stores.
- Document indexing is a routing aid for agents. It should tell the agent
  which file/heading/source pointer to read next; it should not replace the
  agent's judgment or preload more startup context.
- Retrieval reminders are advisory control-plane text. Hooks and rules should
  remind the agent to run `anamnesis context query` when project facts,
  ontology, prior decisions, roadmap, or document evidence are needed; they
  should not automatically run broad searches on every prompt.
- Command growth is now a product risk. The full catalog already has dozens of
  command/subcommand entries, so v1.17 work must stay under existing
  namespaces (`apply`, `status`, `doctor`, `context`, `handoff`,
  `benchmark`, `ontology bootstrap`) instead of adding new top-level commands.
- Generated benchmark reports and visualizations stay under
  `docs/benchmark-evidence/<suite>/`; README should link to concise evidence
  summaries instead of embedding chart galleries.
- Extracted candidates are review prompts. They must not become accepted
  ontology facts until an agent/user promotes them through the enrichment path.
- No SQLite, embedding store, daemon, remote sync service, or wiki UI.

Current baseline on `release/v1.17`:

- `context docs` scans Markdown roots and reports pages, headings, links,
  backlinks, canonical docs, and ontology source refs.
- `context index/query` now includes `doc-page`, `doc-heading`, and
  `doc-ontology-ref` records so agents can retrieve document source pointers
  without increasing SessionStart payload.
- `context query` detects missing or stale default indexes and rebuilds them in
  memory without writing; custom `--index` paths remain explicit.
- `context diagnose`, `status`, and `doctor` surface broken Markdown links,
  missing heading anchors, and stale ontology source refs.
- `status`, `doctor`, and `apply` now share a single ontology lifecycle
  recommendation that points users to the next existing action: managed
  `apply`, deterministic `ontology bootstrap`, or reviewed `/ontology-enrich`.
- Dogfood state for this repo is clean: `context docs` currently reports
  `broken=0` and `ontology refs missing=0`.
- Claude Code, Codex, and Cursor receive the same compact retrieval rule through
  managed project guidance, skills, commands, SessionStart pointers where
  supported, and subagent preambles. Prompt-time `UserPromptSubmit` injection
  is not enabled by default because the prompt gate still reports
  `collect-more-evidence` and duplicate-context risk.
- Separate-process subagents can receive `context subagent-preamble`;
  same-session native subagents still rely on leader-supplied prompt-contract
  evidence rather than guaranteed SessionStart hook execution.
- v1.16 already made `anamnesis`, `anamnesis --help`, and the common command
  reporters concise. `anamnesis --help --all` remains the maintainer escape
  hatch for the full catalog; v1.17 narrows default help further so advanced
  namespaces stay available through diagnostics, namespace help, or
  `--help --all` rather than the ordinary user path.

Why this still helps when the agent controls the work:

- The CLI should not decide project truth for the agent. It should provide a
  deterministic map of likely source files and headings so the agent can read
  exact evidence before editing ontology or docs.
- The main benefit is lower retrieval friction: fewer blind greps, fewer missed
  specs, and fewer stale document references entering future context.
- Success should be measured by source-pointer retrieval quality and diagnostic
  cleanliness, not by how much prose gets indexed or injected.

Suggested command surface stays under existing namespaces. Remaining work
should be ordered by retrieval value, not by every record type that could be
indexed:

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Document graph scanner** | complete on `release/v1.17` | Deterministically records Markdown pages, GitHub-compatible heading anchors, repo-relative links, backlinks, canonical docs, and ontology references across default and catalog-configured roots while excluding deprecated/generated evidence paths. |
| 2 | **Reviewable document catalog** | complete on `release/v1.17` | `.anamnesis/docs/catalog.yaml` supports project-contained roots, canonical documents, excludes, `ontology_reference_prefixes`, and the compatibility alias `allowed_ontology_reference_prefixes`. Invalid types and traversal paths produce typed warnings; a missing catalog stays informational for document-heavy workspaces. |
| 3 | **Minimal context query integration** | complete on `release/v1.17` | `doc-page`, `doc-heading`, and `doc-ontology-ref` records return exact source pointers without increasing SessionStart payload. `doc-link` and `doc-backlink` query records remain deferred because current retrieval evidence does not justify them. |
| 4 | **Query freshness and ranking hardening** | complete on `release/v1.17` | Missing/stale default indexes rebuild in memory without writes. Freshness compares content signatures as well as source presence, so preserved-mtime edits are detected. Ranking handles document-page and diagnostic intent, excludes stale handoffs from ordinary queries, and recovers closed/cold history only for explicit historical queries. |
| 5 | **Cross-agent retrieval reminder contract** | complete with prompt-time hook deferred | Base v20 installs the same pointer-first rule across AGENTS.md, CLAUDE.md, Claude Code, Codex, Cursor, and `context subagent-preamble`. The rule requires `context query` plus an exact source read. Native prompt-time injection remains deferred until repeated model runs satisfy the existing prompt gate; no unconditional reminder hook ships in v1.17. |
| 6 | **`context docs` summary** | complete on `release/v1.17` | `anamnesis context docs` remains read-only and provides concise human plus structured JSON summaries. No user-facing generated wiki or document rewrite path was added. |
| 7 | **Diagnostics and repair hints** | complete on `release/v1.17` | `context diagnose`, `status`, and `doctor` cover broken links/anchors, explicit missing ontology refs, stale handoff/context-index state, catalog problems, and missing artifact paths. Plain prose mentions and optional absent `system_graph.yaml` references do not create false warnings. Semantic stale-claim judgment stays in `doc-freshness-review`. |
| 8 | **Benchmark and fixture coverage** | complete on `release/v1.17` | `benchmark retrieval` v2 runs 18 mixed-kind cases without a kind filter: top-1 `18/18`, top-3 `18/18`, MRR `1.000`, compact SessionStart `206/800`, and safety checks `2/2` with zero stale-handoff or missing-ref top-3 leakage. Artifacts include per-stratum SVG, fixture hash, and a retrieval-module input hash; release preparation regenerates them after the version bump and publish rejects stale package provenance. Model behavior is explicitly unmeasured here; `benchmark task` now records actual query invocation, query-before-claim, and returned-pointer-followed observations. |
| 9 | **Ontology refresh pipeline without new commands** | complete on `release/v1.17` | `status` / `doctor` detect Layer A/Layer B gaps and invalid source refs, while `apply`, `status`, and `doctor` share one next-action recommendation. Deterministic refresh stays under `ontology bootstrap`; semantic writes stay reviewed through `/ontology-enrich`. |
| 10 | **Progressive command disclosure hardening** | complete on `release/v1.17` | Ordinary help stays on `init`, `apply`, `status`, `doctor`, and `upgrade`; advanced namespaces remain available through namespace help and `--help --all`. No new top-level command was added. |

Implementation notes:

- Reuse the existing context-index style: repo-local JSON/JSONL, stable refs,
  source hashes, snippets, and deterministic sorting.
- Keep indexed snippets short and pointer-oriented. The index should answer
  "where should the agent read next?", not "what is the whole project memory?".
- Keep the document graph separate from Layer A framework introspectors.
  Layer A remains deterministic project facts; document graph records source
  structure and candidate pointers.
- `apply` currently refreshes managed surfaces and static ontology slices, while
  `init` runs default ontology bootstrap. Any v1.17 copy must keep that
  distinction clear unless the implementation explicitly changes it.
- `doc-freshness-review` remains the semantic second pass for claims the CLI
  cannot prove. Deterministic diagnostics should flag evidence and pointers,
  not pretend to know product intent.
- Do not implement `doc-link` / `doc-backlink` search records just because the
  scanner can compute them. Keep them diagnostic-first until repeated usage
  shows they reduce retrieval misses.
- Retrieval reminders must be small and conditional. They should say when to
  use `context query`, not paste query results or run searches automatically.
- Treat generated `.anamnesis/context/index.jsonl` as a cache. Query should
  detect stale cache state or rebuild from current sources instead of returning
  stale pointers silently.
- Same-session native subagents should be handled by leader prompt contracts
  until a real runtime hook proves automatic injection.
- Do not introduce a new command for ontology refresh. Fold freshness detection
  into `status` / `doctor`, deterministic refresh into existing
  `ontology bootstrap`, semantic review into `/ontology-enrich`, and source
  discovery into `context query` / `context docs`.
- Default help should remain a guided short path. Any new implementation under
  `context`, `benchmark`, `handoff`, or `ontology` must be reachable from
  diagnostics or `--help --all` without making the no-command guide noisy.

Deferred from v1.17:

- **Ontology candidate bridge**: do not build free-form prose mining in this
  release. At most, update `/ontology-enrich` guidance so agents use
  `context query` / `context docs` to find source headings before writing
  reviewed `.enriched.yaml` entries.
- **Apply/init document integration**: do not make `init` or `apply` crawl docs
  into ontology or materialize document-derived meaning. Keep first-run and
  maintenance UX under explicit `context` commands and dry-run diagnostics.
- **New top-level refresh/sync/wiki commands**: do not add command names for
  work that can be expressed as existing `apply`, `status`, `doctor`,
  `context`, `handoff`, `benchmark`, or `ontology bootstrap` behavior.
- **`doc-link` / `doc-backlink` query records**: keep diagnostic metadata only
  until benchmarks show they improve top-1 retrieval by at least 10 percentage
  points or reduce context tool turns by at least 25% over the
  page/heading/ontology-ref baseline.

Exit criteria:

- Existing `init`, `apply`, `status`, `doctor`, `context`, and
  `ontology bootstrap` behavior remains backward compatible.
- Document graph diagnostics catch broken internal links and invalid ontology
  refs in public-safe fixtures.
- `status` summarizes document graph health without dumping large file lists.
- `doctor` gives actionable repair guidance without making document-heavy repos
  look broken by default.
- `context index/query` can retrieve high-signal document source pointers
  relevant to an ontology enrichment task, starting with pages, headings, and
  ontology refs.
- `context query` detects or avoids stale generated indexes and ranks active
  ontology/handoff/task/doc pointers ahead of cold or deprecated history unless
  the user explicitly searches historical context.
- Claude Code, Codex, and Cursor receive equivalent managed retrieval rules;
  SessionStart pointers and subagent preambles carry the same contract where
  supported. Prompt-time hook injection remains gated and is not a v1.17
  default.
- Deterministic retrieval evidence reports ranking and leakage only. Model-run
  task benchmarks can now record whether agents call `context query`, query
  before claiming, and follow returned source pointers.
- `/ontology-enrich` guidance can use the document source pointers while still
  writing semantic facts only to `.enriched.yaml` or user-managed ontology.
- Ontology refresh feels automatic from the user's perspective: stale facts are
  detected by diagnostics, exact source pointers are suggested, deterministic
  bootstrap refresh is explicit, and semantic enrichment remains reviewed.
- The common command surface does not grow. `anamnesis` and `anamnesis --help`
  stay focused on the short path, while `--help --all` keeps the complete
  catalog for maintainers and scripts.
- Default SessionStart context does not grow; only compact summaries and source
  pointers are eligible for startup injection.
- Benchmarks record numeric evidence for doc graph readiness and retrieval
  usefulness before public claims are added.
- New benchmark visualizations are discoverable from
  `docs/benchmark-evidence/README.md` without turning the top-level README into
  an artifact gallery.

---

## v1.18 — *in progress*

> **Theme: evidence-backed work-unit continuity across long agent runs**

### Codex native hook trust boundary

The current unreleased line also closes a runtime safety gap in Codex hook
installation. `status` and `doctor` distinguish local registration from
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

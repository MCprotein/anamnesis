# Roadmap

Version-by-version plan. Brief summary lives in [README.md](../README.md);
this file is the canonical source.

Pre-1.0 semantics: minor version bumps may include breaking changes until
v1.0. Feature timing is best-effort; items can move between releases as
verified feedback arrives.

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
| 7 | **Trusted Publishing setup** | workflow shipped in 0.4.2; OIDC unresolved | GitHub Actions workflow + documented npm Trusted Publisher config shipped. `0.4.3` was published with local npm owner credentials. `v0.4.4` proved the tag workflow reaches `npm publish`, but npm OIDC still returns E404 despite apparently correct trusted-publisher settings. Manual npmjs.org publish remains the supported fallback until npm/GitHub OIDC matching is resolved. |
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
- GitHub Actions reached `npm publish`, but npm OIDC exchange/publish still failed with E404

**Remaining 0.4.x operational task:**
- Keep the manual npmjs.org owner-token publish fallback documented and available.
- Revisit npm Trusted Publishing only when new evidence or npm/GitHub behavior changes; do not block feature work on OIDC.

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
- 2026-04-30: Ran the first sanitized-fixture dogfood matrix on `sanitized-nest-prisma`,
  `sanitized-nextjs-frontend`, and `sanitized-nest-k8s` git-archive snapshots. Fresh Next.js
  and NestJS+k8s installs reached continuity `6/6`; the existing managed
  backend exposed a repair/review gap around user-modified native surfaces.
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
- 2026-05-03: Ran the first v0.6 sanitized-fixture ontology before/after dogfood on
  a `sanitized-nest-prisma@e19fc0d` archive snapshot. Static-only ontology had 2
  ontology warnings and no bootstrap/enriched files; after bootstrap plus
  agent enrichment, ontology warnings dropped to 0, with 10 Prisma models, 7
  NestJS controllers, 30 routes, and 21 semantic Layer B entries captured.
- 2026-05-03: Resolved the first dogfood-proven deterministic Layer A gap by
  adding NestJS `@Sse()` route extraction. A follow-up
  `sanitized-nest-prisma@e19fc0d` archive bootstrap now records
  `/notifications/stream`, and NestJS route facts increased from 30 to 31.

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

## v0.7 — *planned*

> **Theme: harden multi-agent UX and lifecycle scale**

| # | Item | Description |
|---|---|---|
| 1 | **Adapter parity matrix** | Publish and test a matrix for each capability (`project_memory`, `ontology`, `executable_hook`, `skill`, `slash_command`) across Claude Code, Codex, Cursor, and any new supported adapter. |
| 2 | **Switching-agent scenarios** | Exercise the full ordered 3x3 handoff matrix across Claude Code, Codex, and Cursor, including same-agent restarts, with active handoff files and stale-handoff detection. |
| 3 | **Native-surface improvements** | Where a tool offers a better native surface, use it; where it does not, keep fallback instructions explicit and testable. |
| 4 | **Lifecycle hardening** | Reduce surprises around pinned fragments, user-modified regions, backups, declined suggestions, and multi-scope updates as projects evolve. |
| 5 | **Public UX docs** | Document the expected user journey for "install once, switch agents, continue work" with limitations per adapter. |
| 6 | **Ontology refresh workflow hardening** | Turn the v0.6 bootstrap/enrichment path into a reliable lifecycle workflow: detect stale facts, prompt or route agent enrichment, preserve reviewed semantics, and keep all adapter entrypoints pointing at the same context. |
| 7 | **Benchmark/report command** | Add a repeatable benchmark surface that measures static-only vs bootstrap vs enriched context on sanitized fixture snapshots. Candidate metrics: context recall score, question reduction, time-to-first-correct-action, handoff continuity, ontology coverage, and diagnostic quality. Output should be suitable for `docs/BENCHMARKS.md` and a compact README "sanitized fixture evidence" section. |

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

Exit criteria:
- Switching agents preserves project memory, ontology access, handoff
  continuity, and operational reminders in normal workflows.
- Known adapter gaps are documented as tool-surface limitations, not hidden behavior.
- At least one benchmark report compares before/after context quality on a
  sanitized fixturesitory without requiring proprietary or credential-bearing source
  snippets in public docs.

---

## v1.0 — *stable / public-ready*

> **Theme: lock the surface, open to community**

| # | Item | Description |
|---|---|---|
| 1 | **Frozen Agentfile schema** | No more breaking changes after this. Strict semver from v1.0 forward. |
| 2 | **Public fragment registry** | Discovery site + search (e.g., registry.anamnesis.dev). Fragment authors can publish under their scope. |
| 3 | **Fragment signing & checksums** | Supply-chain hardening. Fragments cryptographically signed; consumers verify. |
| 4 | **Stable TypeScript API** | `import { ... } from "@mcprotein/anamnesis"` exports become semver-stable. |
| 5 | **Official docs site** | Full guide, API reference, examples (anamnesis.dev or similar). |
| 6 | **Migration tooling** | `anamnesis migrate` for moving between Agentfile schema versions when those change. |

---

## Cross-cutting items (no specific version yet)

These have been discussed but lack concrete version assignment:

- **Project type templates** — `init --template react-app` style scaffolding for first-time users
- **Fragment dependency resolution** — current `requires` is just topo sort; could grow to semver constraint solving
- **`anamnesis sync`** — pull latest library changes from a remote git source (vs current "just edit fragments/ in this repo")
- **WebUI for Agentfile editing** — visual editor for non-CLI users
- **Webhook on fragment update** — notify projects when their installed fragments have library updates
- **Public benchmark gallery** — after the v0.7 benchmark/report command
  stabilizes, collect sanitized before/after reports across multiple public
  repo shapes and surface the headline evidence in README/docs.

---

## Changing the plan

Versions move based on verified signal. If a planned item turns out to
be hard or low-value, it gets bumped. If a v0.4 item becomes urgent (e.g.,
heavy daily use of agent-handoff), it can move into v0.3.

When the plan changes, update this file in the same commit.

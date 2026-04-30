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

## v0.5 — *planned*

> **Theme: prove automatic context continuity across real agent switches**

v0.5 is not primarily an introspector expansion release. The next risk is
whether the tool actually fulfills its main promise in day-to-day use:
install once, keep context/ontology current, and switch agents without
manual re-briefing.

| # | Item | Description |
|---|---|---|
| 1 | **Dogfood lifecycle matrix** | Run current anamnesis against sanitized managed fixtures and record `init/update/status/doctor/ontology bootstrap/handoff` behavior per repo and adapter. Candidate repos stay dogfood-driven, not framework-completion driven. |
| 2 | **Agent-switch acceptance fixtures** | Add tests/fixtures for the same Agentfile rendered to Claude Code, Codex, and Cursor, then assert that project memory, ontology instructions, handoff startup instructions, and operational guardrails are present in each output. |
| 3 | **Session-start continuity contract** | Make the "new agent starts here" contract explicit and testable: read managed context, read ontology, read latest/active handoff, detect stale handoff, then continue without the user giving extra instructions. |
| 4 | **Actionable `status`/`doctor` output** | Improve diagnostics so a user can tell whether context, ontology, handoff, fragments, pinned versions, and adapter render targets are installed and current. |
| 5 | **README/guide alignment** | Update user-facing docs around the two product promises: context/ontology injection and agent switching continuity. Avoid presenting framework introspection as the main product. |
| 6 | **Release fallback normalization** | Keep npmjs.org manual publish fallback documented while OIDC remains unresolved, so release operations do not block lifecycle work. |
| 7 | **Introspector API review, not expansion** | Audit the current k8s/prisma/nextjs/nestjs/fastapi introspector interface for accidental coupling, but defer new framework work unless dogfood evidence shows a real gap. |

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

Exit criteria:
- A fresh agent can enter a managed project through each supported adapter
  and find the same current context, ontology, handoff state, and guardrails
  without a bespoke user prompt.
- `status`/`doctor` can identify missing or stale context-continuity pieces.
- The next implementation task is chosen from dogfood evidence, not from
  a framework catalog wishlist.

---

## v0.6 — *planned*

> **Theme: deepen ontology automation where dogfood shows gaps**

| # | Item | Description |
|---|---|---|
| 1 | **Ontology gap reports** | Use dogfood runs to identify which missing ontology facts actually make agents less effective. Prioritize gaps in existing sanitized fixtures before adding broad framework coverage. |
| 2 | **Layer B enrichment lifecycle** | Define how `/ontology-enrich` re-runs should merge, replace, or diff semantic notes so agent-curated ontology can evolve safely. |
| 3 | **Ontology drift in `status`** | Report when project files imply bootstrap facts have changed and `.bootstrap.yaml` should be regenerated. |
| 4 | **Output schema stabilization** | Stabilize enough bootstrap/enriched YAML conventions for agents and docs to rely on them. |
| 5 | **Targeted introspector improvements** | Improve existing introspectors or add a new one only when dogfood evidence shows clear context value. Priority examples are deeper NestJS/Prisma relations, Kubernetes service/workload links, or frontend route ownership. |
| 6 | **Layer A / Layer B boundary docs** | Clarify which facts are parser-derived and which semantic relationships should remain agent-enriched. |

Exit criteria:
- Agents get materially better project understanding from regenerated
  ontology in at least one sanitized managed fixture.
- Ontology refresh and enrichment are safe enough to run repeatedly during
  normal project lifecycle work.

---

## v0.7 — *planned*

> **Theme: harden multi-agent UX and lifecycle scale**

| # | Item | Description |
|---|---|---|
| 1 | **Adapter parity matrix** | Publish and test a matrix for each capability (`project_memory`, `ontology`, `executable_hook`, `skill`, `slash_command`) across Claude Code, Codex, Cursor, and any new supported adapter. |
| 2 | **Switching-agent scenarios** | Exercise realistic handoffs: Claude → Codex, Codex → Cursor, Cursor → Claude, with active handoff files and stale-handoff detection. |
| 3 | **Native-surface improvements** | Where a tool offers a better native surface, use it; where it does not, keep fallback instructions explicit and testable. |
| 4 | **Lifecycle hardening** | Reduce surprises around pinned fragments, user-modified regions, backups, declined suggestions, and multi-scope updates as projects evolve. |
| 5 | **Public UX docs** | Document the expected user journey for "install once, switch agents, continue work" with limitations per adapter. |

Exit criteria:
- Switching agents preserves project memory, ontology access, handoff
  continuity, and operational reminders in normal workflows.
- Known adapter gaps are documented as tool-surface limitations, not hidden behavior.

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

---

## Changing the plan

Versions move based on verified signal. If a planned item turns out to
be hard or low-value, it gets bumped. If a v0.4 item becomes urgent (e.g.,
heavy daily use of agent-handoff), it can move into v0.3.

When the plan changes, update this file in the same commit.

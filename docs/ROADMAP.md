# Roadmap

Version-by-version plan. Brief summary lives in [README.md](../README.md);
this file is the canonical source.

Pre-1.0 semantics: minor version bumps may include breaking changes until
v1.0. Feature timing is best-effort; items can move between releases as
verified feedback arrives.

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

> **Theme: freeze the extension surface for ontology generation and adapter parity**

v0.5 is not the "all frameworks are deeply understood" release. It is the
release that makes future framework support cheap and consistent.

| # | Item | Description |
|---|---|---|
| 1 | **Introspector author SDK docs** | Document the `Introspector` contract, stable output expectations, filesystem constraints, fixture shape, and how fragment authors add deterministic Layer A facts. |
| 2 | **Introspector API freeze candidate** | Review current k8s/prisma/nextjs/nestjs/fastapi introspectors and remove accidental coupling before external fragments rely on the interface. |
| 3 | **One more framework introspector** | Add at least one non-JS or convention-heavy introspector (candidate: Rails, Django, Go, or Rust) to validate the extension surface before freezing it. |
| 4 | **Cross-agent parity fixtures** | Add fixture/snapshot coverage proving that the same capability IR produces equivalent user-facing behavior across Claude Code, Codex, and Cursor renderers. |
| 5 | **Parity vocabulary** | Document that anamnesis targets user-facing parity, not impossible 1:1 native UI parity. Claude slash commands/hooks, Codex AGENTS.md/git-hook bridges, and Cursor rules can differ internally as long as the same project memory, ontology, handoff, and safety intent are available. |
| 6 | **Ontology output stability** | Stabilize bootstrap YAML conventions enough for agents and future docs to rely on them without treating every field as provisional. |

Exit criteria:
- New fragment authors can implement a deterministic ontology bootstrap without reading internal code first.
- Existing adapters have parity snapshots for the core capabilities.
- The next framework introspector does not require changing the public `Introspector` shape.

---

## v0.6 — *planned*

> **Theme: expand deterministic ontology coverage**

| # | Item | Description |
|---|---|---|
| 1 | **Framework introspector catalog** | Add deterministic Layer A introspectors for high-signal fragments beyond the current set. Priority candidates: Rails, Django, Go services, Rust, SvelteKit, Remix, and Nuxt. |
| 2 | **Fixture corpus** | Maintain small sanitized-fixture-like fixtures per introspector so route/model/service extraction stays stable. |
| 3 | **Layer A / Layer B boundary docs** | Clarify which facts are parser-derived and which semantic relationships should remain agent-enriched. |
| 4 | **Monorepo ontology hardening** | Stress-test mixed-stack multi-scope projects so generated ontology remains scope-local, stable-sorted, and non-duplicative. |

Exit criteria:
- New framework support is mostly additive: fragment + introspector + fixtures + rulebook.
- Common full-stack monorepos produce useful bootstrap ontology before any LLM enrichment.

---

## v0.7 — *planned*

> **Theme: cross-agent UX hardening**

| # | Item | Description |
|---|---|---|
| 1 | **Adapter parity matrix** | Publish and test a matrix for each capability (`project_memory`, `ontology`, `executable_hook`, `skill`, `slash_command`) across Claude Code, Codex, and Cursor. |
| 2 | **Dogfood parity scenarios** | Run the same project through all supported adapters and compare installed files, instructions, handoff behavior, and update drift reports. |
| 3 | **Native-surface improvements** | Where a tool offers a better native surface, use it; where it does not, keep fallback instructions explicit and testable. |
| 4 | **UX acceptance criteria** | Define "same user experience" as equivalent project recall, safety reminders, ontology access, and handoff continuity, not byte-for-byte identical UI controls. |

Exit criteria:
- Switching agents preserves project memory, ontology access, handoff continuity, and operational reminders in normal workflows.
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

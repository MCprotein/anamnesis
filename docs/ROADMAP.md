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

## v0.4 — *shipped 2026-04-29; 0.4.1 shipped 2026-04-30*

> **Theme: agent continuity at scale + operational polish + project introspection**

Design: [`docs/ONTOLOGY-BOOTSTRAP.md`](ONTOLOGY-BOOTSTRAP.md)

| # | Item | Status | Description |
|---|---|---|---|
| 1 | **Hybrid ontology bootstrap** | shipped in 0.4.0; expanded in 0.4.1 | **Layer A** (deterministic CLI introspectors): `anamnesis ontology bootstrap` writes `.anamnesis/ontology/<id>.bootstrap.yaml`. ✓ k8s (namespaces/services/ingresses/workloads). ✓ prisma (datasources/generators/models/enums). 0.4.1 adds ✓ nextjs, ✓ nestjs, ✓ fastapi, plus multi-scope scope-local output and `--scope`. **Layer B** (agent-driven `/ontology-enrich` skill, base v5): shipped via the existing skill pipeline for Claude Code, Codex, and Cursor. **`init` auto-bootstrap**: shipped; `init` runs bootstrap after fragment install (`--no-bootstrap` opt-out). |
| 2 | **Handoff auto-trigger** | implemented, pending patch release | Claude Code `Stop` hook reminds agents to run `/handoff-prepare` when uncommitted work is newer than the latest handoff. |
| 3 | **Multi-task handoff tracking** | implemented, pending patch release | `/handoff-prepare` writes `.anamnesis/handoff/active.md` plus timestamped archives. Session start injection reads the active index first, then the latest archive. |
| 4 | **`anamnesis doctor`** | implemented, pending patch release | Read-only installation integrity check: manifest errors, tracked file/region drift, missing library fragments, update warnings, adapter coverage gaps, and `.claude/settings.json` hook registration drift. |
| 5 | **Full version pinning** | implemented, pending patch release | Fragment version cache so `pinned: true` renders the pinned version, not library-current. Library stores past versions under `base/.versions/<version>/` or `fragments/<id>/.versions/<version>/`. |
| 6 | **`anamnesis update --bump-pinned`** | implemented, pending patch release | Explicitly bump pinned fragments after manual review while keeping them pinned. Companion to #5. |
| 7 | **Trusted Publishing setup** | planned | GitHub Actions workflow + npm trust config so future releases don't need manual tokens. |
| 8 | **Fragment catalog expansion** | planned | Ruby on Rails, Django, Go services, Rust, plus more JS frameworks (sveltekit, remix, nuxt). |
| 9 | **Codex hook auto-wiring** | planned | Git pre-commit installer for executable_hook in Codex adapter (deferred from v0.3). Currently Codex agents read region instructions manually. |
| 10 | **Aider/Windsurf adapters (optional)** | optional | If community demand justifies. Same content+capabilities IR, different render targets. |
| 11 | **`anamnesis status --json`** | implemented, pending patch release | Structured output for CI integration. |

**Shipped in 0.4.1 patch:**
- nextjs introspector (App Router + Pages Router routes)
- nestjs introspector (`@Controller` / route method decorators)
- fastapi introspector (`@app.*` + `@router.*`)
- multi-scope bootstrap (per-scope ontology output + `--scope`)

**Targeted for next 0.4.x patch:**
- base v6 handoff continuity (`active.md` + Stop reminder) — implemented, pending patch release
- `anamnesis doctor` — implemented, pending patch release
- `anamnesis status --json` — implemented, pending patch release
- full version pinning + `update --bump-pinned` — implemented, pending patch release

**Moved to v0.5:**
- Introspector author SDK docs and API freeze, after at least one more
  framework introspector validates the extension surface.

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

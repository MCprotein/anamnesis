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

## v0.3 — *in progress*

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

## v0.4 — *planned*

> **Theme: agent continuity at scale + operational polish + project introspection**

| # | Item | Description |
|---|---|---|
| 1 | **Hybrid ontology bootstrap** | Two-layer auto-generation of `.anamnesis/ontology/<id>.yaml`. **Layer A** (deterministic, CLI): `anamnesis ontology bootstrap` runs fragment-specific introspectors — k8s parses `k8s/**/*.yaml` for namespace/service/port, prisma parses `schema.prisma` for model/relation, nextjs walks `app/` for routes, fastapi/nestjs reflect routers. Output: facts auto-populated, no LLM, no agent. **Layer B** (agent-driven, skill): `/ontology-enrich` skill (rendered per adapter) instructs the active agent to read the bootstrap output + project manifests and fill in semantic relationships, flows, and operational notes that parsers can't extract. Result: fragment-shipped static template + project-specific facts + LLM-inferred semantics, all in one ontology slice. Companion: fragment-author SDK for `Introspector` interface so community fragments can ship their own parsers. |
| 2 | **Handoff auto-trigger** | Detect token usage approaching limit, automatically suggest `/handoff prepare`. Or run on session-end hook. |
| 3 | **Multi-task handoff tracking** | `.anamnesis/handoff/active.md` + archive. Multiple in-flight tasks distinguishable. |
| 4 | **`anamnesis doctor`** | Installation integrity check: hash mismatches, missing files, adapter coverage gaps, settings.json drift. |
| 5 | **Full version pinning** | Fragment version cache so `pinned: true` renders the pinned version, not library-current. Library stores past versions under `fragments/<id>/.versions/`. (Moved from v0.3 — low value while user base is small.) |
| 6 | **`anamnesis update --bump-pinned`** | Explicitly bump pinned fragments after manual review. Companion to #5. |
| 7 | **Trusted Publishing setup** | GitHub Actions workflow + npm trust config so future releases don't need manual tokens. |
| 8 | **Fragment catalog expansion** | Ruby on Rails, Django, Go services, Rust, plus more JS frameworks (sveltekit, remix, nuxt). |
| 9 | **Codex hook auto-wiring** | Git pre-commit installer for executable_hook in Codex adapter (deferred from v0.3). Currently Codex agents read region instructions manually. |
| 10 | **Aider/Windsurf adapters (optional)** | If community demand justifies. Same content+capabilities IR, different render targets. |
| 11 | **`anamnesis status --json`** | Structured output for CI integration. |

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

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

## v0.3 — *planned*

> **Theme: complete the multi-tool promise + monorepo UX polish**

| # | Item | Description |
|---|---|---|
| 1 | **Cursor adapter** | `.cursor/rules/*.mdc` output. Use `alwaysApply`/glob `description` metadata. New `scoped_rule` capability for Cursor's nested rules. |
| 2 | **Codex adapter completion** | Fallbacks for `executable_hook` (git pre-commit + AGENTS.md instruction), `skill` (AGENTS.md section), `slash_command` (AGENTS.md instruction). Lets Codex-only users get hook-equivalent behavior. |
| 3 | **Full version pinning** | Fragment version cache so `pinned: true` actually renders the pinned version, not library-current. Library stores past versions under `fragments/<id>/.versions/`. |
| 4 | **Init multi-scope detect** | `init --interactive` (or default for monorepos) detects `apps/*`, `packages/*`, `services/*` patterns and proposes a multi-scope Agentfile structure. Lifts the v0.2 hand-edit burden. |
| 5 | **`status` per-scope** | When monorepo, group drift output by scope (`apps/api: 2 user-modified`, etc.) instead of flat list. |
| 6 | **`anamnesis update --bump-pinned`** | Explicitly bump pinned fragments after manual review. Companion to #3. |

### v0.3 *handoff MVP* (late v0.3, can split into 0.3.x patch)

| # | Item | Description |
|---|---|---|
| 7 | **`/handoff prepare` slash command** | Departing agent writes a structured markdown to `.anamnesis/handoff/<ISO-ts>.md` capturing: current task, completed steps (with commit refs), in-flight files + intent, decisions, open blockers. |
| 8 | **SessionStart handoff injection** | New session reads the most recent handoff file and injects into context. CC uses native SessionStart hook; Codex/Cursor read via AGENTS.md instruction. |
| 9 | **Cross-adapter parity** | Same handoff file format consumed by all three adapters. Tool-agnostic handoff content. |

---

## v0.4 — *planned*

> **Theme: agent continuity at scale + operational polish**

| # | Item | Description |
|---|---|---|
| 1 | **Handoff auto-trigger** | Detect token usage approaching limit, automatically suggest `/handoff prepare`. Or run on session-end hook. |
| 2 | **Multi-task handoff tracking** | `.anamnesis/handoff/active.md` + archive. Multiple in-flight tasks distinguishable. |
| 3 | **`anamnesis doctor`** | Installation integrity check: hash mismatches, missing files, adapter coverage gaps, settings.json drift. |
| 4 | **Trusted Publishing setup** | GitHub Actions workflow + npm trust config so future releases don't need manual tokens. |
| 5 | **Fragment catalog expansion** | Ruby on Rails, Django, Go services, Rust, plus more JS frameworks (sveltekit, remix, nuxt). |
| 6 | **Aider/Windsurf adapters (optional)** | If community demand justifies. Same content+capabilities IR, different render targets. |
| 7 | **`anamnesis status --json`** | Structured output for CI integration. |

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

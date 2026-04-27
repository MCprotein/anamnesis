# Changelog

All notable changes to anamnesis are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
the project uses pre-1.0 semantics — minor version bumps may include
breaking changes until v1.0.

## [0.1.0] — 2026-04-26 *(unreleased — daily-use alpha)*

First daily-use release. Validated on 4 repositories (anamnesis itself
plus 3 user projects across infra / ML / NestJS stacks).

### Added

#### Core
- `Agentfile` (v1 schema) — declarative project manifest. Lists installed
  fragments, target tools, declined suggestions, locked regions/files.
- `.anamnesis/manifest.json` — region/file hash tracking with 6-field
  entries (`base_rendered_hash`, `last_applied_hash`, `current_user_hash`,
  fragment id/version, template version, params).
- Region anchor parser (`<!-- anamnesis:region id=… fragment=…@n -->`):
  parse, render, upsert, remove, byte-perfect roundtrip.
- Fragment loader with topological sort (`requires`) and conflict
  detection.
- `triggers.ts`: TriggerExpr DSL (atoms `package_json_has`, `pyproject_has`,
  `file_exists`, `dir_exists`, `any_yaml_contains` + combinators
  `any`, `all`).
- `rulebook.ts`: markdown rulebook parser with code-fence skipping.
- `applier.ts`: planning + applying with 5 statuses
  (`create`, `update`, `noop`, `user-modified`, `blocked`).
  In-flight file text tracking handles multiple regions per file.
- Backup-before-apply to `.anamnesis/backups/<ISO-timestamp>/`.

#### Adapters
- Claude Code adapter for all 5 capabilities
  (`project_memory`, `ontology`, `executable_hook`, `skill`, `slash_command`).
- `RendererRegistry` — adapter-scoped, isolation-friendly.

#### Commands
- `init`: rulebook → suggestions → install. Auto-includes `base`.
- `update`: dry-run by default; `--apply` writes. Reports
  `suggested` (new rule matches) without auto-installing.
  Auto-bumps fragment versions in `Agentfile` on apply.
- `promote`: lift a project-local file into the library as a fragment
  capability. Supports `executable_hook`, `slash_command`, `skill`,
  `ontology` (project_memory deferred to v0.2).

#### Fragments (library)
- `base` — always-included baseline (5 capabilities).
- `prisma` — Prisma ORM operational rules + schema validation hook.
- `k8s` — Kubernetes guardrails + YAML lint hook.
- `nestjs` — NestJS layering, DI, validation pipeline.
- `python-uv` — `uv` workflow rules.
- `fastapi` — Pydantic + Depends + async-first conventions.

#### Safety
- `--allow-exec-adapters` flag gates `.claude/{hooks,commands,skills}/`
  writes (supply-chain protection).
- Files on disk without manifest entries are classified as
  `user-modified` and never overwritten.
- `update` is dry-run by default.

### Coverage

229 tests across 18 test files. Categories:
- Agentfile / manifest / regions / fragments / triggers / rulebook (151)
- Render IR + 5 capability renderers (32)
- applier (29)
- init / update / promote (47)

### Known gaps (v0.2 targets)

- Fragment `pinned: true` preserves Agentfile entries across `update`
  but rendering still uses library-current versions. Full pinning
  requires a fragment version cache.
- Codex / Cursor adapters not yet implemented.
- `settings.json` formatting (indent style) is normalized to 2-space
  on first auto-write — user's prior indent choice is overwritten.
  Detect-and-preserve is a v0.2 polish item.
- Monorepo `scopes` rejected by Agentfile validator in v0.1; deferred to v0.2.
- `promote` does not yet support `project_memory` (region extraction
  from AGENTS.md). v0.2 target.

### Resolved (post-initial v0.1.0 cut)

- ~~`.claude/settings.json` not auto-updated when hooks are installed~~
  — fixed by post-apply hook registration sync. CC executable_hook
  capability now also updates `settings.json` idempotently. Older
  installs without registrations self-heal on the next `update --apply`.
- ~~`status` command~~ — added; reads Agentfile + manifest + library,
  reports installed fragments (in-sync / update-available / pinned /
  library-missing), per-region and per-file drift (clean / user-modified
  / missing), suggested rulebook matches, and declined entries.
- ~~`nextjs` and `docker-compose` fragments are stubs~~ — both now
  shipped (project_memory + ontology). All 8 rulebook rules now have
  fragment implementations.

### Repository policy

The repository is public. All committed fragments and tests use
synthetic data. Personal data (IPs, hostnames, user paths, internal
identifiers) does not appear in any committed file.

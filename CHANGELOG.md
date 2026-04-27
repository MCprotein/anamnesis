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
- ~~`settings.json` indent style normalized to 2-space on auto-write~~
  — fixed via `detectIndent()` in `core/settings.ts`. `writeSettings`
  now reads the existing file (if any), detects 2-space / 4-space / tab
  indent, and preserves it on rewrite. New files default to 2-space.
- ~~`promote` does not support project_memory~~ — added in v0.2.
  `anamnesis promote <source.md> --as=<id> --type=project_memory
  [--region=<id>]`. When the source contains an anamnesis region with
  the named id (e.g. promoting from an existing AGENTS.md), the region's
  inner content is extracted and the surrounding user prose is left
  behind. Otherwise the whole file becomes the snippet.
- ~~Monorepo `scopes` rejected by Agentfile validator~~ — multi-scope
  layouts now supported. Each scope can `extends` a parent and
  `overrides.{tools, fragments_add, fragments_remove}`. project_memory
  + ontology render to scope-relative paths (`apps/api/AGENTS.md`,
  `apps/api/.anamnesis/ontology/`); exec adapters (hooks/commands/skills)
  remain at project root because Claude Code's `settings.json` is read
  only at root. Base SessionStart hook walks `.anamnesis/ontology/`
  recursively so all sub-scope ontologies are injected. base fragment
  bumped to v2 to ship the recursive walk + scope-aware load-context
  skill/command.

### Repository policy

The repository is public. All committed fragments and tests use
synthetic data. Personal data (IPs, hostnames, user paths, internal
identifiers) does not appear in any committed file.

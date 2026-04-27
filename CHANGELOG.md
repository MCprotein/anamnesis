# Changelog

All notable changes to anamnesis are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
the project uses pre-1.0 semantics — minor version bumps may include
breaking changes until v1.0.

## [0.2.0] — 2026-04-27

Multi-tool, multi-scope. anamnesis now produces context for both Claude
Code and Codex, supports monorepo layouts, ships a `status` reporter,
and rounds out the fragment catalog.

### Added

- **`status` command** — read-only project state report. Lists installed
  fragments (`in-sync` / `update-available` / `pinned` / `library-missing`),
  per-region and per-file drift (`clean` / `user-modified` / `missing`),
  suggested rulebook matches, declined entries.
- **Codex adapter** (minimum scope) — `project_memory` + `ontology`
  capabilities. Codex reads AGENTS.md natively; the same content
  rendered for Claude Code is emitted when `codex` is listed in
  `Agentfile.tools`. Concurrent CC + Codex emissions are deduped by
  target identity. Hook / skill / slash-command fallbacks remain v0.3.
- **Monorepo `scopes` support** — multi-scope `Agentfile.project.scopes`
  layouts with `extends` chains and `overrides.{tools, fragments_add,
  fragments_remove}`. project_memory + ontology write to scope-relative
  paths; exec adapters stay at project root (Claude Code reads
  `settings.json` only at root).
- **`promote` supports `project_memory`** — promote a markdown file or
  extract a named region from AGENTS.md into a new fragment via
  `--type=project_memory [--region=<id>]`.
- **`nextjs` + `docker-compose` fragments** shipped. All 8 rulebook
  rules now resolve to a real fragment.
- **`.claude/settings.json` auto-registration** — `executable_hook`
  capabilities install the hook script AND register it in settings.json
  with idempotent JSON-structural merge. Older anamnesis installs
  self-heal on the next `update --apply`. Indent style of the existing
  settings.json file is detected and preserved (2-space / 4-space / tab).
- **`scope.ts` core module** — `effectiveScopes(agentfile)` resolves
  multi-scope inheritance and overrides into per-scope effective
  configs. v0.1 single-scope and `[- path: .]` Agentfiles map to a
  single root scope (back-compat).
- **base fragment v2** — `inject-ontology.sh` SessionStart hook now
  walks `**/.anamnesis/ontology/*.yaml` recursively for monorepo
  awareness. `load-context` skill and slash command updated to mention
  scoped ontology directories.

### Tests

299 passing across 22 test files (was 229 in v0.1).

### Known gaps (v0.3 targets)

- Codex adapter for `executable_hook`, `skill`, `slash_command` —
  silently skipped on Codex today. v0.3 plan: AGENTS.md instruction
  text + git pre-commit hook fallback.
- Cursor adapter (`.cursor/rules/*.mdc`) — not yet started.
- Full `pinned` semantics — currently `pinned: true` preserves the
  Agentfile entry across `update` but rendering still uses
  library-current content. Real pinning needs a versioned fragment
  cache.

---

## [0.1.0] — 2026-04-26

First daily-use release. Validated on 4 repositories (anamnesis itself
plus 3 user projects across infra / ML / NestJS stacks).

### Added

#### Core
- `Agentfile` (v1 schema) — declarative project manifest.
- `.anamnesis/manifest.json` — region/file hash tracking with 6-field
  entries (`base_rendered_hash`, `last_applied_hash`,
  `current_user_hash`, fragment id/version, template version, params).
- Region anchor parser (`<!-- anamnesis:region id=… fragment=…@n -->`):
  parse, render, upsert, remove, byte-perfect roundtrip.
- Fragment loader with topological sort (`requires`) and conflict
  detection.
- `triggers.ts`: TriggerExpr DSL (`package_json_has`, `pyproject_has`,
  `file_exists`, `dir_exists`, `any_yaml_contains` + `any` / `all`).
- `rulebook.ts`: markdown rulebook parser with code-fence skipping.
- `applier.ts`: planning + applying with 5 statuses
  (`create`, `update`, `noop`, `user-modified`, `blocked`).
- Backup-before-apply to `.anamnesis/backups/<ISO-timestamp>/`.

#### Adapters
- Claude Code adapter for all 5 capabilities
  (`project_memory`, `ontology`, `executable_hook`, `skill`,
  `slash_command`).
- `RendererRegistry` — adapter-scoped, isolation-friendly.

#### Commands
- `init`: rulebook → suggestions → install. Auto-includes `base`.
- `update`: dry-run by default; `--apply` writes. Reports `suggested`
  rulebook matches without auto-installing. Auto-bumps fragment
  versions in Agentfile on apply.
- `promote`: lift a project-local file into the library as a fragment
  capability (executable_hook / slash_command / skill / ontology;
  project_memory added in v0.2).

#### Fragments (library)
- `base`, `prisma`, `k8s`, `nestjs`, `python-uv`, `fastapi`.

#### Safety
- `--allow-exec-adapters` flag gates `.claude/{hooks,commands,skills}/`
  writes (supply-chain protection).
- Files on disk without manifest entries are classified as
  `user-modified` and never overwritten.
- `update` is dry-run by default.

### Coverage

229 tests across 18 test files.

### Repository policy

The repository is public. All committed fragments and tests use
synthetic data. Personal data (IPs, hostnames, user paths, internal
identifiers) does not appear in any committed file.

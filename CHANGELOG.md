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

### Targeted for v0.3

- ~~**Cursor adapter**~~ — *shipped (5/5 capabilities)* —
  · project_memory + ontology: same outputs as CC (Cursor reads
    AGENTS.md natively).
  · executable_hook / skill / slash_command: emit `.cursor/rules/<id>.mdc`
    with `agentRequested: true` so Cursor's agent applies the rule when
    the situation matches `description`.
  · `.cursor/rules/` added to `EXEC_ADAPTER_PREFIXES` (gated behind
    `--allow-exec-adapters` for supply-chain consistency).
  · CC + Codex + Cursor co-existence: each adapter targets its own files;
    region/file dedup applies for shared targets (AGENTS.md region,
    ontology slice).
  · `scoped_rule` capability (Cursor-native glob scoping) deferred to
    a follow-up patch — current MDC output uses `agentRequested` only.
- ~~**Codex adapter completion**~~ — *shipped (AGENTS.md region path)* —
  `executable_hook`, `skill`, `slash_command` now have Codex
  renderers that emit region-based fallbacks (script body / skill body /
  command body) into AGENTS.md so Codex agents can honor the intent
  manually. CC + Codex co-existence: CC installs native files; Codex
  reads region instructions from AGENTS.md. Git pre-commit auto-wiring
  for hooks remains v0.4 polish (low value compared to the AGENTS.md
  path).
- ~~**Monorepo init UX**~~ — *partial: `init --monorepo` shipped* —
  detects `package.json` `workspaces` field, expands `<dir>/*` patterns,
  runs the rulebook in each sub-project, and generates a multi-scope
  Agentfile with one `extends: '.'` scope per matched workspace.
  Reports empty workspaces (no rule match) separately. Interactive
  prompt + pnpm-workspace.yaml / lerna / nx / conventional-dir detection
  remain follow-up.
- ~~**`status` per-scope grouping**~~ — *shipped* — multi-scope projects
  group fragments and drift entries under each scope. Single-scope output
  unchanged. Each entry is bucketed to its longest-matching scope path
  (exec-adapter files always belong to root since CC `settings.json`
  is read only at root).
- ~~**Agent handoff MVP**~~ — *shipped in base v3 + v4* —
  `/handoff-prepare` slash command + `inject-handoff.sh` SessionStart hook
  + base v3 capability bundling for Claude Code (settings.json
  auto-registered). Base v4 added a tool-agnostic "session start: handoff
  자동 확인" instruction in AGENTS.md so Codex/Cursor agents read
  `.anamnesis/handoff/<ts>.md` manually at session start.

### Targeted for v0.4

- **Hybrid ontology bootstrap** — two-layer auto-generation of
  `.anamnesis/ontology/<id>.yaml`. Layer A: `anamnesis ontology bootstrap`
  runs deterministic per-fragment introspectors (k8s manifests, prisma
  schema, nextjs routes, fastapi/nestjs routers) to extract namespace,
  port, model, route facts without an LLM. Layer B: `/ontology-enrich`
  skill instructs the active agent (any tool) to fill in semantic
  relationships, flows, and operational notes parsers can't extract.
  Fragment-author SDK exposes an `Introspector` interface so community
  fragments can ship their own parsers.
- **Full version pinning** — fragment version cache so `pinned: true`
  renders the pinned version, not library-current. Library stores past
  versions under `fragments/<id>/.versions/`. (Moved from v0.3 — low
  value while user base is small.)
- **`anamnesis update --bump-pinned`** — companion to full pinning.
- **Handoff auto-trigger** + multi-task tracking + recovery.
- **`anamnesis doctor`** — installation integrity check.
- **Codex hook auto-wiring** — git pre-commit installer for
  `executable_hook` (deferred from v0.3). Currently Codex agents read
  region instructions manually.
- **Trusted Publishing** — GitHub Actions + OIDC for npm releases.
- **Fragment catalog expansion** — Rails, Django, Go, Rust, sveltekit, etc.
- **`anamnesis status --json`** — structured output for CI.

Full breakdown in [`docs/ROADMAP.md`](../docs/ROADMAP.md).

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

# Changelog

All notable changes to anamnesis are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
the project uses pre-1.0 semantics — minor version bumps may include
breaking changes until v1.0.

## [Unreleased]

### Added

- Added generation-boundary CLI guidance to `init`, `status`, `doctor`,
  and `ontology bootstrap` output so users can tell which context and
  ontology files were generated deterministically and which require an
  active agent.
- Added a Claude Code `CLAUDE.md` entrypoint managed region. Projects with
  Claude Code enabled now get a Claude-specific pointer back to canonical
  `AGENTS.md`, managed ontology, and handoff state while preserving user
  prose outside the managed region.
- Added ontology gap reporting to `status` and `doctor`. `status` now
  reports missing static slices, missing `.bootstrap.yaml` facts, missing
  `.enriched.yaml` semantics, fragments without deterministic Layer A
  introspectors, and introspectors that are not applicable in a scope;
  `doctor` turns actionable gaps into repair warnings.
- Added the base v7 Layer B enrichment lifecycle contract. `/ontology-enrich`
  now tells every supported adapter to merge existing `.enriched.yaml`
  content by stable IDs, append new facts, use `supersedes` for replaced
  designs, and put weak inferences under `open_questions`.
- Added bootstrap ontology drift detection. `status` now compares existing
  `.bootstrap.yaml` files against the current deterministic introspector
  output and reports stale facts; `doctor` turns stale bootstrap output into
  an actionable repair warning.
- Added ontology schema version conventions. `.bootstrap.yaml` output now
  includes deterministic `schema_version`, `generator`, and `facts` fields;
  base v8 requires `.enriched.yaml` files to use
  `schema_version: anamnesis.enriched.v1`.
- Added agent-assisted enrichment guidance to ontology diagnostics.
  `status` and `doctor` now connect missing or stale Layer A facts to the
  follow-up `/ontology-enrich` step, and `ontology bootstrap` prints
  semantic follow-up targets for matching `.enriched.yaml` files.

### Documentation

- Updated the v0.6 roadmap to start with generation-boundary guidance:
  command output and docs should distinguish deterministic CLI-generated
  context/ontology from agent-required semantic enrichment and handoff
  documents.
- Documented the generation boundary in the README.
- Updated README, design notes, dogfood notes, and the Agentfile spec to
  describe the managed Claude Code entrypoint.
- Documented the ontology gap report in the README and ontology bootstrap
  design notes.
- Documented the Layer B enrichment re-run policy in the ontology bootstrap
  design notes.
- Documented bootstrap drift detection in the ontology bootstrap design notes.
- Documented the bootstrap and enriched ontology schema conventions.
- Re-centered the v0.6 roadmap and ontology bootstrap docs on bounded
  deterministic Layer A baselines plus agent-assisted Layer B enrichment,
  rather than broad framework introspector expansion.
- Clarified in the README that Layer A extracts provable facts while Layer B
  carries project-specific relationships, flows, intent, invariants, and open
  questions for future agents.
- Documented that bootstrap output should lead directly into agent-assisted
  enrichment instead of leaving users to hand-author semantic ontology YAML.
- Added the first v0.6 sanitized-fixture ontology before/after dogfood record for
  `sanitized-nest-prisma`, showing static-only ontology versus bootstrap plus
  agent-enriched ontology on a NestJS/Prisma backend snapshot.
- Added a v0.7 roadmap item for a repeatable benchmark/report command so
  future README claims can be backed by measured before/after context quality,
  not just anecdotal dogfood notes.

## [0.5.0] — 2026-04-30

Context-continuity release: validates the main product promise across
Claude Code, Codex, and Cursor with dogfood automation, active-handoff
simulation, stale-handoff diagnostics, and repair guidance.

### Documentation

- Re-centered the roadmap on anamnesis' product purpose: always inject
  current context/ontology and let users switch agents without re-briefing.
- Clarified the roadmap after v0.4: v0.5 proves context continuity across
  real agent switches, v0.6 deepens ontology automation from dogfood gaps,
  and v0.7 hardens multi-agent UX/lifecycle scale.
- Documented the current npm Trusted Publishing/OIDC status and the
  manual npmjs.org publish fallback.
- Aligned README, design notes, monorepo docs, fragment docs, and the
  Agentfile spec with the current context-continuity model.

### Tests

- Added a cross-agent continuity acceptance fixture for the base fragment.
  It verifies that Claude Code, Codex, and Cursor render the shared
  context/ontology contract, handoff startup instructions, operational
  guardrails, and command/skill surfaces needed for agent switching.

### Changed

- Dogfooded anamnesis on itself with all three supported adapters enabled:
  Claude Code, Codex, and Cursor.
- Added [`docs/DOGFOOD.md`](docs/DOGFOOD.md), a recurring self-check log
  for tracking whether new versions improve context continuity, ontology
  availability, adapter parity, diagnostics, and verification strength.
- Added `anamnesis dogfood check --append` plus npm `dogfood` /
  `release:check` scripts so version bumps can record the self-check before
  publish.
- `anamnesis status` now reports first-class continuity readiness for
  project memory, ontology, handoff startup, enabled adapter surfaces, and
  managed drift. `anamnesis doctor` surfaces the same failures as
  continuity-specific warnings, and dogfood scoring reuses the status
  continuity result instead of duplicating adapter checks.
- Dogfood verification now runs an active handoff switch simulation: it
  installs all supported adapter surfaces in a temporary project, writes an
  `active.md` handoff index plus archive, executes the Claude Code handoff
  injection hook, and verifies Codex/Cursor fallback instructions are present.
- `status` / `doctor` now diagnose stale active handoff state separately from
  handoff startup instructions. Missing archive references, active tasks
  pointing away from the newest archive, and completed/superseded entries in
  open handoff sections are reported before a fresh agent trusts stale state.
- Added the first sanitized-fixture dogfood matrix for v0.5, covering a managed
  NestJS+Prisma backend, a fresh Next.js app, and a fresh NestJS+k8s backend
  from git archive snapshots. The matrix records continuity, doctor,
  ontology bootstrap, and handoff injection evidence without modifying the
  source repositories.
- Adapter-surface continuity failures now target only the missing or drifted
  surfaces, keeping `doctor` output actionable on real existing projects.
- `doctor` issues now include repair guidance for user-modified managed files,
  adapter-surface continuity failures, invalid settings, missing hook
  registrations, and stale active handoff state.
- Reviewed the current introspector API as part of the v0.5 scope and kept
  framework expansion deferred; v0.6 owns deeper ontology schema and refresh
  lifecycle work.

### Coverage

419 tests across 35 files.

## [0.4.4] — 2026-04-30

Release automation verification after npm Trusted Publishing was configured
for the GitHub Actions workflow.

### Changed

- Bumped the package to validate whether the tag-triggered publish workflow
  can publish via npm OIDC without a local owner-token fallback. The
  workflow reached `npm publish`, but npmjs.org rejected the OIDC publish
  with E404; `0.4.4` was not published to npmjs.org.

### Coverage

405 tests across 33 files.

## [0.4.3] — 2026-04-30

Packaging recovery for npm publish after the `v0.4.2` tag workflow
reached the registry step but could not complete the release.

### Fixed

- Normalized the CLI `bin` path so npm 11 does not auto-correct the
  package metadata during publish.
- Publish workflow now checks whether the package version already exists
  on npmjs.org before running `npm publish`, keeping tag workflows
  idempotent after a manual owner-token recovery publish.

### Coverage

405 tests across 33 files.

## [0.4.2] — 2026-04-30

Operational polish for agent continuity, pinned fragment updates, release
automation, and broader stack detection.

### Added

- **`anamnesis doctor`** — read-only installation integrity diagnostics.
  Reports manifest parse/missing errors, tracked file or region drift,
  missing library fragments, fragment updates, adapter renderer gaps,
  invalid `.claude/settings.json`, and installed Claude hooks missing
  from settings registration.
- **`anamnesis status --json`** — prints the existing structured status
  result as stable JSON for CI and other tools.
- **base v6 handoff continuity** — `/handoff-prepare` now writes both a
  timestamped archive and `.anamnesis/handoff/active.md` multi-task
  index. `inject-handoff.sh` injects the active index plus the latest
  archived handoff, and the new Claude Code `Stop` hook
  `handoff-reminder.sh` reminds agents when uncommitted work is newer
  than the latest handoff.
- **full fragment pinning** — `update` now renders `pinned: true`
  fragments from `base/.versions/<version>/` or
  `fragments/<id>/.versions/<version>/` instead of library-current.
  `update --bump-pinned` explicitly moves pinned entries to the current
  library version while keeping them pinned.
- **Trusted Publishing workflow** — GitHub Actions release workflow for
  npm Trusted Publishing via OIDC, plus release docs with the npmjs.com
  trusted publisher fields required for `@mcprotein/anamnesis`.
- **fragment catalog expansion** — added project memory + ontology
  fragments and rulebook triggers for Rails, Django, Go, Rust,
  SvelteKit, Remix, and Nuxt.
- **Codex hook auto-wiring** — Codex `executable_hook` rendering now
  installs a best-effort Git `pre-commit` bridge in Git repos while
  keeping the AGENTS.md fallback. Prisma and k8s fragments move to v2
  to opt into Codex hook support, with v1 archives preserved for pinned
  installs.

### Coverage

405 tests across 33 files.

## [0.4.1] — 2026-04-30

Ontology bootstrap expansion for common web/backend stacks and monorepo
scope-local bootstrap output.

### Added

- **nextjs introspector** (`cli/src/introspectors/nextjs.ts`) —
  finds App Router `page` / `route` files, Pages Router pages and
  `pages/api` routes, exported HTTP methods on route handlers, and
  middleware files. Output is stable-sorted.
- **nestjs introspector** (`cli/src/introspectors/nestjs.ts`) —
  scans source files for `@Controller()` classes and HTTP method
  decorators (`@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@All`,
  etc.), producing controller prefixes plus stable-sorted route facts
  without adding TypeScript parser dependencies.
- **fastapi introspector** (`cli/src/introspectors/fastapi.ts`) —
  scans Python source for `FastAPI()` apps, `APIRouter()` routers,
  path operation decorators (`@app.get`, `@router.post`,
  `@router.api_route`, etc.), and `include_router` calls. Route facts
  stay separate from include prefixes so Layer A avoids cross-file
  inference.
- **multi-scope ontology bootstrap** — `anamnesis ontology bootstrap`
  now resolves `project.scopes`, runs fragment introspectors from each
  scope root, and writes scope-local
  `<scope>/.anamnesis/ontology/<id>.bootstrap.yaml` files. The
  `--scope` and `--fragment` filters work across scopes.

### Coverage

389 tests across 32 files.

## [0.4.0] — 2026-04-29

Hybrid ontology bootstrap. New projects no longer start with an empty
ontology slice — `anamnesis init` now auto-populates
`.anamnesis/ontology/<id>.bootstrap.yaml` from project files via
fragment-specific introspectors (Layer A), and the new
`ontology-enrich` skill instructs the active agent (any tool) to add
the semantic layer parsers can't infer (Layer B). See
[`docs/ONTOLOGY-BOOTSTRAP.md`](docs/ONTOLOGY-BOOTSTRAP.md) for the
two-layer design.

### Added

- **`Introspector` interface + `IntrospectorRegistry`**
  (`cli/src/core/introspector.ts`). Each fragment that wants bootstrap
  support registers an Introspector keyed by its fragment id with two
  hooks: `appliesTo(ctx)` (cheap pre-flight) and `introspect(ctx)`
  (returns plain JS object → YAML).
- **`anamnesis ontology bootstrap`** command
  (`cli/src/commands/ontology.ts`) — Layer A entrypoint. Walks the
  Agentfile, looks up an introspector for each installed fragment,
  runs it, writes `.anamnesis/ontology/<id>.bootstrap.yaml` with a
  deterministic header. Flags: `--fragment <id>`, `--dry-run`,
  `--project-root`. Outcomes: `written` / `unchanged` /
  `skipped-no-introspector` / `skipped-not-applicable`.
- **k8s introspector** (`cli/src/introspectors/k8s.ts`) — walks
  project YAML files, multi-doc aware, extracts `namespaces`,
  `services` (name/ns/type/ports/selector), `ingresses` (host/paths/
  backend), `workloads` (Deployment / StatefulSet / DaemonSet / Job /
  CronJob with images + replicas). Stable sort by (namespace, name).
  Verified on sanitized-k8s: 7 namespaces + ingresses + services +
  workloads from real manifests, 276 lines of structured output.
- **prisma introspector** (`cli/src/introspectors/prisma.ts`) —
  finds `**/schema.prisma`, regex-based block parser, extracts
  `datasources`, `generators`, `models` (with field-level type +
  attributes like `@id` / `@default` / `@relation`), `enums` (with
  values). Multi-file schema layouts supported. Verified on
  sanitized-nest-prisma: postgresql datasource + prisma-client generator +
  2 enums + multiple models, attributes preserved.
- **`ontology-enrich` skill** — Layer B. Shipped as a new `skill`
  capability of the base fragment (v4 → v5). Tool-agnostic via the
  existing skill renderer pipeline: CC gets a native SKILL.md, Codex
  gets an AGENTS.md `codex-skill-ontology-enrich` region, Cursor gets
  a `.cursor/rules/ontology-enrich.mdc` with `agentRequested: true`.
  Instructs the active agent to read the bootstrap output + project
  manifests and write `<id>.enriched.yaml` files containing
  relationships / flows / operational_notes that parsers cannot
  extract.
- **`anamnesis init` auto-bootstrap** — after fragment install, init
  runs `ontology bootstrap` automatically. Fragments without a
  registered introspector are silently skipped. Bootstrap failures do
  not fail init; the message is surfaced in the CLI report. Opt out
  with `--no-bootstrap`.

### Coverage

356 tests across 29 files (was 329 at 0.3.0 ship). New: 5 k8s
introspector, 8 prisma introspector, 8 bootstrap command, 3 init
auto-bootstrap.

### Originally targeted for 0.4.x patches

- nextjs / nestjs / fastapi introspectors and multi-scope bootstrap
  shipped in 0.4.1.
- introspector author SDK docs moved to v0.5.

---

## [0.3.0] — 2026-04-28

Three-tool parity + agent handoff. anamnesis now renders all 5
capabilities for Claude Code, Codex, and Cursor; ships a tool-agnostic
agent-handoff workflow; auto-detects monorepo workspaces; and groups
`status` output by scope.

### Added

- **Cursor adapter** — full 5/5 capability coverage. `executable_hook`,
  `skill`, `slash_command` emit `.cursor/rules/<id>.mdc` files with
  `agentRequested: true` so Cursor's agent applies the rule when the
  situation matches `description`. `project_memory` and `ontology` reuse
  the Claude Code outputs (Cursor reads AGENTS.md natively). New prefix
  `.cursor/rules/` added to `EXEC_ADAPTER_PREFIXES` so Cursor exec-adapter
  files are gated behind `--allow-exec-adapters` for supply-chain
  consistency. `scoped_rule` (Cursor-native glob scoping) deferred.
- **Codex adapter completion** — `executable_hook`, `skill`,
  `slash_command` now have Codex renderers that emit AGENTS.md region
  fallbacks (`codex-hook-<basename>` / `codex-skill-<name>` /
  `codex-cmd-<name>`) carrying the script body / skill body / command
  body inline. Codex agents honor the intent manually since Codex has
  no native hook system. Git pre-commit auto-wiring deferred to v0.4.
- **`init --monorepo`** — detects `package.json` `workspaces` field,
  expands `<dir>/*` patterns and exact paths, runs the rulebook in each
  sub-project, and generates a multi-scope Agentfile with one
  `extends: '.'` scope per matched workspace. Sub-scopes skip fragments
  already at root to avoid duplicate installs. Empty workspaces (no rule
  match) reported separately. pnpm-workspace.yaml / lerna / nx /
  conventional-dir detection + interactive prompt remain follow-up.
- **`status` per-scope grouping** — multi-scope projects group fragments
  and drift entries under each scope. Single-scope output unchanged.
  Each entry is bucketed to its longest-matching scope path; exec-adapter
  files always belong to root (CC `settings.json` is read only at root).
- **Agent handoff MVP** — base fragment v3 + v4 ship `/handoff-prepare`
  slash command + `inject-handoff.sh` SessionStart hook + tool-agnostic
  AGENTS.md "session start: handoff 자동 확인" instruction. Departing
  agents write `.anamnesis/handoff/<ISO-ts>.md` capturing goal / done /
  in-flight / decisions / open questions / next steps; arriving agents
  (Claude Code via hook, Codex/Cursor via AGENTS.md instruction) read
  the latest handoff and resume from where the previous session stopped.
- **Multi-scope rendering** — `init` and `update` iterate over
  `effectiveScopes(agentfile)` and emit per-scope render targets.
  `dedupeActions` collapses duplicate AGENTS.md region writes when CC +
  Codex + Cursor all emit the same project_memory or ontology slice.

### Tests

329 passing across 27 test files (was 299 in v0.2). New coverage:
Cursor MDC rendering, Codex region fallbacks, monorepo detection,
multi-scope status grouping.

### Targeted for v0.4

- **Hybrid ontology bootstrap** — two-layer auto-generation. Layer A
  (deterministic CLI introspectors): `anamnesis ontology bootstrap` runs
  per-fragment parsers (k8s manifests → namespace/service/port, prisma
  schema → model/relation, nextjs → routes, fastapi/nestjs → routers).
  Layer B (agent-driven): `/ontology-enrich` skill fills in semantic
  relationships, flows, and operational notes parsers can't extract.
  Companion `Introspector` SDK so community fragments ship their own
  parsers.
- **Full version pinning** — fragment version cache + `.versions/`
  storage. Moved from v0.3 (low value while user base is small).
- **`anamnesis update --bump-pinned`** — companion to full pinning.
- **Handoff auto-trigger** + multi-task tracking + recovery.
- **`anamnesis doctor`** — installation integrity check.
- **Codex hook auto-wiring** — git pre-commit installer.
- **Trusted Publishing** — GitHub Actions + OIDC for npm releases.
- **Fragment catalog expansion** — Rails, Django, Go, Rust, sveltekit, etc.
- **`anamnesis status --json`** — structured output for CI.

Full breakdown in [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

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

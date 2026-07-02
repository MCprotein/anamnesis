# Official Docs Site Plan

Deprecated: historical v0.9 docs-site plan. The active documentation index
lives in `README.md`; v1.0 audit history is archived in
`docs/deprecated/DOCS-V1-AUDIT.md`.

Status: v0.9 plan. No separate documentation site has shipped yet.
V1.0 GitHub-first documentation coverage is audited in
`docs/deprecated/DOCS-V1-AUDIT.md`.

## Decision

Keep documentation GitHub-first through v1.0. Do not build a separate docs
site until the public quickstart, fragment authoring path, registry/signing
contracts, and benchmark gallery have stabilized.

Rationale:

- The project is still pre-1.0 and the schema/API surface is intentionally
  being clarified.
- The docs already ship in the npm package, so links work for packaged users.
- A generated site would add maintenance cost before the information
  architecture is stable.
- The immediate risk is not presentation; it is fragmented or contradictory
  guidance across README, roadmap, Agentfile docs, registry docs, and
  continuity docs.

The docs site can become a generated mirror later. The source of truth should
remain markdown in this repository.

## Audience Map

| Audience | Need | Entry point |
|---|---|---|
| First-time user | Install, preview, apply safely, understand generated files | `README.md` quickstart |
| Agent switcher | Install all tool surfaces and resume work in another agent | `docs/AGENT-SWITCHING-GUIDE.md` |
| Ontology user | Understand CLI-generated Layer A vs agent-generated Layer B | `docs/ONTOLOGY-BOOTSTRAP.md` |
| Monorepo user | Apply scopes without losing root context | `docs/MONOREPO.md` |
| Existing-project maintainer | Diagnose drift, stale handoff, partial adapter install, ontology gaps | `docs/REPAIR.md` |
| Fragment author | Create and review public-quality fragments | `docs/FRAGMENT-AUTHORING.md` |
| Registry implementer | Build remote discovery without weakening trust boundaries | `docs/FRAGMENT-REGISTRY.md` and `docs/FRAGMENT-SIGNING.md` |
| API consumer | Import only supported TypeScript symbols | `docs/API.md` |
| Release owner | Publish and verify npmjs.org package behavior | `docs/RELEASING.md` |

## Information Architecture

The GitHub-first docs should be organized as a user journey rather than a flat
file dump.

Recommended future navigation:

```text
1. Getting Started
   - README quickstart
   - install and dry-run
   - generated files

2. Daily Lifecycle
   - init/update/status/doctor
   - repair playbook
   - backups and user-modified files

3. Agent Continuity
   - adapter parity
   - switching guide
   - switching scenario matrix
   - handoff workflow

4. Ontology
   - static slices
   - Layer A bootstrap
   - Layer B enrichment
   - ontology gap diagnostics

5. Monorepos
   - scopes
   - inheritance
   - per-scope fragments/tools

6. Fragment Ecosystem
   - authoring guide
   - registry design
   - signing/checksum design
   - future registry CLI

7. Evidence
   - dogfood log
   - benchmark reports
   - public benchmark gallery

8. Reference
   - Agentfile schema
   - public TypeScript API
   - architecture/design
   - release process
   - changelog
```

## Current Docs Mapping

| Planned section | Existing source |
|---|---|
| Getting Started | `README.md` |
| Daily Lifecycle | `README.md`, `docs/REPAIR.md` |
| Agent Continuity | `docs/AGENT-SWITCHING-GUIDE.md`, `docs/ADAPTER-PARITY.md`, `docs/SWITCHING-SCENARIOS.md` |
| Ontology | `docs/ONTOLOGY-BOOTSTRAP.md` |
| Monorepos | `docs/MONOREPO.md` |
| Fragment Ecosystem | `docs/FRAGMENT-AUTHORING.md`, `docs/FRAGMENT-REGISTRY.md`, `docs/FRAGMENT-SIGNING.md` |
| Evidence | `docs/DOGFOOD.md`, `docs/BENCHMARKS.md`, `docs/BENCHMARK-GALLERY.md` |
| Reference | `specs/agentfile.md`, `docs/API.md`, `docs/DESIGN.md`, `docs/RELEASING.md`, `CHANGELOG.md` |

## Site Trigger

Build a separate docs site only after these are true:

- v1.0 Agentfile and public API surfaces are frozen or explicitly marked
  stable.
- Fragment authoring and registry/signing docs are complete enough for
  external contributors.
- Public benchmark gallery has at least two sanitized repo shapes.
- README claims link to stable evidence rather than aspirational text.
- The docs navigation above has been tested by at least one fresh install path
  and one fragment authoring path.

Until then, keep improving markdown docs and README navigation.

## Site Shape When Needed

If a site becomes useful, it should be a generated static site with markdown as
source. Requirements:

- one canonical source per page in this repository
- no separate CMS
- no content duplicated from README unless generated
- search over docs pages
- stable URLs for quickstart, switching agents, ontology, fragments, registry,
  benchmarks, Agentfile schema, and API reference
- version banner for pre-1.0 vs stable docs
- generated from CI without requiring secrets

Candidate paths:

```text
/getting-started
/lifecycle
/agent-switching
/ontology
/monorepos
/fragments/authoring
/fragments/registry
/fragments/signing
/benchmarks
/reference/agentfile
/reference/api
/release
```

Do not create a marketing-only landing page before the actual docs are
navigable. The first screen should help users install, preview, and understand
what will be written.

## Documentation Maintenance Rules

- New CLI behavior needs README or reference docs in the same commit.
- New lifecycle behavior needs `docs/ROADMAP.md` and `CHANGELOG.md` entries
  until v1.0.
- New fragment behavior needs `docs/FRAGMENT-AUTHORING.md` if it changes
  author responsibilities.
- New registry/signing behavior needs both design docs if it affects trust or
  source selection.
- New public claims need dogfood or benchmark evidence.
- Keep docs linked from README before assuming users can find them.

## Acceptance Criteria

- A new user can find install, dry-run, apply, and safety guidance from
  `README.md`.
- A user switching Claude Code, Codex, and Cursor can find the continuity guide
  and known adapter gaps.
- A fragment author can find the authoring guide, registry design, signing
  policy, and rulebook ownership model.
- A maintainer can find release, repair, API, schema, and roadmap reference
  material.
- A future docs-site implementation can mirror this repository's markdown
  without inventing a second source of truth.

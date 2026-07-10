# anamnesis

> **AI coding agent config lifecycle manager.**
> Keep your AI coding agents from forgetting what your project is.

[![tests](https://img.shields.io/badge/tests-701%20passing-success)]() [![npm](https://img.shields.io/npm/v/@mcprotein/anamnesis?registry_uri=https%3A%2F%2Fregistry.npmjs.org)](https://www.npmjs.com/package/@mcprotein/anamnesis) [![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Main-branch docs may describe unreleased work. The npm badge is the source of
truth for the latest version currently published to npmjs.org.

---

## The problem

Every time you open a project with Claude Code (or Codex, Cursor, …), your agent starts blank.
No project conventions. No ontology. No context.

So you write an `AGENTS.md`, ontology files, hooks, slash commands,
skills, and handoff notes — and then you do it again for the next
project. And the project after that.

Switching tools has the same failure mode. A project configured for
Claude Code does not automatically give Codex or Cursor the same current
context, ontology, handoff state, and operating rules.

The word **anamnesis** (ἀνάμνησις) means *"not forgetting"* in Greek — the literal opposite of *amnesia*. This tool prevents **agent amnesia**.

---

## What anamnesis does

- **Installs always-loaded context**: project memory, ontology slices,
  handoff instructions, operational reminders, skills, hooks, and command
  intent.
- **Adds retrievable task contracts**: task harnesses live under
  `.anamnesis/task-harnesses/` and are indexed for lookup instead of being
  pasted wholesale into every startup context.
- **Keeps context portable across agents**: the same Agentfile and
  fragment capabilities render to Claude Code, Codex, and Cursor so the
  next agent can continue without a bespoke "read these files first"
  prompt.
- **Detects** stack-specific concerns from your project files
  (`prisma/schema.prisma`, `@nestjs/core` in `package.json`, `uv.lock`,
  …) and overlays the matching fragment.
- **Re-syncs** as the library evolves, *preserving your edits* — files
  you've authored or modified are never overwritten without consent.
- **Promotes** project-local hooks, skills, commands, and task harnesses back
  into the library so other projects benefit.

It is **not** an application scaffolder (no `package.json`, no source code generation). It manages the small markdown/yaml/shell ecosystem your AI agent reads, and can optionally scaffold project-facing docs when explicitly requested.

---

## Quickstart

Install (npm — scoped package, the unscoped `anamnesis` name is taken
by an unrelated project):

```bash
npm install -g @mcprotein/anamnesis
```

…or run on demand without global install:

```bash
npx @mcprotein/anamnesis init --dry-run
```

Either way, the CLI is invoked as `anamnesis`.
Running `anamnesis` with no command prints a concise first-run guide; use
`anamnesis --help` for grouped core help or `anamnesis --help --all` for the
full command reference.

Check whether the installed CLI is behind npmjs.org:

```bash
anamnesis upgrade
anamnesis upgrade plan      # read-only package + project upgrade plan with choices
anamnesis upgrade apply-choice <id>  # run one supported choice; writes require --apply
anamnesis upgrade choose    # interactive chooser over the same plan choices
anamnesis upgrade --apply   # runs npm install -g only when a newer version exists
```

Package upgrade only updates the installed CLI. In an existing managed project,
use `upgrade plan` to see gates, guided choices, and next commands, or preview
project-managed file changes separately before applying them:

```bash
anamnesis apply --dry-run --allow-exec-adapters
anamnesis apply --allow-exec-adapters
anamnesis doctor
```

If the Agentfile schema needs migration, `upgrade plan` shows that gate first
and `apply` stops before rendering or writing managed surfaces. Run
`anamnesis migrate agentfile --apply`, then rerun `upgrade plan` / `apply`.
`upgrade plan` also reports optional settings that are using implicit defaults
so existing Agentfiles do not need formatting churn just to learn new knobs.
To act on one structured choice, run `anamnesis upgrade apply-choice <id>`.
Read-only choices execute directly; local-write and package-install choices
preview by default and require `--apply` before they write.
For a guided terminal flow, run `anamnesis upgrade choose`; scripts can pass
`--choice <id|number>` to avoid prompting while still using the same executor.

Building from source instead (during development or for forks):

```bash
git clone https://github.com/MCprotein/anamnesis
cd anamnesis
npm install
npm run build       # produces cli/dist/
npm link            # makes `anamnesis` available globally
```

Then in any project:

```bash
cd /path/to/your/project
anamnesis init --dry-run                 # preview what would happen
anamnesis init --allow-exec-adapters     # actually install
anamnesis init --tools all --allow-exec-adapters
# install Claude Code, Codex, and Cursor surfaces on first init
anamnesis init --scaffold-docs --allow-exec-adapters
# also create missing README.md and docs/PROJECT-CONTEXT.md starter docs
anamnesis init --enhance-docs --allow-exec-adapters
# add managed context-review sections to existing README/docs
```

When an AI agent runs the setup for you, it should use the
`anamnesis-init` skill first. That skill asks a single multiple-choice
question about README/docs handling, then maps the answer to no docs flag,
`--scaffold-docs`, or `--enhance-docs`.

What gets created:

```
your-project/
├── Agentfile                                    # selected fragments + tool list
├── AGENTS.md                                    # canonical context (existing prose preserved)
├── CLAUDE.md                                    # Claude Code entrypoint pointing to AGENTS.md
├── .anamnesis/
│   ├── manifest.json                            # region/file hashes for drift detection
│   ├── ontology/{base,<fragment>}.yaml          # static ontology slices
│   ├── ontology/*.bootstrap.yaml                # deterministic project facts
│   ├── task-harnesses/context-continuity.yaml    # retrieval-only task contract
│   └── handoff/active.md                        # current work index when handoff is used
├── .claude/                                     # Claude Code adapter output
│   ├── hooks/{inject-ontology, remind-uncommitted, …}.sh
│   ├── commands/load-context.md
│   └── skills/load-context/SKILL.md
├── .cursor/rules/                               # Cursor adapter output when enabled
├── .codex/{config.toml,hooks.json}              # Codex native hooks when enabled
├── .codex/skills/load-context/SKILL.md          # Codex native skills when enabled
├── .anamnesis/codex-native-hooks/               # Codex native hook wrappers
└── .anamnesis/codex-hooks/                      # Codex git-hook bridge when enabled
```

`AGENTS.md` is *additive* — anamnesis appends regions inside `<!-- anamnesis:region ... -->` anchors. Anything outside the anchors is yours.

`README.md` and `docs/PROJECT-CONTEXT.md` are opt-in. Use
`--scaffold-docs` to create missing starter docs, or `--enhance-docs` to add
managed context-review regions to existing docs without replacing your prose.

---

## Lifecycle

```bash
anamnesis init      # first-time setup; writes install evidence
anamnesis apply --dry-run  # preview project-managed changes without writing
anamnesis apply    # apply reviewed project-managed changes; writes evidence
anamnesis update   # deprecated compatibility command; use apply / apply --dry-run
anamnesis upgrade plan  # read-only package + project upgrade plan with choices
anamnesis upgrade apply-choice <id>  # execute one supported choice; --apply required for writes
anamnesis upgrade choose  # interactive chooser over the same plan choices
anamnesis apply --dry-run --bump-pinned  # preview moving pinned fragments to current
anamnesis status    # fragments, drift, ontology gaps, continuity, evidence, context diagnostic summary
anamnesis doctor    # read-only installation integrity + continuity/ontology/context diagnostics
anamnesis doctor --append  # record doctor diagnostics as runtime evidence
anamnesis release check  # read-only release gate: status + apply dry-run + doctor + evidence
npm run release:prepare -- --version X.Y.Z  # repo release prep: version files, changelog, evidence, gate
npm run release:publish -- --version X.Y.Z --push --cleanup-branch  # commit, tag, push; Actions publishes
npm run release:verify -- --version X.Y.Z  # verify npmjs.org, GitHub Packages, GitHub Release, CLI smoke
anamnesis hooks summary --append  # summarize hook logs and record runtime evidence
anamnesis migrate agentfile  # schema migration readiness check; --apply writes after backup
anamnesis dogfood check --append  # score and record self-check continuity evidence
anamnesis context index --write  # build a local source-pointer index
anamnesis context docs  # summarize Markdown pages, links, backlinks, and ontology refs
anamnesis context query "managed region"  # retrieve exact context pointers
anamnesis context diagnose  # report handoff, ontology, prose-doc path drift, docs/bootstrap, and evidence issues
anamnesis context resume  # print a compact resume bundle with size metrics
anamnesis context subagent-preamble  # print launcher-wrapper context for external subagents
anamnesis gc --dry-run  # preview task-harness retention and disk-budget cleanup candidates
anamnesis benchmark report --append  # record deterministic context-quality scorecard evidence
anamnesis benchmark compare --baseline before.json --after after.json --append  # record before/after deltas
anamnesis benchmark gallery --write  # refresh evidence-backed README claim candidates
anamnesis benchmark gallery --validate  # fail when gallery evidence is stale
anamnesis benchmark trace --append  # roll up benchmark trace logs as runtime evidence
anamnesis benchmark upgrade --write  # run sanitized upgrade fixtures and write JSON/SVG evidence
anamnesis benchmark retrieval --write  # measure context-query source-pointer ranking and write evidence
anamnesis benchmark task --template  # create a model-dependent task/retrieval/behavior benchmark input
anamnesis benchmark task --input task-run.json --append  # record an agent task run separately
anamnesis benchmark task-compare --template  # create a paired full/compact task template
anamnesis benchmark task-compare --full full.json --compact compact.json --append  # compare paired full/compact task runs
anamnesis benchmark task-series --write  # roll up repeated task-compare evidence with graphs
anamnesis benchmark subagent-injection --attempts 20 --write --append  # count subagent context injection and contract evidence
anamnesis benchmark prompt-gate  # decide using scorecard, session-context, and retrieval evidence
anamnesis promote   # lift a project-local file into the library as a reusable fragment
```

Re-running `apply --dry-run` on an unchanged project produces only `noop` results. User edits are surfaced as `user-modified` and library updates skip them. Backups go to `.anamnesis/backups/<timestamp>/`; `settings.backup_retention` keeps the newest N backup directories (`0` means unlimited).

### Generation boundary

anamnesis separates deterministic CLI generation from agent-assisted
semantic generation:

| Generated by | Output | Meaning |
|---|---|---|
| CLI (`init`, `apply`) | `AGENTS.md`, static `.anamnesis/ontology/*.yaml`, adapter surfaces | Managed context, baseline ontology slices, and tool-specific read surfaces |
| Agent (`anamnesis-init`) | selected `anamnesis init` command flags | Multiple-choice README/docs choice before an agent runs first-time setup for the user |
| CLI (`ontology bootstrap`) | `.anamnesis/ontology/*.bootstrap.yaml` | Regenerable Layer A facts under `schema_version: anamnesis.bootstrap.v1` with deterministic `generator` and `facts` fields |
| Agent (`/ontology-enrich`) | `.anamnesis/ontology/*.enriched.yaml` | Layer B semantics under `schema_version: anamnesis.enriched.v1` with stable IDs, evidence, confidence, append-safe re-runs, `supersedes`, and `open_questions` |
| Agent (`doc-freshness-review`) | read-only stale-doc report | Semantic README/CLAUDE/docs freshness review for claims deterministic diagnostics cannot prove |
| Agent (`/handoff-prepare`) | `.anamnesis/handoff/active.md` plus timestamped archives | Current task state for switching sessions or agents |

CLI commands print this boundary so users can tell whether the current
project state is CLI-generated, agent-enriched, or still missing semantic
handoff/ontology context. `apply` refreshes managed context, static ontology
slices, adapter surfaces, and project guidance; it does not crawl every source
or prose file into ontology. First-time `init` runs the conservative project
context bootstrap and supported Layer A introspectors by default, and existing
projects can refresh deterministic facts with `anamnesis ontology bootstrap`.
`status` also reports ontology gaps across static slices, missing or stale
deterministic bootstrap facts, semantic enrichment, and fragments that do not
yet have a Layer A introspector; `doctor` turns actionable gaps into repair
warnings. When Layer A facts are missing or stale, the guidance continues into
`/ontology-enrich` so the active agent can draft the semantic
`.enriched.yaml` layer instead of leaving users to write it by hand. When
prose docs may be semantically stale, `doc-freshness-review` keeps that agent
judgment separate from deterministic CLI diagnostics.

Layer A is intentionally a baseline, not a promise to model every framework
in depth. The CLI extracts facts it can prove from files; Layer B uses the
active agent to turn those facts into relationships, flows, intent,
invariants, and open questions that future agents can reuse.

`AGENTS.md` and `CLAUDE.md` are intentionally treated as compact control-plane
surfaces: stable operating rules, source pointers, and retrieval instructions
belong there, while project facts live in ontology, handoff, task-harness, and
docs sources. This is safe only when those sources are current and behavior
benchmarks show agents actually read and cite them; `benchmark task` v1.7 adds
those checks.

Handoff lifecycle automation now keeps handoff as bounded repo-local markdown:
hot active state is summarized at startup, warm archives are source pointers,
cold archives are query-only, and deprecated archives become GC candidates.
Retention budgets live in Agentfile settings and can be overridden for a
single `gc` run. See [`docs/HANDOFF-LIFECYCLE.md`](docs/HANDOFF-LIFECYCLE.md).

---

## Fragment catalog

| id | trigger | capabilities |
|---|---|---|
| `base` | always (auto-included) | project_memory, ontology, 4× executable_hook, 2× slash_command, 4× skill, task_harness |
| `prisma` | `@prisma/client` in `package.json` or `prisma/schema.prisma` | project_memory, ontology, executable_hook |
| `k8s` | `k8s/` directory | project_memory, ontology, executable_hook (yaml-lint) |
| `nestjs` | `@nestjs/core` in `package.json` | project_memory, ontology |
| `nextjs` | `next` in `package.json` | project_memory, ontology |
| `fastapi` | `fastapi` in `pyproject.toml` | project_memory, ontology |
| `python-uv` | `uv.lock` exists | project_memory, ontology |
| `docker-compose` | `docker-compose.yml` / `compose.yaml` | project_memory, ontology |
| `rails` | `Gemfile` + `config/application.rb` | project_memory, ontology |
| `django` | `django` in `pyproject.toml` or `manage.py` | project_memory, ontology |
| `go` | `go.mod` exists | project_memory, ontology |
| `rust` | `Cargo.toml` exists | project_memory, ontology |
| `sveltekit` | `@sveltejs/kit` in `package.json` | project_memory, ontology |
| `remix` | `@remix-run/node` / `@remix-run/react` in `package.json` | project_memory, ontology |
| `nuxt` | `nuxt` in `package.json` | project_memory, ontology |

Triggers are evaluated by [`rulebook.md`](rulebook.md). Add your own fragment with `anamnesis promote` or by adding a directory under `fragments/`.

---

## Capability model

Each fragment declares one or more **capabilities** in `fragment.yaml`. Capabilities are tool-agnostic; **adapters** render them onto a specific tool's surface.

| Capability | What it represents | Claude Code | Codex | Cursor |
|---|---|---|---|---|
| `project_memory` | Always-loaded context | `AGENTS.md` region + `CLAUDE.md` entrypoint | `AGENTS.md` region | `AGENTS.md` region read by Cursor |
| `ontology` | Structured reference | SessionStart hook injection | Codex native SessionStart wrapper + AGENTS fallback | rules instruction |
| `executable_hook` | Event-driven automation | `.claude/hooks/*.sh` | native wrappers for Codex-supported lifecycle events; AGENTS fallback + optional git hook bridge | rules fallback |
| `skill` | Reusable procedure | `.claude/skills/<n>/SKILL.md` | `.codex/skills/<n>/SKILL.md` + AGENTS fallback | rules (fallback) |
| `slash_command` | User-invoked command | `.claude/commands/<n>.md` | AGENTS.md section (fallback) | rules (fallback) |
| `task_harness` | Retrieval-only task contract | `.anamnesis/task-harnesses/*.yaml` | `.anamnesis/task-harnesses/*.yaml` | `.anamnesis/task-harnesses/*.yaml` |

The adapters do not promise identical native UI. Claude Code, Codex, and
Cursor expose different primitives, so anamnesis targets **user-facing
parity**: project recall, ontology access, handoff continuity, and
operational guardrails should survive switching agents.

Detail in [`docs/ADAPTER-PARITY.md`](docs/ADAPTER-PARITY.md),
[`docs/AGENT-SWITCHING-GUIDE.md`](docs/AGENT-SWITCHING-GUIDE.md), and
[`docs/DESIGN.md`](docs/DESIGN.md).

---

## Evidence

anamnesis is dogfooded on itself. Public claims are limited to sanitized
fixtures and self-check evidence; private-project validation is kept out of
README, packaged docs, and public benchmark artifacts.

Generated benchmark datasets, reports, and SVG visualizations live under
[`docs/benchmark-evidence/`](docs/benchmark-evidence/). This README keeps only
the current headline numbers and links to the evidence index instead of
embedding generated chart galleries.

### Session context benchmark

v1.5 changed SessionStart from full file-body injection to compact source
pointers plus invariant digests. The deterministic benchmark compares both
modes across public-safe fixtures.

Current run:

- Large ontology fixture: compact mode reduced estimated startup tokens by
  `94%`.
- Hard-cap outcomes: compact mode exceeded the cap `0` times; full mode
  exceeded it `2` times.
- Required retrieval rules and source pointers were present in `7/7`
  compact fixture runs.
- `anamnesis status` and `anamnesis doctor` also report the current project's
  compact SessionStart budget so oversized startup context is visible during
  normal maintenance, not only in benchmark artifacts.

Evidence and chart links are in
[`docs/benchmark-evidence/`](docs/benchmark-evidence/) and
[`docs/benchmark-evidence/session-context/`](docs/benchmark-evidence/session-context/).

### Retrieval source-pointer benchmark

v1.17 adds a deterministic public-safe retrieval benchmark across mixed
document, ontology, handoff, task-harness, agent-rule, and diagnostic pointers.
Every case runs without a kind filter, while SessionStart remains compact.

Current run:

- Source-pointer ranking: top-1 `18/18`, top-3 `18/18`, MRR `1.000`.
- Compact SessionStart budget: `206/800` estimated tokens.
- Lifecycle safety: stale handoff and missing ontology-ref leakage into ordinary
  top-3 results were both `0` across `2/2` safety checks.
- Actual agent query/source-read behavior remains model-dependent and is
  recorded separately through `benchmark task`; this deterministic suite does
  not claim that a model opened the returned source.

Evidence and chart links are in
[`docs/benchmark-evidence/`](docs/benchmark-evidence/) and
[`docs/benchmark-evidence/retrieval-source-pointers/`](docs/benchmark-evidence/retrieval-source-pointers/).

### Subagent context benchmark

v1.15 adds a deterministic repeated-run benchmark for subagent context
enforcement. It keeps startup-hook or launcher-wrapper injection separate from
same-session native subagent prompt-contract evidence.

Current run:

- Separate-process startup lane: `20/20` injected, `0` missed.
- Same-session native subagent lane: `20/20` prompt-contract accepted, `0`
  rejected. This is not claimed as automatic SessionStart injection.

Evidence and chart links are in
[`docs/benchmark-evidence/`](docs/benchmark-evidence/) and
[`docs/benchmark-evidence/subagent-injection/`](docs/benchmark-evidence/subagent-injection/).

### Upgrade benchmark

The deterministic upgrade benchmark covers public-safe existing-project
fixtures. It repeatedly runs sanitized old-project states through
`init`/`apply`/`status`/`doctor` and the guided `upgrade apply-choice` path,
keeping pass/fail dimensions separate from summary convenience numbers.

Current run:

- Fixture coverage: clean old project without settings, pinned historical
  fragment archive, partial adapter choice, stale Codex hook refresh,
  suggested-but-declined fragment, and choice execution command.
- Repeated fixture runs: `18/18` passed (`100%`).
- Post-upgrade pending writes: `0`; doctor errors: `0`; manifest drift count:
  `0`.
- Choice executions: `6`; preview-required guardrails: `3`; unsupported
  choices: `0`.

Evidence and chart links are in
[`docs/benchmark-evidence/`](docs/benchmark-evidence/) and
[`docs/benchmark-evidence/upgrade/`](docs/benchmark-evidence/upgrade/).

Current self-check records live in [`docs/DOGFOOD.md`](docs/DOGFOOD.md).
Public-safe benchmark boundaries live in
[`docs/BENCHMARK-GALLERY.md`](docs/BENCHMARK-GALLERY.md), and broader
ecosystem claims stay intentionally disallowed. The claim ledger is
[`docs/README-CLAIMS.md`](docs/README-CLAIMS.md).
Model-dependent task diagnostics live separately in
[`docs/AGENT-TASK-BENCHMARKS.md`](docs/AGENT-TASK-BENCHMARKS.md) and are not
used for deterministic README score claims.

---

## Safety

- **`--allow-exec-adapters`** flag is *required* for installs into native agent-behavior surfaces such as `.claude/{hooks,commands,skills}/`, `.codex/skills/`, `.codex/hooks.json`, `.anamnesis/codex-native-hooks/`, and `.cursor/rules/`. Default is content-only (AGENTS.md regions, ontology slices). This blocks remote-fragment supply-chain risk.
- **Files on disk that aren't in the manifest** are classified as `user-modified` and never overwritten. This catches both pre-existing files (from before anamnesis adoption) and post-install user edits.
- **`apply --dry-run` previews writes**. `apply` writes reviewed project-managed changes.
- **Backups** are taken automatically before `apply` modifies any file.

---

## Roadmap

| Version | Theme | Status |
|---|---|---|
| **v0.1** | Claude Code adapter + idempotency model | shipped 2026-04-26 |
| **v0.2** | Multi-tool (Codex), monorepo `scopes`, `status`, npm publish | shipped 2026-04-27 |
| **v0.3** | Cursor adapter, Codex hook/skill/slash fallback, monorepo init UX, **agent handoff MVP** | shipped 2026-04-28 |
| **v0.4** | Hybrid ontology bootstrap, `/ontology-enrich`, init auto-bootstrap, continuity polish | shipped 2026-04-29; 0.4.1 expands framework introspectors; 0.4.2 ships operational polish |
| **v0.5** | Dogfood lifecycle validation and agent-switch continuity hardening | shipped 2026-04-30 |
| **v0.6** | Repeatable bounded ontology generation plus agent-assisted enrichment | shipped 2026-05-03 |
| **v0.7** | Multi-agent UX, lifecycle scale, and benchmark reports | shipped 2026-05-03 |
| **v0.8** | Schema, API, migration, and repair workflow stabilization | shipped 2026-05-04 |
| **v0.9** | Registry, signing, docs, and public benchmark readiness | shipped 2026-05-04 |
| **v1.0** | Stable schema, public API, migration surface, docs, and evidence-backed claims | shipped 2026-05-04 |
| **v1.1** | Codex native lifecycle hooks, hook diagnostics, real hook smokes, and runtime evidence | shipped 2026-05-07; latest patch 1.1.1 |
| **v1.2** | Numeric benchmark evidence, public scorecards, and runtime evidence expansion | shipped 2026-05-08; latest patch 1.2.1 |
| **v1.3** | Fragment dependency resolution and update event hooks | shipped 2026-05-08 |
| **v1.4** | Adoption automation and project context bootstrap | shipped 2026-05-11; latest patch 1.4.4 |
| **v1.5** | Compact SessionStart defaults and session-context benchmark graphs | shipped 2026-06-19 |
| **v1.6** | Repo-local context index/query/resume and contradiction diagnostics | shipped 2026-06-25 |
| **v1.7** | Retrieval-only task harnesses, lifecycle cleanup, handoff retention, and release parity | shipped 2026-07-02; latest patch 1.7.1 |
| **v1.8** | Configurable bounded handoff retention policy | shipped 2026-07-02 |
| **v1.9** | Upgrade compatibility and project-update planning | shipped 2026-07-03; latest patch 1.9.6 |
| **v1.10** | Guided upgrade decisions, release gate alignment, and prompt-gate UX | shipped 2026-07-07 |
| **v1.11** | Safe upgrade choice execution and upgrade benchmark choice metrics | shipped 2026-07-07 |
| **v1.12** | Compact SessionStart budget diagnostics | shipped 2026-07-07 |
| **v1.13** | First-run UX and stale-doc/path diagnostics | shipped 2026-07-08 |
| **v1.14** | Codex native skill parity and adapter surface evidence | shipped 2026-07-09 |
| **v1.15** | Subagent context contract and injection-success evidence | shipped 2026-07-09 |
| **v1.16** | Command UX consolidation, grouped help, and terminal UI polish | shipped 2026-07-09 |
| **v1.17** | Ontology source management and document graph diagnostics | shipped 2026-07-10 |

Detailed plan: [`docs/ROADMAP.md`](docs/ROADMAP.md).
Monorepo application guide: [`docs/MONOREPO.md`](docs/MONOREPO.md).

---

## Documentation

- [`docs/ROADMAP.md`](docs/ROADMAP.md) — version-by-version plan
- [`docs/AGENT-SWITCHING-GUIDE.md`](docs/AGENT-SWITCHING-GUIDE.md) —
  install once, switch agents, and continue work without re-briefing
- [`docs/AGENTFILE-V1-FREEZE.md`](docs/AGENTFILE-V1-FREEZE.md) —
  v1 Agentfile freeze decisions, reserved fields, and strict parser policy
- [`docs/AGENTFILE-MIGRATIONS.md`](docs/AGENTFILE-MIGRATIONS.md) —
  `anamnesis migrate agentfile` command contract
- [`docs/COMMAND-UX-PLAN.md`](docs/COMMAND-UX-PLAN.md) —
  command consolidation, grouped help, adaptive detection, and terminal UI plan
- [`docs/API.md`](docs/API.md) — v1.0 TypeScript API stability contract
- [`docs/REPAIR.md`](docs/REPAIR.md) — repair playbook for existing managed projects
- [`docs/FRAGMENT-AUTHORING.md`](docs/FRAGMENT-AUTHORING.md) —
  public fragment authoring guide, review checklist, versioning, and compatibility rules
- [`docs/TASK-HARNESS-DESIGN.md`](docs/TASK-HARNESS-DESIGN.md) —
  v1.7 retrieval-only task harness capability and lifecycle design
- [`docs/HANDOFF-LIFECYCLE.md`](docs/HANDOFF-LIFECYCLE.md) —
  hot/warm/cold/deprecated handoff lifecycle design and retention policy
  follow-up
- [`docs/FRAGMENT-REGISTRY.md`](docs/FRAGMENT-REGISTRY.md) —
  v0.9 registry metadata, discovery, version selection, cache, and trust-boundary design
- [`docs/FRAGMENT-SIGNING.md`](docs/FRAGMENT-SIGNING.md) —
  v0.9 remote fragment checksum, signature, trust-store, and rejection policy
- [`docs/REGISTRY-V1-DECISION.md`](docs/REGISTRY-V1-DECISION.md) —
  v1.0 decision to keep remote registry/signing implementation post-v1.0
- [`docs/REMOTE-SYNC-STRATEGY.md`](docs/REMOTE-SYNC-STRATEGY.md) —
  v1.0 decision to omit broad `sync` and keep registry refresh/update explicit
- [`docs/ADAPTER-PARITY.md`](docs/ADAPTER-PARITY.md) — tested capability
  parity matrix across Claude Code, Codex, and Cursor
- [`docs/SWITCHING-SCENARIOS.md`](docs/SWITCHING-SCENARIOS.md) — tested
  3x3 source/target handoff scenarios across supported agents
- [`docs/BENCHMARKS.md`](docs/BENCHMARKS.md) — deterministic context-quality
  benchmark reports
- [`docs/AGENT-TASK-BENCHMARKS.md`](docs/AGENT-TASK-BENCHMARKS.md) —
  model-dependent task benchmark harness and claim boundary
- [`docs/BENCHMARK-GALLERY.md`](docs/BENCHMARK-GALLERY.md) —
  public-safe benchmark evidence, claim policy, and collection targets
- [`docs/README-CLAIMS.md`](docs/README-CLAIMS.md) —
  v1.0 evidence-backed README claim ledger
- [`docs/MONOREPO.md`](docs/MONOREPO.md) — applying anamnesis to a monorepo
- [`docs/ONTOLOGY-BOOTSTRAP.md`](docs/ONTOLOGY-BOOTSTRAP.md) — two-layer ontology generation
- [`docs/RELEASING.md`](docs/RELEASING.md) — npm Trusted Publishing release flow
- [`docs/DESIGN.md`](docs/DESIGN.md) — architecture, capability model, idempotency
- [`specs/agentfile.md`](specs/agentfile.md) — `Agentfile` v1 schema
- [`rulebook.md`](rulebook.md) — auto-detection rules and trigger DSL
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — adding fragments, writing capabilities
- [`CHANGELOG.md`](CHANGELOG.md) — release notes
- [`docs/deprecated/`](docs/deprecated/) — archived historical audits and
  superseded planning docs; not current operating guidance

---

## License

MIT — see [LICENSE](LICENSE).

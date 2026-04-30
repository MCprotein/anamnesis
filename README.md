# anamnesis

> **AI coding agent config lifecycle manager.**
> Keep your AI coding agents from forgetting what your project is.

[![tests](https://img.shields.io/badge/tests-299%20passing-success)]() [![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![status](https://img.shields.io/badge/status-v0.2.0-orange)]()

---

## The problem

Every time you open a project with Claude Code (or Codex, Cursor, …), your agent starts blank.
No project conventions. No ontology. No context.

So you write an `AGENTS.md`, a `system_graph.yaml`, a few hooks, slash commands, skills — and then you do it again for the next project. And the project after that.

The word **anamnesis** (ἀνάμνησις) means *"not forgetting"* in Greek — the literal opposite of *amnesia*. This tool prevents **agent amnesia**.

---

## What anamnesis does

- **Installs** a baseline of conventions every project benefits from (ontology injection, uncommitted-changes reminder, the `/load-context` skill, …).
- **Detects** stack-specific concerns from your project files (`prisma/schema.prisma`, `@nestjs/core` in `package.json`, `uv.lock`, …) and overlays the matching fragment.
- **Re-syncs** as the library evolves, *preserving your edits* — files you've authored or modified are never overwritten without consent.
- **Promotes** your project-local hooks/skills back into the library so other projects benefit.

It is **not** a project scaffolder (no `package.json`, no source code generation). It manages the small markdown/yaml/shell ecosystem your AI agent reads, nothing else.

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

Building from source instead (during development or for forks):

```bash
git clone https://github.com/MCprotein/anamnesis ~/code/anamnesis
cd ~/code/anamnesis
npm install
npm run build       # produces cli/dist/
npm link            # makes `anamnesis` available globally
```

Then in any project:

```bash
cd /path/to/your/project
anamnesis init --dry-run                 # preview what would happen
anamnesis init --allow-exec-adapters     # actually install
```

What gets created:

```
your-project/
├── Agentfile                                    # selected fragments + tool list
├── AGENTS.md                                    # canonical context (existing prose preserved)
├── .anamnesis/
│   ├── manifest.json                            # region/file hashes for drift detection
│   └── ontology/{base,<fragment>}.yaml          # ontology slices (concatenated at session start)
└── .claude/                                     # CC adapter output
    ├── hooks/{inject-ontology, remind-uncommitted, …}.sh
    ├── commands/load-context.md
    └── skills/load-context/SKILL.md
```

`AGENTS.md` is *additive* — anamnesis appends regions inside `<!-- anamnesis:region ... -->` anchors. Anything outside the anchors is yours.

---

## Lifecycle

```bash
anamnesis init      # first-time setup
anamnesis update    # library updates + drift detection (dry-run by default; --apply to write)
anamnesis update --bump-pinned  # explicitly move pinned fragments to current
anamnesis status    # installed fragments, drift, suggestions (--json for tools)
anamnesis doctor    # read-only installation integrity diagnostics
anamnesis promote   # lift a project-local file into the library as a reusable fragment
```

Re-running `update` on an unchanged project produces only `noop` results. User edits are surfaced as `user-modified` and library updates skip them. Backups go to `.anamnesis/backups/<timestamp>/`.

---

## Fragment catalog

| id | trigger | capabilities |
|---|---|---|
| `base` | always (auto-included) | project_memory, ontology, 2× executable_hook, slash_command, skill |
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

| Capability | What it represents | Claude Code | Codex (v0.2+) | Cursor (v0.3+) |
|---|---|---|---|---|
| `project_memory` | Always-loaded context | `AGENTS.md` region | `AGENTS.md` region | `.cursor/rules` (alwaysApply) |
| `ontology` | Structured reference | SessionStart hook injection | AGENTS.md instruction | rules instruction |
| `executable_hook` | Event-driven automation | `.claude/hooks/*.sh` | git hook + LLM instruction | git hook + LLM instruction |
| `skill` | Reusable procedure | `.claude/skills/<n>/SKILL.md` | AGENTS.md section (fallback) | rules (fallback) |
| `slash_command` | User-invoked command | `.claude/commands/<n>.md` | — (no native equivalent) | — |

v0.1 ships the Claude Code adapter only. Codex and Cursor adapters are scoped for v0.2/v0.3; the IR is already shaped for them.

Detail in [`docs/DESIGN.md`](docs/DESIGN.md).

---

## Verified use

anamnesis is dogfooded on itself plus 3 other repositories at the time of v0.1:

- **sanitized-k8s** — Kubernetes infrastructure (base + k8s)
- **sanitized-python-api** — ML pipeline (base + fastapi + python-uv)
- **sanitized-nest-prisma** — NestJS backend (base + prisma + nestjs)
- **anamnesis itself** — the tool managing its own context (base only)

In all four cases, the user-modified protection correctly preserved hand-authored files (4–9 per project).

---

## Safety

- **`--allow-exec-adapters`** flag is *required* for installs into `.claude/{hooks,commands,skills}/`. Default is content-only (AGENTS.md regions, ontology slices). This blocks remote-fragment supply-chain risk.
- **Files on disk that aren't in the manifest** are classified as `user-modified` and never overwritten. This catches both pre-existing files (from before anamnesis adoption) and post-install user edits.
- **`update` is dry-run by default**. Pass `--apply` to actually write.
- **Backups** are taken automatically before `update --apply` modifies any file.

---

## Roadmap

| Version | Theme | Status |
|---|---|---|
| **v0.1** | Claude Code adapter + idempotency model | shipped 2026-04-26 |
| **v0.2** | Multi-tool (Codex), monorepo `scopes`, `status`, npm publish | shipped 2026-04-27 |
| **v0.3** | Cursor adapter, Codex hook/skill/slash fallback, monorepo init UX, **agent handoff MVP** | shipped 2026-04-28 |
| **v0.4** | Hybrid ontology bootstrap, `/ontology-enrich`, init auto-bootstrap | shipped 2026-04-29; 0.4.1 expands framework introspectors |
| **v1.0** | Stable schema, public fragment registry, signing | stable target |

Detailed plan: [`docs/ROADMAP.md`](docs/ROADMAP.md).
Monorepo application guide: [`docs/MONOREPO.md`](docs/MONOREPO.md).

---

## Documentation

- [`docs/ROADMAP.md`](docs/ROADMAP.md) — version-by-version plan
- [`docs/MONOREPO.md`](docs/MONOREPO.md) — applying anamnesis to a monorepo
- [`docs/ONTOLOGY-BOOTSTRAP.md`](docs/ONTOLOGY-BOOTSTRAP.md) — two-layer ontology generation
- [`docs/RELEASING.md`](docs/RELEASING.md) — npm Trusted Publishing release flow
- [`docs/DESIGN.md`](docs/DESIGN.md) — architecture, capability model, idempotency
- [`specs/agentfile.md`](specs/agentfile.md) — `Agentfile` v1 schema
- [`rulebook.md`](rulebook.md) — auto-detection rules and trigger DSL
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — adding fragments, writing capabilities
- [`CHANGELOG.md`](CHANGELOG.md) — release notes

---

## License

MIT — see [LICENSE](LICENSE).

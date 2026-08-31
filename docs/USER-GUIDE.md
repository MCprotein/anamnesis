# anamnesis user guide

This guide contains the operational detail intentionally omitted from the
project README. Start with the [README](../README.md) for the product overview,
quickstart, and current benchmark headline.

## Installation and first setup

Install globally:

```bash
npm install -g @mcprotein/anamnesis
```

Or preview without a global install:

```bash
npx @mcprotein/anamnesis init --dry-run
```

Initialize a project:

```bash
cd /path/to/your/project
anamnesis init --dry-run
anamnesis init --allow-exec-adapters
anamnesis init --tools all --allow-exec-adapters
```

Optional document setup:

```bash
anamnesis init --scaffold-docs --allow-exec-adapters
anamnesis init --enhance-docs --allow-exec-adapters
```

`--scaffold-docs` creates missing starter documentation.
`--enhance-docs` adds managed context-review regions to existing documentation
without replacing user prose. When an agent performs setup, the
`anamnesis-init` skill maps one documentation choice to these flags.

## Active Work defaults and opt-out

Fresh `anamnesis init` projects materialize an active Work profile:

```yaml
settings:
  work_policy:
    reconciliation:
      preset: adaptive
    review:
      preset: advisory
    delegation:
      parallelism: auto
  work_prompt_capture:
    preset: bounded
```

Disable only the features you do not want by changing their values to `off`:

```yaml
settings:
  work_policy:
    reconciliation:
      preset: off
    review:
      preset: off
    delegation:
      parallelism: off
  work_prompt_capture:
    preset: off
```

Existing Agentfiles that omit these settings retain the legacy all-off
behavior. Review the generated Agentfile in the installation Git diff and set
`work_prompt_capture.preset: off` if prompt staging is not wanted. Executable
hooks and skills remain a separate supply-chain boundary and require
`--allow-exec-adapters`; init output states whether that native automation is
enabled and prints the enabling command when it is not.

## Updating an existing project

Successful `init` automatically registers the canonical project path, filesystem
identity, tool selection, and executable-adapter preference in a private
user-level index. Inspect or update every registered project without visiting
each directory:

```bash
anamnesis projects list
anamnesis projects plan
anamnesis projects apply
```

`projects plan` is read-only. `projects apply` updates only entries whose path
and filesystem identity still match and whose dry-run contains no blocked or
user-modified managed surfaces. Other projects are skipped without preventing
safe projects from updating. Use `projects prune --apply` to remove stale
registrations, or run `projects register --allow-exec-adapters` inside an older
managed project to add it to the index.

The normal package upgrade now reloads the newly installed CLI and synchronizes
the safe registered subset automatically:

```bash
anamnesis upgrade --apply
```

Project-local updates and guided conflict resolution remain available:

```bash
anamnesis upgrade plan
anamnesis upgrade choose

anamnesis apply --dry-run --allow-exec-adapters
anamnesis apply --allow-exec-adapters
anamnesis doctor
```

If the Agentfile needs migration, `upgrade plan` reports that gate before any
rendering or writes. Apply the schema migration, then rerun the plan:

```bash
anamnesis migrate agentfile --apply
anamnesis upgrade plan
```

Read-only upgrade choices execute directly. Local-write and package-install
choices preview by default and require `--apply`.

## Building from source

```bash
git clone https://github.com/MCprotein/anamnesis
cd anamnesis
npm install
npm run build
npm link
```

## Managed project layout

```text
your-project/
├── Agentfile
├── AGENTS.md
├── CLAUDE.md
├── .anamnesis/
│   ├── manifest.json
│   ├── ontology/{base,<fragment>}.yaml
│   ├── ontology/*.bootstrap.yaml
│   ├── task-harnesses/
│   ├── handoff/
│   └── work-units/
├── .claude/hooks,commands,skills/
├── .codex/config.toml
├── .codex/hooks.json
├── .codex/skills/
├── .anamnesis/codex-native-hooks/
└── .cursor/rules/
```

`AGENTS.md` is additive. Managed sections are enclosed in
`<!-- anamnesis:region ... -->` anchors; prose outside those anchors is not
owned by anamnesis.

## Lifecycle command reference

| Command | Purpose |
| --- | --- |
| `anamnesis init --dry-run` | Preview first-time setup |
| `anamnesis init` | Install project-managed context |
| `anamnesis apply --dry-run` | Preview library-driven updates |
| `anamnesis apply` | Apply reviewed managed changes |
| `anamnesis status` | Report fragments, drift, ontology, continuity, and evidence |
| `anamnesis doctor` | Run read-only integrity diagnostics |
| `anamnesis migrate agentfile` | Check or apply Agentfile schema migration |
| `anamnesis context index --write` | Build the local source-pointer index |
| `anamnesis context query "<terms>"` | Retrieve exact context source pointers |
| `anamnesis context diagnose` | Find handoff, ontology, document, and evidence issues |
| `anamnesis context resume` | Print a compact resume bundle |
| `anamnesis ontology bootstrap` | Refresh deterministic Layer A project facts |
| `anamnesis gc --dry-run` | Preview bounded context and handoff cleanup |
| `anamnesis promote` | Lift a project-local capability into a reusable fragment |

Use `anamnesis --help --all` for every command and option. Release-maintainer
commands are documented in [RELEASING.md](RELEASING.md).

### Human output modes

Primary lifecycle and health commands use a consistent
`verdict → exceptions → actions` layout. The default view keeps safety-relevant
warnings and repair commands but collapses healthy inventories and provenance.
Add `--verbose` to supported lifecycle, health, hooks, and Work commands when
you need fragment lists, hook commands and hashes, evidence history, file
inventories, review provenance, or generation-boundary details.

`--json` remains the automation interface where supported and does not include
terminal decoration. `NO_COLOR` disables ANSI color, while narrow and
non-interactive terminals automatically use wrapped, plain-text-safe output.

## Generation boundary

| Generated by | Output | Meaning |
| --- | --- | --- |
| CLI (`init`, `apply`) | `AGENTS.md`, static ontology, adapter surfaces | Deterministic managed context |
| CLI (`ontology bootstrap`) | `*.bootstrap.yaml` | Regenerable Layer A facts |
| Agent (`ontology-enrich`) | `*.enriched.yaml` | Evidence-backed Layer B semantics |
| Agent (`doc-freshness-review`) | Review report or requested edits | Semantic prose freshness |
| Agent (`handoff-prepare`) | `handoff/active.md` and archive | Cross-session task state |

The CLI does not crawl arbitrary source or prose into ontology. It generates
facts it can prove; the active agent supplies semantic relationships, intent,
and open questions with evidence.

## Fragment catalog

The always-installed `base` fragment supplies project memory, ontology,
continuity hooks, skills, commands, and task harnesses. Built-in stack fragments
cover Prisma, Kubernetes, NestJS, Next.js, FastAPI, Python/uv, Docker Compose,
Rails, Django, Go, Rust, SvelteKit, Remix, and Nuxt.

Detection rules live in [rulebook.md](../rulebook.md). Create reusable project
capabilities with `anamnesis promote`; authoring details are in
[FRAGMENT-AUTHORING.md](FRAGMENT-AUTHORING.md).

## Capability mapping

| Capability | Claude Code | Codex | Cursor |
| --- | --- | --- | --- |
| Project memory | `AGENTS.md` + `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` |
| Ontology | SessionStart hook | Native SessionStart wrapper + fallback | Rules instruction |
| Executable hook | `.claude/hooks/` | Native wrappers and optional git bridge | Rules fallback |
| Skill | `.claude/skills/` | `.codex/skills/` + fallback | Rules fallback |
| Slash command | `.claude/commands/` | `AGENTS.md` fallback | Rules fallback |
| Task harness | `.anamnesis/task-harnesses/` | Same | Same |

The tools do not expose identical native UI. anamnesis targets behavioral
parity: project recall, ontology retrieval, handoff continuity, and operational
guardrails. See [ADAPTER-PARITY.md](ADAPTER-PARITY.md).

## Evidence and benchmarks

Generated public-safe datasets and visualizations live under
[`benchmark-evidence/`](benchmark-evidence/). The main suites cover:

- real-agent Work continuity cost and correctness;
- compact versus full SessionStart context;
- source-pointer retrieval ranking;
- subagent context-contract delivery;
- upgrade compatibility and post-upgrade drift.

See [BENCHMARKS.md](BENCHMARKS.md), [AGENT-TASK-BENCHMARKS.md](AGENT-TASK-BENCHMARKS.md),
and [BENCHMARK-GALLERY.md](BENCHMARK-GALLERY.md) for methodology and claim
boundaries.

## Further reading

- [DESIGN.md](DESIGN.md) — architecture and trust boundaries
- [WORK-UNIT-DESIGN.md](WORK-UNIT-DESIGN.md) — Work ledger and policy model
- [HANDOFF-LIFECYCLE.md](HANDOFF-LIFECYCLE.md) — hot/warm/cold retention
- [AGENT-SWITCHING-GUIDE.md](AGENT-SWITCHING-GUIDE.md) — cross-agent continuity
- [ROADMAP.md](ROADMAP.md) — current delivery status
- [REPAIR.md](REPAIR.md) — repair playbook
